//! BB/LLE/RF register driver for CH582/583.
//!
//! Independent Rust implementation. The register addresses, control bit
//! layouts and the three-point TX/RX calibration procedure are factual data
//! taken from the MIT-licensed ch32fun `iSLER` project (extralibs/iSLER.h,
//! (c) 2023-2024 CNLohr et al., itself derived from WCH's public datasheet).
//! See `NOTICE`. Only the CH582/CH583 branch is implemented here; the other
//! WCH RF chips have different register maps.
//!
//! Frame layout expected by the hardware (identical to iSLER):
//! `[PDU header, payload length, payload...]` — the baseband prepends the
//! preamble and access address and appends the CRC. The CRC init is written
//! as 0x555555, the Bluetooth advertising CRC preset.
//!
//! TX/RX 触发和 RF 停止操作放在 `.highcode`（RAM）以便及时换向。

use core::sync::atomic::{fence, AtomicU32, Ordering};

use ch5xx_hal::interrupt::InterruptExt as _;
use qingke_rt::highcode;

use crate::schedule::Instant;

// --- register bases (CH582/583) -------------------------------------------

const BB_BASE: usize = 0x4000_c100;
const LL_BASE: usize = 0x4000_c200;
const RF_BASE: usize = 0x4000_d000;

// BB word offsets.
const BB_CTRL_CFG: usize = 0;
const BB_CRCINIT1: usize = 1;
const BB_ACCESSADDRESS1: usize = 2;
const BB4: usize = 4;
const BB5: usize = 5;
const BB6: usize = 6;
const BB8: usize = 8;
const BB9: usize = 9;
const BB10: usize = 10;
const BB_CTRL_TX: usize = 11;
const BB_RSSI: usize = 12;
const BB13: usize = 13;

// LLE word offsets.
const LL0: usize = 0;
const LL1: usize = 1;
const LL_STATUS: usize = 2;
const LL_INT_EN: usize = 3;
const LL_CTRL_MOD: usize = 20;
const LL_TMR0: usize = 25;
const LL_TMR1: usize = 26;
const LL_TMR2: usize = 27;
const TMR0_EXPIRED: u32 = 1 << 13;
const TMR2_EXPIRED: u32 = 1 << 15;

// 两只倒数计时器交错运行。CPU 应答一次到期时，另一只仍在计数，
// 重装的时间基于另一只的剩余时间，避免把 IRQ 延迟累积进时基。
const CLOCK_SPAN: u32 = 0x1000_0000;
static mut CLOCK_END: [u32; 2] = [CLOCK_SPAN, 2 * CLOCK_SPAN];
static mut CLOCK_FIRST: usize = 0;
const LL_TX_BUF: usize = 28;
const LL_RX_BUF: usize = 29;

// RF word offsets.
const RF1: usize = 1;
const RF2: usize = 2;
const RF3: usize = 3;
const RF10: usize = 10;
const RF11: usize = 11;
const RF_TXTUNE_CTRL: usize = 14;
const RF20: usize = 20;
const RF22: usize = 22;
const RF_TXCTUNE_CO_CTRL: usize = 36;
const RF_TXCTUNE_GA_CTRL: usize = 37;
const RF_RXTUNE: usize = 39;
const RF_TXCTUNE_CO: usize = 40;
const RF_TXCTUNE_GA: usize = 50;

// LLE status / control bits.
const LL_RX: u32 = 0x01;
const LL_TX: u32 = 0x02;
const LL_STOP: u32 = 0x08;
// CH582 DMA 附在 PDU 后的状态字节中，bit 4 表示 CRC 校验失败。
const RX_CRC_ERROR: u8 = 1 << 4;
const CTRL_MOD_RFSTOP: u32 = 0xffff_fff8;

// Device modes (CH582/583 encoding).
const DEVMODE_TUNE: u16 = 0x00dd;
const DEVMODE_TX: u16 = 0x00da;
const DEVMODE_RX: u16 = 0x00d9;

/// TX power code for 0 dBm (`LL_TX_POWER_0_DBM`).
pub const TX_POWER_0_DBM: u8 = 0x12;

/// Channel map used only by the TX synthesiser calibration.
const CHANNEL_MAP: [u8; 40] = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
    28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 0, 11, 39,
];

/// PHY selector; values match the iSLER definitions.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phy {
    M1 = 1,
    M2 = 2,
    S2 = 4,
    S8 = 8,
}

// --- latched radio events -------------------------------------------------

static TX_DONE: AtomicU32 = AtomicU32::new(0);
static RX_READY: AtomicU32 = AtomicU32::new(0);
static RX_END: AtomicU32 = AtomicU32::new(0);
static TX_END: AtomicU32 = AtomicU32::new(0);

#[repr(align(4))]
struct LleBuffer([u32; 0x110]);

/// RX frame buffer written by the link-layer engine.
static mut LLE_BUF: LleBuffer = LleBuffer([0; 0x110]);

#[repr(align(4))]
struct TxBuffer([u8; 257]);
static mut TX_BUF: TxBuffer = TxBuffer([0; 257]);

#[inline(always)]
fn lle_buf_ptr() -> *mut u32 {
    unsafe { core::ptr::addr_of_mut!(LLE_BUF.0) as *mut u32 }
}

// --- raw accessors --------------------------------------------------------

#[inline(always)]
unsafe fn rd(base: usize, index: usize) -> u32 {
    core::ptr::read_volatile((base as *const u32).add(index))
}

#[inline(always)]
unsafe fn wr(base: usize, index: usize, value: u32) {
    core::ptr::write_volatile((base as *mut u32).add(index), value)
}

#[inline(always)]
unsafe fn bb_r(i: usize) -> u32 {
    rd(BB_BASE, i)
}
#[inline(always)]
unsafe fn bb_w(i: usize, v: u32) {
    wr(BB_BASE, i, v)
}
#[inline(always)]
unsafe fn ll_r(i: usize) -> u32 {
    rd(LL_BASE, i)
}
#[inline(always)]
unsafe fn ll_w(i: usize, v: u32) {
    wr(LL_BASE, i, v)
}
#[inline(always)]
unsafe fn rf_r(i: usize) -> u32 {
    rd(RF_BASE, i)
}
#[inline(always)]
unsafe fn rf_w(i: usize, v: u32) {
    wr(RF_BASE, i, v)
}

// --- LLE 时钟 -------------------------------------------------------------

// 调用方持有临界区，或正在执行 BLEL ISR。
#[inline(always)]
unsafe fn clock_now() -> Instant {
    let first = CLOCK_FIRST;
    let remaining = ll_r(LL_TMR0 + first);
    if remaining != 0 {
        Instant(CLOCK_END[first].wrapping_sub(remaining))
    } else {
        Instant(CLOCK_END[first ^ 1].wrapping_sub(ll_r(LL_TMR0 + (first ^ 1))))
    }
}

/// 当前 LLE 硬件时刻。
pub fn now() -> Instant {
    critical_section::with(|_| unsafe { clock_now() })
}

#[inline(always)]
unsafe fn reload_clock(status: u32) {
    let first = CLOCK_FIRST;
    if status & (TMR0_EXPIRED << first) != 0 {
        let other = first ^ 1;
        ll_w(LL_TMR0 + first, ll_r(LL_TMR0 + other) + CLOCK_SPAN);
        CLOCK_END[first] = CLOCK_END[other].wrapping_add(CLOCK_SPAN);
        CLOCK_FIRST = other;
    }
}

/// 等待定时截止或射频完成。返回时由调用方根据时间戳决定先处理哪件事。
/// `ready` 只读取已锁存的事件，可在禁止中断的临界区内调用。
pub fn wait(deadline: Instant, ready: impl Fn() -> bool) {
    loop {
        let done = critical_section::with(|_| unsafe {
            let current = clock_now();
            if ready() || current.reached(deadline) {
                return true;
            }
            ll_w(LL_STATUS, TMR2_EXPIRED);
            ll_w(LL_TMR2, deadline.elapsed_ticks(current).min(CLOCK_SPAN));
            // SEVONPEND 让检查条件后、WFI 前发生的 IRQ 也能唤醒 CPU。
            core::arch::asm!("wfi", options(nostack));
            false
        });
        if done {
            return;
        }
    }
}

// --- interrupts -----------------------------------------------------------

/// Link-layer engine interrupt (`BLEL`, IRQ 21).
///
/// Acknowledges `LL_STATUS`, latches TX completion, and for RX re-arms the
/// baseband, stops the link and publishes `RX_READY`.
#[ch5xx_hal::interrupt]
fn BLEL() {
    unsafe {
        let status = ll_r(LL_STATUS);
        let end = clock_now();
        // CH582/583 acknowledge by writing the status back.
        ll_w(LL_STATUS, status);
        fence(Ordering::SeqCst);

        if status & LL_TX != 0 {
            TX_END.store(end.0, Ordering::Relaxed);
            TX_DONE.store(status, Ordering::Release);
        } else if status & LL_RX != 0 {
            bb_w(BB_CTRL_TX, bb_r(BB_CTRL_TX) | 1);
            stop();
            RX_END.store(end.0, Ordering::Relaxed);
            RX_READY.store(status, Ordering::Release);
        }
        reload_clock(status);
    }
}

// --- calibration ----------------------------------------------------------

unsafe fn set_mode(mode: u16) {
    if mode != 0 {
        bb_w(0, (bb_r(0) & 0xffff_fe7f) | 0x0000_0100);
        rf_w(RF2, rf_r(RF2) | 0x0033_0000);
    } else {
        bb_w(0, (bb_r(0) & 0xffff_fe7f) | 0x0000_0080);
        rf_w(RF2, rf_r(RF2) & 0xffcd_ffff);
    }
    let m = if mode == 0 { 0x80 } else { mode as u32 };
    ll_w(LL_CTRL_MOD, m);
}

/// Synthesise one channel and return `(nGA << 24) | nCO`.
unsafe fn txctune(channel: u8) -> u32 {
    rf_w(RF1, rf_r(RF1) & !1);
    let map = CHANNEL_MAP[channel as usize] as u32;
    rf_w(
        RF_TXTUNE_CTRL,
        (rf_r(RF_TXTUNE_CTRL) & 0xfffe_00ff) | (0xbf00 + (map << 8)),
    );
    rf_w(RF1, rf_r(RF1) | 1);

    ll_w(LL_TMR0, 8000);
    while (rf_r(RF_TXCTUNE_CO_CTRL) & (1 << 25)) == 0 || (rf_r(RF_TXCTUNE_GA_CTRL) & (1 << 26)) == 0
    {
        if ll_r(LL_TMR0) == 0 {
            break;
        }
    }

    let n_co = rf_r(RF_TXCTUNE_CO_CTRL) & 0x3f;
    let n_ga = (rf_r(RF_TXCTUNE_GA_CTRL) >> 10) & 0x7f;
    (n_ga << 24) | n_co
}

unsafe fn tx_tune() {
    rf_w(RF1, rf_r(RF1) & 0xffff_feff);
    rf_w(RF10, rf_r(RF10) & 0xffff_efff);
    rf_w(RF11, rf_r(RF11) & 0xffff_ffef);
    rf_w(RF2, rf_r(RF2) | 0x0002_0000);
    rf_w(RF1, rf_r(RF1) | 0x10);

    // Calibrate at 2401, 2480 and 2440 MHz, then interpolate.
    let t2401 = txctune(37);
    let t2480 = txctune(39);
    let t2440 = txctune(18);

    let n_co = |t: u32| t & 0x3f;
    let n_ga = |t: u32| (t >> 24) & 0x7f;

    let d_co_0140 = n_co(t2401).wrapping_sub(n_co(t2440));
    let d_co_4080 = n_co(t2440).wrapping_sub(n_co(t2480));
    let points: u32 = 20;
    let mut co = [0u8; 40];
    let mut f = 0;
    while f < points {
        let tune = d_co_0140 * (points - f) / points;
        co[f as usize] = (tune | (tune << 4)) as u8;
        f += 1;
    }
    while f < 2 * points {
        let tune = d_co_4080 * (f - points) / points;
        co[f as usize] = (tune | (tune << 4)) as u8;
        f += 1;
    }
    for i in 0..10 {
        let b = i * 4;
        rf_w(
            RF_TXCTUNE_CO + i,
            u32::from_le_bytes([co[b], co[b + 1], co[b + 2], co[b + 3]]),
        );
    }

    // iSLER notes this GA interpolation is not what EVT does; it is kept for
    // parity with the reference implementation (a BLE monitor reads better
    // without it, but 1M advertising works either way).
    let d_ga_0140 = n_ga(t2401).wrapping_sub(n_ga(t2440));
    let d_ga_4080 = n_ga(t2440).wrapping_sub(n_ga(t2480));
    let points: u32 = 6;
    let mut ga = [0u8; 12];
    let mut f = 1;
    while f < points {
        let tune = d_ga_0140 * (points - f) / points;
        ga[f as usize] = (tune | (tune << 4)) as u8;
        f += 1;
    }
    while f < 2 * points - 1 {
        let tune = d_ga_4080 * (f - points) / points;
        ga[f as usize] = (tune | (tune << 4)) as u8;
        f += 1;
    }
    for i in 0..3 {
        let b = i * 4;
        rf_w(
            RF_TXCTUNE_GA + i,
            u32::from_le_bytes([ga[b], ga[b + 1], ga[b + 2], ga[b + 3]]),
        );
    }

    rf_w(RF1, rf_r(RF1) & !0x10);
    rf_w(RF1, rf_r(RF1) & !1);
    rf_w(RF10, rf_r(RF10) | 0x1000);
    rf_w(RF11, rf_r(RF11) | 0x10);
    rf_w(
        RF_TXTUNE_CTRL,
        (rf_r(RF_TXTUNE_CTRL) & 0xffff_ffc0) | (t2440 & 0x3f),
    );
    rf_w(
        RF_TXTUNE_CTRL,
        (rf_r(RF_TXTUNE_CTRL) & 0x80ff_ffff) | (t2440 & 0x7f00_0000),
    );
    rf_w(RF1, rf_r(RF1) | 0x100);
}

unsafe fn rx_tune() {
    rf_w(RF20, rf_r(RF20) & 0xfffe_ffff);
    rf_w(RF2, rf_r(RF2) | 0x0020_0000);
    rf_w(RF3, (rf_r(RF3) & !0x10) | 0x10);
    rf_w(RF1, rf_r(RF1) | 0x1000);

    ll_w(LL_TMR0, 100);
    while ll_r(LL_TMR0) != 0 && ((rf_r(RF_RXTUNE) >> 8) & 1) != 0 {}

    let filter = rf_r(RF_RXTUNE) & 0x1f;
    rf_w(RF20, rf_r(RF20) | 0x0001_0000);
    rf_w(RF20, (rf_r(RF20) & !0x1f) | filter);
    rf_w(RF2, rf_r(RF2) & !0x0020_0000);

    rf_w(RF22, rf_r(RF22) & !0x0001_0000);
    rf_w(RF2, rf_r(RF2) | 0x0001_0000);
    rf_w(RF3, (rf_r(RF3) & !0x100) | 0x100);
    rf_w(RF1, (rf_r(RF1) & !0x0001_0000) | 0x0010_0000);
}

unsafe fn tune() {
    set_mode(DEVMODE_TUNE);
    tx_tune();
    rx_tune();
    set_mode(0);
}

// --- link primitives ------------------------------------------------------

#[highcode]
unsafe fn set_channel(channel: u8) {
    rf_w(RF11, rf_r(RF11) & !2);
    bb_w(
        BB_CTRL_CFG,
        (bb_r(BB_CTRL_CFG) & 0xffff_ff80) | ((channel & 0x7f) as u32),
    );
}

#[highcode]
unsafe fn link_config(link: Link) {
    let Link {
        access,
        crc_init,
        channel,
        phy,
    } = link;
    set_channel(channel);
    bb_w(BB_ACCESSADDRESS1, access);
    bb_w(BB_CRCINIT1, crc_init);

    let cfg = bb_r(BB_CTRL_CFG);
    let cfg = match phy {
        Phy::M1 => (cfg & 0xffff_0fff) | 0x1000,
        Phy::M2 => cfg & 0xffff_0fff,
        Phy::S2 | Phy::S8 => {
            let coded = (cfg & 0xffff_0fff) | 0x2000;
            if phy == Phy::S2 {
                (coded & 0xffff_3fff) | 0x4000
            } else {
                coded & 0xffff_3fff
            }
        }
    };
    bb_w(BB_CTRL_CFG, cfg);

    if phy == Phy::M1 || phy == Phy::M2 {
        bb_w(BB4, 0x0037_22d0);
        bb_w(BB5, 0x0810_1901);
        bb_w(BB6, 0x0003_1624);
        bb_w(BB8, 0x0009_0083);
        bb_w(BB10, 0x28be);
    } else {
        bb_w(BB4, 0x0037_22df);
        bb_w(BB5, 0x0830_1ff1);
        bb_w(BB6, 0x0003_1619);
        bb_w(BB8, 0x0009_0086);
        bb_w(BB10, 0x28de);
    }
    bb_w(BB9, 0x1006_310);

    // Single-shot mode; the stack schedules each TX/RX itself.
    ll_w(LL1, ll_r(LL1) & !1);
}

/// 结束调谐并启动已准备的发送，由调度器选择启动时刻。
#[highcode]
pub fn tx_start() {
    unsafe {
        bb_w(BB_CTRL_CFG, bb_r(BB_CTRL_CFG) | 0x0080_0000);
        bb_w(BB_CTRL_TX, bb_r(BB_CTRL_TX) & !3);
        ll_w(LL0, LL_TX);
    }
}

/// Stop any in-flight TX/RX and park the radio.
#[highcode]
pub fn stop() {
    unsafe {
        set_mode(0);
        if ll_r(LL0) & (LL_RX | LL_TX) != 0 {
            ll_w(LL_CTRL_MOD, ll_r(LL_CTRL_MOD) & CTRL_MOD_RFSTOP);
            ll_w(LL0, ll_r(LL0) | LL_STOP);
        }
    }
}

// --- public API -----------------------------------------------------------

/// Initialise the link-layer engine and run the calibration procedure.
///
/// Must be called once, after `hal::init` and [`crate::clock::enable_lse`].
pub fn init(tx_power: u8) {
    unsafe {
        ll_w(LL_INT_EN, 0x0000_f00f);
        ll_w(LL_RX_BUF, lle_buf_ptr() as u32);
        ll_w(LL_STATUS, 0xffff_ffff);
        rf_w(RF10, 0x480);

        bb_w(BB_CTRL_CFG, bb_r(BB_CTRL_CFG) | 0x0080_0000);
        bb_w(BB_CTRL_CFG, bb_r(BB_CTRL_CFG) | 0x1000_0000);
        bb_w(BB13, 0x1d0);
        bb_w(BB_CTRL_TX, ((tx_power as u32) << 25) | 0x8001_0e78);
        bb_w(
            BB_CTRL_TX,
            (bb_r(BB_CTRL_TX) & 0x81ff_ffff) | (((tx_power & 0x3f) as u32) << 25),
        );
        bb_w(BB8, 0x0009_0083);
    }

    unsafe {
        tune();
        ll_w(LL_TMR0, CLOCK_SPAN);
        ll_w(LL_TMR1, ll_r(LL_TMR0) + CLOCK_SPAN);
        ll_w(LL_STATUS, 0xffff_ffff);

        let mut sctlr = ch5xx_hal::pac::PFIC.sctlr().read();
        sctlr.set_sevonpend(true);
        ch5xx_hal::pac::PFIC.sctlr().write_value(sctlr);
        ch5xx_hal::interrupt::Interrupt::BLEL.enable();
    }
}

/// 单次收发使用的连接参数。CRC 初值采用空口字节序。
#[derive(Clone, Copy)]
pub struct Link {
    pub access: u32,
    pub crc_init: u32,
    pub channel: u8,
    pub phy: Phy,
}

impl Link {
    pub const fn advertising(channel: u8) -> Self {
        Self {
            access: crate::adv::ACCESS_ADDRESS,
            crc_init: 0x55_5555,
            channel,
            phy: Phy::M1,
        }
    }
}

/// 把 PDU 复制到驱动持有的 DMA 缓冲，启动发送调谐。
/// 同一时刻只有一个收发操作；需在 TX 完成或取消后才准备下一帧。
pub fn tx_prepare(link: Link, pdu: &[u8]) -> bool {
    if !(2..=257).contains(&pdu.len()) || link.channel >= 40 {
        return false;
    }
    critical_section::with(|_| unsafe {
        stop();
        ll_w(LL_STATUS, LL_RX | LL_TX);
        TX_DONE.store(0, Ordering::Relaxed);
        let txbuf = core::ptr::addr_of_mut!(TX_BUF.0).cast::<u8>();
        core::ptr::copy_nonoverlapping(pdu.as_ptr(), txbuf, pdu.len());
        txbuf.add(1).write((pdu.len() - 2) as u8);
        ll_w(LL_TX_BUF, txbuf as u32);
        link_config(link);
        set_mode(DEVMODE_TX);
    });
    true
}

/// 发送完成的 LLE 中断时间戳。
pub fn tx_end() -> Option<Instant> {
    (TX_DONE.load(Ordering::Acquire) != 0).then(|| Instant(TX_END.load(Ordering::Relaxed)))
}

/// 在指定频点开启一次接收。
#[highcode]
pub fn rx_start(link: Link) {
    critical_section::with(|_| unsafe {
        stop();
        ll_w(LL_STATUS, LL_RX | LL_TX);
        RX_READY.store(0, Ordering::Relaxed);
        link_config(link);
        set_mode(DEVMODE_RX);
        ll_w(LL0, LL_RX);
    });
}

/// 接收完成的 LLE 中断时间戳。
pub fn rx_end() -> Option<Instant> {
    (RX_READY.load(Ordering::Acquire) != 0).then(|| Instant(RX_END.load(Ordering::Relaxed)))
}

/// 单次接收结果。PDU 存入调用方的缓冲，射频重臂后仍可使用。
pub struct RxFrame<'a> {
    pub pdu: &'a [u8],
    pub rssi: i8,
    pub end: Instant,
    pub crc_ok: bool,
}

pub fn take_rx(out: &mut [u8]) -> Option<RxFrame<'_>> {
    critical_section::with(|_| unsafe {
        let status = RX_READY.swap(0, Ordering::Relaxed);
        if status == 0 {
            return None;
        }
        let src = lle_buf_ptr().cast::<u8>();
        let len = 2 + usize::from(src.add(1).read_volatile());
        let dst = out.get_mut(..len)?;
        core::ptr::copy_nonoverlapping(src, dst.as_mut_ptr(), len);
        Some(RxFrame {
            pdu: dst,
            rssi: ((bb_r(BB_RSSI) >> 15) & 0xff) as u8 as i8,
            end: Instant(RX_END.load(Ordering::Relaxed)),
            crc_ok: src.add(len + 3).read_volatile() & RX_CRC_ERROR == 0,
        })
    })
}
