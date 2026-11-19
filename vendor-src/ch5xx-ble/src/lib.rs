//! WCH CH58x BLE stack shim for `ch5xx-hal` / `ch5xx-metapac`.
//!
//! The CH582/CH583 BLE library is a precompiled WCH blob (`LIBCH58xBLE.a`).
//! This crate keeps the wrapper layer of `ch32-rs/ch58x-hal` (MIT OR
//! Apache-2.0, (c) 2023 Andelf, @611954e) and swaps the PAC and the register
//! touches for the generated `ch5xx-metapac` API used by `ch5xx-hal`.
//!
//! The public API is frozen by `docs/CH5XX_BACKEND_CONTRACT.md` D3. Only the
//! platform-glue functions differ from the legacy crate: temperature, entropy,
//! SysTick rate, the 32 kHz clock setup and the UART log hook.
//!
//! PA control is intentionally not ported in this milestone: the old
//! `PaConfig` path drove GPIO through `ch58x-hal` pin internals. The BLE stack
//! is initialised with the `PaConfig=None` path, i.e. RF power is the chip
//! default and `BLE_PAControlInit` is never called.

#![no_std]
#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]

use core::ffi::CStr;
use core::mem::MaybeUninit;
use core::num::NonZeroU8;

use ch5xx_hal as hal;
use ch5xx_hal::pac;
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::pubsub::{PubSubBehavior, PubSubChannel, Subscriber};

use self::ffi::{tmos_event_hdr_t, tmos_msg_deallocate, tmos_msg_receive, SYS_EVENT_MSG};
use self::ffi::{bleConfig_t, tmos_start_task, BLE_LibInit, BLE_RegInit};

pub mod ffi;
pub mod gap;

// The blob exports the interrupt bodies under these names; the vector entry
// points (`BLEL`/`BLEB` on CH582) are supplied by the application, as in WCH's
// SDK. They are not part of the legacy `ffi.rs`, so they are declared here to
// keep that file byte-identical to upstream.
extern "C" {
    pub fn LLE_IRQLibHandler();
    pub fn BB_IRQLibHandler();
}
// `core::ptr` became unused upstream; keep the verbatim file and silence it here.
#[allow(unused_imports)]
pub mod gatt;
pub mod gatt_uuid;
pub mod gattservapp;
pub mod linkdb;

/// M18 convenience layer: GATT client event decoding, discovery/read/write
/// wrappers, and variable-length notify/indicate helpers.
pub mod client;

/// Maximum SRAM reserved for the BLE library heap.
///
/// The static array is sized for the largest supported `Options::mem_len`
/// (10 KiB). Only `Options::mem_len` bytes are handed to `BLE_LibInit` as
/// `MEMLen`; the remainder is unused but still occupies `.bss`, so the real
/// SRAM cost of this crate is this constant regardless of configuration.
const HEAP_MAX_SIZE: usize = 1024 * 10;

#[repr(C, align(4))]
struct BLEHeap([MaybeUninit<u8>; HEAP_MAX_SIZE]);
static mut BLE_HEAP: BLEHeap = BLEHeap([MaybeUninit::uninit(); HEAP_MAX_SIZE]);

/// BLE library memory/connection options (`init_with`).
///
/// Defaults reproduce the M17 shim and the upstream `ch58x-hal` values, so
/// `init(Config { .. })` behaves exactly as before.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    /// `bleConfig_t::BufMaxLen`: HCI data payload size. ATT MTU = this - 4.
    /// 27 -> MTU 23. Must be > 69 when Secure Connections are enabled.
    pub buf_max_len: u16,
    /// `bleConfig_t::MEMLen`: bytes of the 10 KiB static heap actually used.
    /// The header requires > 4 KiB. Values above 10 KiB are rejected.
    pub mem_len: u16,
    /// `bleConfig_t::ConnectNumber`: low two bits = peripheral count,
    /// high bits = central count (0x0D = 1 peripheral + 3 central).
    pub connect_number: u8,
    /// `bleConfig_t::BufNumber`: cached controller packets, must exceed the
    /// number of connections.
    pub buf_number: u8,
    /// `bleConfig_t::TxPower`: one of the `LL_TX_POWEER_*` constants.
    pub tx_power: u8,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            buf_max_len: 27,
            mem_len: 6144,
            connect_number: 0x0D,
            buf_number: 5,
            tx_power: ffi::LL_TX_POWEER_6_DBM,
        }
    }
}

/// `bleConfig_t::MEMLen` was rejected before `BLE_LibInit` (INVALID_MEM_SIZE).
const INVALID_MEM_SIZE: u8 = 0x0B;

static CHANNEL: PubSubChannel<CriticalSectionRawMutex, TmosEvent, 4, 2, 2> = PubSubChannel::new();

pub type EventSubscriber = Subscriber<'static, CriticalSectionRawMutex, TmosEvent, 4, 2, 2>;

#[derive(Clone, Debug)]
pub struct TmosEvent(pub *mut tmos_event_hdr_t);

unsafe impl Send for TmosEvent {}
unsafe impl Sync for TmosEvent {}

impl TmosEvent {
    /// Incoming GATT message
    pub const GATT_MSG_EVENT: u8 = 0xB0;
    /// Incoming GATT ServApp message
    pub const GATT_SERV_MSG_EVENT: u8 = 0xB1;
    /// Incoming GAP message
    pub const GAP_MSG_EVENT: u8 = 0xD0;

    #[inline(always)]
    pub fn message_id(&self) -> u8 {
        unsafe { (*self.0).event }
    }
}

impl Drop for TmosEvent {
    fn drop(&mut self) {
        unsafe {
            let _ = tmos_msg_deallocate(self.0 as *mut u8);
        }
    }
}

/// BLE stack configuration (D3).
pub struct Config {
    /// MAC address in the library's byte order (LSB first).
    pub mac_lsb: [u8; 6],
    /// `bleConfig_t.SelRTCClock`: 0 = LSE 32768 Hz, 1 = LSI 32000 Hz,
    /// 2 = LSI 32768 Hz.
    pub sel_rtc_clock: u8,
    /// Optional LSI calibration callback (`bleConfig_t.rcCB`).
    pub rc_cb: Option<unsafe extern "C" fn()>,
}

const HAL_REG_INIT_EVENT: u16 = 0x2000;

// 120s in 625us unit(ticks)
const HAL_TMOS_TASK_INTERVAL: u32 = (120000) * 1000 / 625;

unsafe extern "C" fn hal_tmos_task(task_id: u8, events: u16) -> u16 {
    if events & SYS_EVENT_MSG != 0 {
        let msg = tmos_msg_receive(task_id);
        if !msg.is_null() {
            let event = TmosEvent(msg as _);
            CHANNEL.publish_immediate(event);
            // Dealloc in Drop
        }
        events ^ SYS_EVENT_MSG
    } else if events & HAL_REG_INIT_EVENT != 0 {
        BLE_RegInit();

        tmos_start_task(task_id, HAL_REG_INIT_EVENT, HAL_TMOS_TASK_INTERVAL);
        events ^ HAL_REG_INIT_EVENT
    } else {
        crate::println!("!! hal_tmos_task: task_id: {}, events: 0x{:04x}", task_id, events);

        // assume all events are handled here
        0
    }
}

/// Wrapper of `BLE_LibInit` and the TMOS HAL task registration.
///
/// Equivalent to `init_with(config, Options::default())`; keeps the frozen
/// M17 API (generator output only constructs the three-field [`Config`]).
///
/// Does **not** touch the SysTick control register: `ch5xx_hal::init` has
/// already started it as a free-running counter, and [`srand`] only samples it
/// for entropy.
pub fn init(config: Config) -> Result<(u8, EventSubscriber), NonZeroU8> {
    init_with(config, Options::default())
}

/// Configurable variant of [`init`] for EVT cross-checking (MTU, multi-link).
///
/// Boundaries kept deliberately honest:
/// - SNV (bonding persistence) stays **off**: `SNVAddr`/`SNVBlock`/`SNVNum`
///   and `readFlashCB`/`writeFlashCB` remain zero/`None`.
/// - `sleepCB`/`WakeUpTime`/`staCB` remain unset (no low-power integration).
/// - `TxNumEvent` stays 1, matching the M17 shim.
/// - Only `opts.mem_len` bytes of the 10 KiB static heap are passed to the
///   library; the whole array is still reserved in `.bss`.
pub fn init_with(config: Config, opts: Options) -> Result<(u8, EventSubscriber), NonZeroU8> {
    use ffi::{TMOS_ProcessEventRegister, TMOS_TimerInit};

    const BLE_TX_NUM_EVENT: u8 = 1;

    if opts.mem_len as usize > HEAP_MAX_SIZE {
        // NonZeroU8::new(INVALID_MEM_SIZE) is always Some; avoid panicking.
        return Err(unsafe { NonZeroU8::new_unchecked(INVALID_MEM_SIZE) });
    }

    let mut cfg: bleConfig_t = unsafe { core::mem::zeroed() };

    cfg.MEMAddr = unsafe { core::ptr::addr_of_mut!(BLE_HEAP.0) as *mut u8 as u32 };
    cfg.MEMLen = opts.mem_len;

    cfg.BufMaxLen = opts.buf_max_len;
    cfg.BufNumber = opts.buf_number;
    cfg.TxNumEvent = BLE_TX_NUM_EVENT;
    cfg.TxPower = opts.tx_power;

    // No SNV (SNVAddr, SNVBlock, SNVNum, readFlashCB, writeFlashCB):
    // bonding information is RAM-only in this shim.

    cfg.SelRTCClock = config.sel_rtc_clock;

    cfg.ConnectNumber = opts.connect_number;

    cfg.srandCB = Some(srand); // tmos_rand will call this

    cfg.rcCB = config.rc_cb;
    cfg.tsCB = Some(temperature_raw);

    // No HAL_SLEEP(WakeUpTIme, sleepCB)

    cfg.MacAddr = config.mac_lsb;

    unsafe {
        BLE_LibInit(&cfg)?;

        TMOS_TimerInit(core::ptr::null_mut())?;

        // register HAL tmos task
        let hal_task_id = TMOS_ProcessEventRegister(Some(hal_tmos_task));

        tmos_start_task(hal_task_id, HAL_REG_INIT_EVENT, HAL_TMOS_TASK_INTERVAL);

        Ok((hal_task_id, CHANNEL.subscriber().unwrap()))
    }
}

/// Entropy source for `tmos_rand`.
///
/// On `ch5xx-metapac` the SysTick counter is exposed as its 64-bit
/// `CNT`/`CNTL`+`CNTH` view, so the low half is the equivalent of the legacy
/// `CNT` read.
pub unsafe extern "C" fn srand() -> u32 {
    pac::SYSTICK.cnt().read() as u32
}

/// Get a temperature reading in raw ADC value.
///
/// Saves and restores every register the conversion touches. The touch-key
/// block shares the converter and is the `TKEY_CFG` the legacy PAC exposed
/// from the `SYS` block; `ch5xx-metapac` models it as its own `TOUCHKEY` block
/// at the same base address, hence the one deliberate access-path difference
/// from the contract's `pac::SYS.tkey_cfg()` wording.
pub unsafe extern "C" fn temperature_raw() -> u16 {
    let tkey_cfg = pac::TOUCHKEY.cfg().read();
    let tem_sensor = pac::ADC.tem_sensor().read();
    let channel = pac::ADC.channel().read();
    let cfg = pac::ADC.cfg().read();

    // `adc::Config` is `#[non_exhaustive]`, so start from the default and
    // replace the two fields D3 names.
    let mut adc_config = hal::adc::Config::default();
    adc_config.gain = hal::adc::Gain::Unity;
    adc_config.sample_clock = hal::adc::SampleClock::Divide3;

    let peri = unsafe { hal::peripherals::ADC::steal() };
    let mut adc = hal::adc::Adc::new(peri, adc_config);
    let mut temp_sensor = adc.enable_temperature();
    let data = adc.blocking_read(&mut temp_sensor).unwrap_or(0);

    core::mem::forget(adc);

    // restore regs
    pac::TOUCHKEY.cfg().write_value(tkey_cfg);
    pac::ADC.tem_sensor().write_value(tem_sensor);
    pac::ADC.channel().write_value(channel);
    pac::ADC.cfg().write_value(cfg);

    data
}

/// "CH58x_BLE_LIB_V1.9"
pub fn lib_version() -> &'static str {
    unsafe {
        let version = CStr::from_ptr(ffi::VER_LIB.as_ptr());
        version.to_str().unwrap()
    }
}

/// Library format MAC Address, LSB first
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MacAddress([u8; 6]);

impl MacAddress {
    #[inline(always)]
    pub fn from_raw(addr: [u8; 6]) -> Self {
        MacAddress(addr)
    }

    /// Convert from human readable format, MSB first
    pub fn from_msb(addr: [u8; 6]) -> Self {
        MacAddress([addr[5], addr[4], addr[3], addr[2], addr[1], addr[0]])
    }
}

impl core::fmt::Display for MacAddress {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let MacAddress(addr) = self;
        write!(
            f,
            "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
            addr[5], addr[4], addr[3], addr[2], addr[1], addr[0]
        )
    }
}

impl From<[u8; 6]> for MacAddress {
    fn from(addr: [u8; 6]) -> Self {
        MacAddress::from_msb(addr)
    }
}

// --- 32 kHz clock -----------------------------------------------------------

const SAFE_ACCESS_SIG1: u8 = 0x57;
const SAFE_ACCESS_SIG2: u8 = 0xA8;
const SAFE_ACCESS_SIG0: u8 = 0x00;

/// Run `f` inside a safe-access (SAM) window.
///
/// The clock registers are RWA; the window is about 112 `Tsys` long and must
/// not lose those cycles to an interrupt. Mirrors `ch5xx_hal::rcc`'s private
/// helper, including the prefetch flush WCH's CH58x sequences require.
fn with_safe_access<R>(f: impl FnOnce() -> R) -> R {
    critical_section::with(|_| {
        let sig = pac::SYSTEM_CONTROL.safe_access_sig();
        unsafe { core::arch::asm!("fence.i") };
        sig.write(|w| w.set_safe_access_sig(SAFE_ACCESS_SIG1));
        sig.write(|w| w.set_safe_access_sig(SAFE_ACCESS_SIG2));
        unsafe { core::arch::asm!("fence.i") };
        let result = f();
        sig.write(|w| w.set_safe_access_sig(SAFE_ACCESS_SIG0));
        unsafe { core::arch::asm!("fence.i") };
        result
    })
}

fn delay_cycles(cycles: u32) {
    // The legacy code used `riscv::asm::delay(hclk_cycles)`. The ch5xx HAL's
    // SysTick-backed delay is calibrated by `hal::init`, so express the same
    // waits as milliseconds/microseconds.
    let mut delay = hal::delay::Delay;
    let us = u64::from(cycles) * 1_000_000 / u64::from(systick_hz());
    let us = us as u32;
    if us >= 1000 {
        delay.delay_ms(us / 1000);
    }
    if us % 1000 != 0 {
        delay.delay_us(us % 1000);
    }
}

/// Turn the external 32 kHz crystal on and select it as `CK32K`.
///
/// This is the `Clock32KSrc::LSE` branch of the legacy
/// `ch58x-hal/sysctl.rs::freeze()` sequence, translated field-for-field to
/// `ch5xx-metapac`:
///
/// 1. `CK32K_CONFIG.CLK_XT32K_PON = 1` (power the crystal)
/// 2. delay `hclk / 10 / 4` cycles
/// 3. `CK32K_CONFIG.CLK_OSC32K_XT = 1` (select XT over RC)
/// 4. delay `hclk / 1000` cycles
///
/// Call after `ch5xx_hal::init` and before [`init`], when `SelRTCClock=0`.
pub fn enable_lse() {
    with_safe_access(|| {
        pac::SYS
            .ck32k_config()
            .modify(|w| w.set_clk_xt32k_pon(true));
    });
    delay_cycles(systick_hz() / 10 / 4);
    with_safe_access(|| {
        pac::SYS
            .ck32k_config()
            .modify(|w| w.set_clk_osc32k_xt(true));
    });
    delay_cycles(systick_hz() / 1000);
}

/// Select the internal 32 kHz RC (`CK32K_CONFIG.CLK_OSC32K_XT = 0`,
/// `CLK_INT32K_PON = 1`), as the legacy `Clock32KSrc::LSI` branch does.
pub fn set_clock32k_lsi() {
    with_safe_access(|| {
        pac::SYS.ck32k_config().modify(|w| {
            w.set_clk_osc32k_xt(false);
            w.set_clk_int32k_pon(true);
        });
    });
}

/// SysTick input frequency.
///
/// `CTLR.STCLK` selects the core clock (`1`) or the core clock divided by 8
/// (`0`); `ch5xx_hal::init` starts the counter with `STCLK=1`. This is the
/// single source of truth for TMOS pacing and notify periods.
pub fn systick_hz() -> u32 {
    let sysclk = hal::rcc::clocks().sysclk.0;
    if pac::SYSTICK.ctlr().read().stclk() {
        sysclk
    } else {
        sysclk / 8
    }
}

// --- logging ----------------------------------------------------------------

/// Default log sink. `ch5xx-hal` has no `println!`, so the shim carries the
/// legacy hook, retyped for the new three-parameter `UartTx` handle.
pub static mut SERIAL: Option<hal::uart::UartTx<'static, hal::peripherals::UART1, hal::mode::Blocking>> =
    None;

#[macro_export]
macro_rules! println {
    ($($arg:tt)*) => {{
        unsafe {
            use core::fmt::Write as _;

            if let Some(uart) = (*core::ptr::addr_of_mut!($crate::SERIAL)).as_mut() {
                let _ = core::writeln!(uart, $($arg)*);
            }
        }
    }};
}

/// Install the default log sink. Without it [`println!`] is a no-op.
pub fn set_default_serial(
    serial: hal::uart::UartTx<'static, hal::peripherals::UART1, hal::mode::Blocking>,
) {
    unsafe {
        *core::ptr::addr_of_mut!(SERIAL) = Some(serial);
    }
}