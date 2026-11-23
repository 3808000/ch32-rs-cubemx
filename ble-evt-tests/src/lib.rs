//! Clean-room CH583 BLE EVT comparison support library.
//!
//! Everything here is written against the factual parameter tables in
//! `docs/m18-evt-specs.md` and the frozen `ch5xx-ble` shim API
//! (`docs/m17-shim-notes.md`). No EVT `.c`/`.h` source was consulted.
//!
//! The module is deliberately structured as a small application framework:
//! `boot()` performs the documented power-on order, [`run`] is the busy-poll
//! TMOS pump, [`adv`] assembles advertising TLVs, and [`services`] owns the
//! GATT attribute tables used by the individual binaries.

#![no_std]
#![allow(static_mut_refs)]
#![allow(non_upper_case_globals)]

pub use ch5xx_ble as ble;
pub use ch5xx_ble::{ffi, gap, gatt, gatt_uuid, gattservapp, linkdb};
pub use ch5xx_ble::client::GattClientEvent;
pub use ch5xx_ble::ffi::*;
pub use ch5xx_ble::gap::*;
pub use ch5xx_ble::gatt::*;
pub use ch5xx_ble::gattservapp::*;
pub use ch5xx_ble::linkdb::*;
pub use ch5xx_hal as hal;
pub use ch5xx_hal::pac;

use ch5xx_ble::gatt_uuid::{GATT_CHARACTER_UUID, GATT_CLIENT_CHAR_CFG_UUID};

use core::ffi::c_void;

pub mod adv;
pub mod central;
pub mod services;

/// Convenience imports for the binaries.
pub mod prelude {
    pub use crate::adv::{simple_adv, AdvBuilder};
    pub use crate::ble;
    pub use crate::ble::client::GattClientEvent;
    pub use crate::ble::ffi::*;
    pub use crate::ble::gap::*;
    pub use crate::ble::gatt::*;
    pub use crate::ble::gattservapp::*;
    pub use crate::central::SingleLink;
    pub use crate::hal;
    pub use crate::services;
    pub use crate::*;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/// Nominal local address (MSB order `0C:3D:5E:A6:62:94`), LSB-first for the
/// library. The shim takes the address from `bleConfig_t`; the EVT firmware
/// reads the factory address with `GetMACAddress()`, which the shim does not
/// expose. Deviation documented in every binary header.
pub const MAC_DEFAULT_MSB: [u8; 6] = [0x0C, 0x3D, 0x5E, 0xA6, 0x62, 0x94];
/// LSB-first form of [`MAC_DEFAULT_MSB`].
pub const MAC_DEFAULT_LSB: [u8; 6] = [0x94, 0x62, 0xA6, 0x5E, 0x3D, 0x0C];

/// `84:C2:E4:03:02:02` as the EVT SpeedTest_Peripheral / SYNC_ADV build
/// defines it (`BLE_MAC=1`), already in library byte order.
pub const MAC_EVT_BLE_MAC_LSB: [u8; 6] = [0x02, 0x02, 0x03, 0xE4, 0xC2, 0x84];

/// Human-readable name the central-role binaries look for. EVT filters on a
/// fixed MAC; this crate matches the advertising name instead, so the tests
/// do not need an EVT-configured peer address.
pub const PEER_NAME: &str = "M18-PEER";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/// Options for [`boot`].
#[derive(Clone, Copy)]
pub struct BootCfg {
    /// BLE heap / buffer / connection mix.
    pub options: ble::Options,
    /// `config.h CLK_OSC32K`: 0 = external 32.768 kHz, 1 = internal 32 kHz RC.
    pub sel_rtc_clock: u8,
    /// Local address, LSB first.
    pub mac_lsb: [u8; 6],
    /// Optional LSI calibration callback (`rcCB`).
    pub rc_cb: Option<unsafe extern "C" fn()>,
    /// UART1 log baud rate. Default 115200; use 9600 for lossless
    /// diagnostics (the CH-Link serial bridge drops bytes on bursts).
    pub uart_baud: u32,
}

/// Shim defaults (M17/M18): 27-byte HCI payload, 9 KiB heap, 1P+3C, 5 bufs.
///
/// The heap is raised from the M17 6 KiB to 9 KiB for the M18 EVT matrix: the
/// blob's TMOS heap is split into a fixed 512-byte small-object partition
/// (message events) and a large partition, and the HID Touch image left only
/// ~1.2 KiB of the large partition free at advertising time with 6 KiB —
/// the GATT server then failed service discovery with ATT 0x13
/// (= bStatus `bleMemAllocError`, `tmos_msg_allocate` failure). 9 KiB passes
/// (the 10 KiB backing array is statically reserved either way).
pub const OPTIONS_DEFAULT: ble::Options = ble::Options {
    buf_max_len: 27,
    mem_len: 9216,
    connect_number: 0x0D,
    buf_number: 5,
    tx_power: ch5xx_ble::ffi::LL_TX_POWEER_6_DBM,
};

impl BootCfg {
    /// Peripheral defaults: internal 32 kHz RC (`CLK_OSC32K=1`).
    /// Peripheral-role defaults.
    ///
    /// 32K source = **LSE** (external crystal), deviating from EVT's
    /// `CLK_OSC32K=1` (internal RC): with LSI the blob's connection-event
    /// timing drifts against the central's window widening — ATT requests
    /// are missed, service discovery hangs and the link dies by supervision
    /// timeout (reason 0x08). LSE passes the full GATT criteria on hardware
    /// (same source the M17 generator uses). Advertising alone tolerates LSI.
    pub const fn peripheral() -> Self {
        Self {
            options: OPTIONS_DEFAULT,
            sel_rtc_clock: 0,
            mac_lsb: MAC_DEFAULT_LSB,
            rc_cb: None,
            uart_baud: 115200,
        }
    }

    /// Central-role defaults: external 32.768 kHz crystal (`CLK_OSC32K=0`).
    pub const fn central() -> Self {
        Self {
            options: OPTIONS_DEFAULT,
            sel_rtc_clock: 0,
            mac_lsb: MAC_DEFAULT_LSB,
            rc_cb: None,
            uart_baud: 115200,
        }
    }
}

/// Owned HAL peripherals plus the application TMOS task id.
pub struct Boot {
    pub p: hal::Peripherals,
    pub task_id: u8,
}

static mut APP_TASK_ID: u8 = INVALID_TASK_ID;
static mut APP_HANDLER: Option<unsafe fn(u8, *mut u8)> = None;
static mut GAP_HANDLER: Option<unsafe fn(*mut gapRoleEvent_t)> = None;

/// Install the per-binary TMOS message handler (`event`, raw message).
pub fn set_app_handler(handler: unsafe fn(u8, *mut u8)) {
    unsafe { APP_HANDLER = Some(handler) };
}

/// Install the handler used by central-style GAP role callbacks.
pub fn set_gap_handler(handler: unsafe fn(*mut gapRoleEvent_t)) {
    unsafe { GAP_HANDLER = Some(handler) };
}

/// Application task id, valid after [`boot`].
pub fn task_id() -> u8 {
    unsafe { APP_TASK_ID }
}

unsafe extern "C" fn app_task(task_id: u8, events: u16) -> u16 {
    if events & SYS_EVENT_MSG == 0 {
        return 0;
    }
    let msg = tmos_msg_receive(task_id);
    if !msg.is_null() {
        let event = (*(msg as *const tmos_event_hdr_t)).event;
        if let Some(handler) = APP_HANDLER {
            handler(event, msg);
        }
        let _ = tmos_msg_deallocate(msg);
    }
    events & !SYS_EVENT_MSG
}

/// BLEB/BLEL ISR wrappers saving **every integer register**.
///
/// An asynchronous handler must preserve the interrupted context completely:
/// the blob's `*_IRQLibHandler` is ordinary C code and is free to clobber all
/// caller-saved registers (ra, t0–t6, a0–a7). Saving only the callee-saved
/// set (the previous version of this macro) leaves a hole: an interrupt
/// landing between a value's computation and its first use corrupts it.
///
/// Observed twice with this signature: `lw a4,...` computes a global address,
/// BLEB/BLEL fires, the handler clobbers a4, and the interrupted code stores
/// the garbage into a callee-saved register (`s1 = 0xffffff82`) and faults
/// (illegal-instruction/`Load address misaligned`, mcause 2/4) at whatever
/// pointer it touches next. Under GATT-client load the interrupt rate makes
/// it deterministic within seconds; provider/peripheral-only tests mostly got
/// away with it.
///
/// The frame is 128 bytes (16-byte aligned) and also parks gp/tp so the
/// handler's ABI assumptions cannot leak state either way.
#[macro_export]
macro_rules! ble_isr {
    () => {
        core::arch::global_asm!(
            ".section .trap, \"ax\"",
            ".align 2",
            ".global BLEB",
            "BLEB:",
            "addi sp, sp, -128",
            "sw ra, 0(sp)",
            "sw gp, 4(sp)",
            "sw tp, 8(sp)",
            "sw t0, 12(sp)",
            "sw t1, 16(sp)",
            "sw t2, 20(sp)",
            "sw t3, 24(sp)",
            "sw t4, 28(sp)",
            "sw t5, 32(sp)",
            "sw t6, 36(sp)",
            "sw a0, 40(sp)",
            "sw a1, 44(sp)",
            "sw a2, 48(sp)",
            "sw a3, 52(sp)",
            "sw a4, 56(sp)",
            "sw a5, 60(sp)",
            "sw a6, 64(sp)",
            "sw a7, 68(sp)",
            "sw s0, 72(sp)",
            "sw s1, 76(sp)",
            "sw s2, 80(sp)",
            "sw s3, 84(sp)",
            "sw s4, 88(sp)",
            "sw s5, 92(sp)",
            "sw s6, 96(sp)",
            "sw s7, 100(sp)",
            "sw s8, 104(sp)",
            "sw s9, 108(sp)",
            "sw s10, 112(sp)",
            "sw s11, 116(sp)",
            "1: auipc t1, %pcrel_hi(BB_IRQLibHandler)",
            "jalr t1, %pcrel_lo(1b)(t1)",
            "lw ra, 0(sp)",
            "lw gp, 4(sp)",
            "lw tp, 8(sp)",
            "lw t0, 12(sp)",
            "lw t1, 16(sp)",
            "lw t2, 20(sp)",
            "lw t3, 24(sp)",
            "lw t4, 28(sp)",
            "lw t5, 32(sp)",
            "lw t6, 36(sp)",
            "lw a0, 40(sp)",
            "lw a1, 44(sp)",
            "lw a2, 48(sp)",
            "lw a3, 52(sp)",
            "lw a4, 56(sp)",
            "lw a5, 60(sp)",
            "lw a6, 64(sp)",
            "lw a7, 68(sp)",
            "lw s0, 72(sp)",
            "lw s1, 76(sp)",
            "lw s2, 80(sp)",
            "lw s3, 84(sp)",
            "lw s4, 88(sp)",
            "lw s5, 92(sp)",
            "lw s6, 96(sp)",
            "lw s7, 100(sp)",
            "lw s8, 104(sp)",
            "lw s9, 108(sp)",
            "lw s10, 112(sp)",
            "lw s11, 116(sp)",
            "addi sp, sp, 128",
            "mret",
            ".global BLEL",
            "BLEL:",
            "addi sp, sp, -128",
            "sw ra, 0(sp)",
            "sw gp, 4(sp)",
            "sw tp, 8(sp)",
            "sw t0, 12(sp)",
            "sw t1, 16(sp)",
            "sw t2, 20(sp)",
            "sw t3, 24(sp)",
            "sw t4, 28(sp)",
            "sw t5, 32(sp)",
            "sw t6, 36(sp)",
            "sw a0, 40(sp)",
            "sw a1, 44(sp)",
            "sw a2, 48(sp)",
            "sw a3, 52(sp)",
            "sw a4, 56(sp)",
            "sw a5, 60(sp)",
            "sw a6, 64(sp)",
            "sw a7, 68(sp)",
            "sw s0, 72(sp)",
            "sw s1, 76(sp)",
            "sw s2, 80(sp)",
            "sw s3, 84(sp)",
            "sw s4, 88(sp)",
            "sw s5, 92(sp)",
            "sw s6, 96(sp)",
            "sw s7, 100(sp)",
            "sw s8, 104(sp)",
            "sw s9, 108(sp)",
            "sw s10, 112(sp)",
            "sw s11, 116(sp)",
            "1: auipc t1, %pcrel_hi(LLE_IRQLibHandler)",
            "jalr t1, %pcrel_lo(1b)(t1)",
            "lw ra, 0(sp)",
            "lw gp, 4(sp)",
            "lw tp, 8(sp)",
            "lw t0, 12(sp)",
            "lw t1, 16(sp)",
            "lw t2, 20(sp)",
            "lw t3, 24(sp)",
            "lw t4, 28(sp)",
            "lw t5, 32(sp)",
            "lw t6, 36(sp)",
            "lw a0, 40(sp)",
            "lw a1, 44(sp)",
            "lw a2, 48(sp)",
            "lw a3, 52(sp)",
            "lw a4, 56(sp)",
            "lw a5, 60(sp)",
            "lw a6, 64(sp)",
            "lw a7, 68(sp)",
            "lw s0, 72(sp)",
            "lw s1, 76(sp)",
            "lw s2, 80(sp)",
            "lw s3, 84(sp)",
            "lw s4, 88(sp)",
            "lw s5, 92(sp)",
            "lw s6, 96(sp)",
            "lw s7, 100(sp)",
            "lw s8, 104(sp)",
            "lw s9, 108(sp)",
            "lw s10, 112(sp)",
            "lw s11, 116(sp)",
            "addi sp, sp, 128",
            "mret",
        );
    };
}

/// Power-on sequence shared by every binary.
///
/// Order (spec §0.2/§0.3): `hal::init` at 60 MHz, 32 kHz source, UART1 log,
/// `BLE_LibInit`, application task, BLE interrupt vectors.
pub fn boot(cfg: BootCfg) -> Boot {
    // M18 bisect 注记：此处曾有 `_ebss..sp-2KiB` 预清零（怀疑 orphan .bss 脏态）。
    // 后续 UART 直证表明 peripheral 静默的真实根因是漏调 GAPRole_PeripheralInit，
    // 预清零与本缺陷无关；且 M17 生成器产物（无预清零）实机 GATT 全通。
    // 移除以对齐 M17 启动路径（A/B 实证）。

    let p = hal::init(hal::Config {
        rcc: hal::rcc::Config::PLL_60MHZ,
    });

    if cfg.sel_rtc_clock == 0 {
        ble::enable_lse();
    } else {
        ble::set_clock32k_lsi();
    }

    unsafe {
        let serial = hal::uart::UartTx::new_blocking::<0>(
            hal::peripherals::UART1::steal(),
            hal::peripherals::PA9::steal(),
            hal::uart::Config::new(cfg.uart_baud),
        )
        .unwrap();
        ble::set_default_serial(serial);
    }

    ble::println!();
    ble::println!("=== M18 BLE EVT cross-check ===");
    ble::println!("library {}", ble::lib_version());
    ble::println!("mac {}", ble::MacAddress::from_raw(cfg.mac_lsb));
    ble::println!("systick_hz {}", ble::systick_hz());

    // M17 A/B：直接使用 shim 的 hal TMOS 任务（M17 生成器把该 task_id 传给
    // *StartDevice；事件经 hal_tmos_task → pubsub → run() drain）。不再额外
    // 注册 app_task——独立任务槽 + 把 app_task 传给 StartDevice 的组合在实机
    // 上导致 GATT 发现无响应（M17 参照产物同板同时刻全通）。
    let (task_id, subscriber) = ble::init_with(
        ble::Config {
            mac_lsb: cfg.mac_lsb,
            sel_rtc_clock: cfg.sel_rtc_clock,
            rc_cb: cfg.rc_cb,
        },
        cfg.options,
    )
    .expect("BLE_LibInit failed");
    unsafe { EVENT_SUB = Some(subscriber) };
    unsafe { APP_TASK_ID = task_id };

    unsafe {
        use hal::interrupt::InterruptExt as _;
        hal::interrupt::Interrupt::BLEB.enable();
        hal::interrupt::Interrupt::BLEL.enable();
    }

    Boot { p, task_id }
}

// ---------------------------------------------------------------------------
// GAP callbacks shared by the binaries
// ---------------------------------------------------------------------------

pub unsafe extern "C" fn gap_state_change(state: u32, event: *mut gapRoleEvent_t) {
    ble::println!("gap state {}", state);
    // WCH peripheral role delivers link events through the state-change
    // callback's pEvent (not as TMOS messages to the app task); forward to
    // the per-binary handler so connect/disconnect bookkeeping runs.
    if !event.is_null() {
        if let Some(handler) = GAP_HANDLER {
            handler(event);
        }
    }
    if state == GAPROLE_WAITING {
        // Resume advertising after a disconnect (EVT peripheral behavior).
        adv_enable(true);
    }
}

pub unsafe extern "C" fn gap_param_update(
    conn: u16,
    interval: u16,
    latency: u16,
    timeout: u16,
) {
    ble::println!(
        "conn 0x{:04x} interval {} ({} ms) latency {} timeout {}",
        conn,
        interval,
        interval as u32 * 5 / 4,
        latency,
        timeout
    );
}

pub unsafe extern "C" fn gap_rssi(conn: u16, rssi: i8) {
    ble::println!("conn 0x{:04x} rssi {}", conn, rssi);
}

pub unsafe extern "C" fn gap_passcode(
    _addr: *mut u8,
    conn: u16,
    _inputs: u8,
    _outputs: u8,
) {
    let _ = GAPBondMgr_PasscodeRsp(conn, 0, 0);
}

static GAP_BOND_CBS: gapBondCBs_t = gapBondCBs_t {
    passcodeCB: Some(gap_passcode),
    pairStateCB: None,
    oobCB: None,
};

static GAP_ROLE_CBS: gapRolesCBs_t = gapRolesCBs_t {
    pfnStateChange: Some(gap_state_change),
    pfnRssiRead: Some(gap_rssi),
    pfnParamUpdate: Some(gap_param_update),
};

/// Bond-manager callback table with the documented passkey reply.
pub fn bond_cbs() -> &'static gapBondCBs_t {
    &GAP_BOND_CBS
}

/// Peripheral role callback table.
pub fn role_cbs() -> &'static gapRolesCBs_t {
    &GAP_ROLE_CBS
}

unsafe extern "C" fn central_gap_cb(event: *mut gapRoleEvent_t) {
    if let Some(handler) = GAP_HANDLER {
        handler(event);
    }
}

static GAP_CENTRAL_CBS: gapCentralRoleCB_t = gapCentralRoleCB_t {
    rssiCB: Some(gap_rssi),
    eventCB: Some(central_gap_cb),
    ChangCB: None,
};

/// Central role callback table.
pub fn central_cbs() -> &'static gapCentralRoleCB_t {
    &GAP_CENTRAL_CBS
}

unsafe extern "C" fn observer_event_cb(event: &gapRoleEvent_t) {
    if let Some(handler) = GAP_HANDLER {
        handler(event as *const gapRoleEvent_t as *mut gapRoleEvent_t);
    }
}

static GAP_OBSERVER_CBS: gapRoleObserverCB_t = gapRoleObserverCB_t {
    eventCB: Some(observer_event_cb),
};

/// Observer role callback table.
pub fn observer_cbs() -> &'static gapRoleObserverCB_t {
    &GAP_OBSERVER_CBS
}

unsafe extern "C" fn broadcaster_state(state: u32) {
    ble::println!("broadcaster state {}", state);
}

static GAP_BROADCASTER_CBS: gapRolesBroadcasterCBs_t = gapRolesBroadcasterCBs_t {
    pfnStateChange: Some(broadcaster_state),
    pfnScanRecv: None,
};

/// Broadcaster role callback table.
pub fn broadcaster_cbs() -> &'static gapRolesBroadcasterCBs_t {
    &GAP_BROADCASTER_CBS
}

// ---------------------------------------------------------------------------
// Bond manager parameters
// ---------------------------------------------------------------------------

fn set_bond_u8(param: u16, value: u8) {
    unsafe {
        let _ = GAPBondMgr_SetParameter(param, 1, &value as *const u8 as *const c_void);
    }
}

fn set_bond_u32(param: u16, value: u32) {
    unsafe {
        let _ = GAPBondMgr_SetParameter(param, 4, &value as *const u32 as *const c_void);
    }
}

/// Apply the peripheral-role pairing values from the spec tables.
pub fn bond_peripheral(mitm: bool, io_cap: u8) {
    set_bond_u8(GAPBOND_PERI_PAIRING_MODE, GAPBOND_PAIRING_MODE_WAIT_FOR_REQ);
    set_bond_u8(GAPBOND_PERI_MITM_PROTECTION, mitm as u8);
    set_bond_u8(GAPBOND_PERI_BONDING_ENABLED, 1);
    set_bond_u8(GAPBOND_PERI_IO_CAPABILITIES, io_cap);
    set_bond_u32(GAPBOND_PERI_DEFAULT_PASSCODE, 0);
}

/// Apply the central-role pairing values from the spec tables.
pub fn bond_central(mitm: bool, io_cap: u8) {
    set_bond_u8(GAPBOND_CENT_PAIRING_MODE, GAPBOND_PAIRING_MODE_WAIT_FOR_REQ);
    set_bond_u8(GAPBOND_CENT_MITM_PROTECTION, mitm as u8);
    set_bond_u8(GAPBOND_CENT_BONDING_ENABLED, 1);
    set_bond_u8(GAPBOND_CENT_IO_CAPABILITIES, io_cap);
    set_bond_u32(GAPBOND_CENT_DEFAULT_PASSCODE, 0);
}

/// `GAPBOND_AUTO_SYNC_WL=FALSE` as the CSC/RSC examples set it.
pub fn bond_no_white_list_sync() {
    set_bond_u8(GAPBOND_AUTO_SYNC_WL, 0);
}

// ---------------------------------------------------------------------------
// GAP / GATT parameter helpers
// ---------------------------------------------------------------------------

pub fn set_gap_param(id: u16, value: u16) {
    unsafe {
        let _ = GAP_SetParamValue(id, value);
    }
}

pub fn set_role_u8(param: u16, value: u8) {
    unsafe {
        let _ = GAPRole_SetParameter(param, 1, &value as *const u8 as *const c_void);
    }
}

pub fn set_role_u16(param: u16, value: u16) {
    unsafe {
        let _ = GAPRole_SetParameter(param, 2, &value as *const u16 as *const c_void);
    }
}

pub fn set_adv_data(data: &[u8]) {
    unsafe {
        let _ = GAPRole_SetParameter(
            GAPROLE_ADVERT_DATA,
            data.len() as u16,
            data.as_ptr() as *const c_void,
        );
    }
}

pub fn set_scan_rsp(data: &[u8]) {
    unsafe {
        let _ = GAPRole_SetParameter(
            GAPROLE_SCAN_RSP_DATA,
            data.len() as u16,
            data.as_ptr() as *const c_void,
        );
    }
}

pub fn set_device_name(name: &str) {
    unsafe {
        let _ = GGS_SetParameter(
            GGS_DEVICE_NAME_ATT,
            name.len() as u8,
            name.as_ptr() as *mut c_void,
        );
    }
}

pub fn set_appearance(appearance: u16) {
    unsafe {
        let _ = GGS_SetParameter(
            GGS_APPEARANCE_ATT,
            2,
            &appearance as *const u16 as *mut c_void,
        );
    }
}

pub fn adv_enable(on: bool) {
    set_role_u8(GAPROLE_ADVERT_ENABLED, on as u8);
}

pub fn set_adv_interval(units: u16) {
    set_gap_param(TGAP_DISC_ADV_INT_MIN, units);
    set_gap_param(TGAP_DISC_ADV_INT_MAX, units);
}

pub fn set_adv_type(adv_type: u8) {
    set_role_u8(GAPROLE_ADV_EVENT_TYPE, adv_type);
}

/// Peripheral desired connection parameters (units: 1.25 ms / 10 ms).
pub fn set_peripheral_conn(min: u16, max: u16, latency: u16, timeout: u16) {
    set_role_u16(GAPROLE_MIN_CONN_INTERVAL, min);
    set_role_u16(GAPROLE_MAX_CONN_INTERVAL, max);
    set_gap_param(TGAP_CONN_EST_LATENCY, latency);
    set_gap_param(TGAP_CONN_EST_SUPERV_TIMEOUT, timeout);
}

/// Central link-establishment parameters (units: 1.25 ms / 10 ms).
pub fn set_central_conn(min: u16, max: u16, latency: u16, timeout: u16) {
    set_gap_param(TGAP_CONN_EST_INT_MIN, min);
    set_gap_param(TGAP_CONN_EST_INT_MAX, max);
    set_gap_param(TGAP_CONN_EST_LATENCY, latency);
    set_gap_param(TGAP_CONN_EST_SUPERV_TIMEOUT, timeout);
}

/// Register the peripheral role's TMOS task.
///
/// M17 hardware-passing order requires this **before** service registration
/// (GGS/GATTServApp/register_service); with the role task absent the GATT
/// server accepts registrations but never answers discovery. Call right after
/// `boot`, ahead of bond/service/adv setup.
pub fn peripheral_role_init() {
    unsafe {
        let _ = GAPRole_PeripheralInit();
    }
}

/// Start the peripheral role and enable advertising.
///
/// [`peripheral_role_init`] must have run earlier (before services); the
/// redundant Init here keeps standalone callers safe (second call returns
/// bleAlreadyInRequestedMode, ignored).
pub fn start_peripheral(task: u8) {
    peripheral_role_init();
    let _ = start_peripheral_device(task);
}

/// Start the peripheral role device **without** re-running `PeripheralInit`.
///
/// Multi-role binaries (CentPeri, MultiCentPeri) must keep the combined role
/// mask produced by the two role inits: re-running `PeripheralInit` after the
/// central init drops the central bit, and the subsequent
/// `GAPRole_CentralStartDiscovery` fails with bleIncorrectMode (0x12).
pub fn start_peripheral_device(task: u8) -> bStatus_t {
    // M17 order: advertising enabled BEFORE StartDevice (A/B-verified —
    // enabling only afterwards leaves the GATT server silent in discovery).
    adv_enable(true);
    unsafe { GAPRole_PeripheralStartDevice(task, &GAP_BOND_CBS, &GAP_ROLE_CBS) }
}

/// Add the mandatory GAP/GATT server services before custom services.
pub fn add_gatt_services() {
    unsafe {
        let _ = GGS_AddService(GATT_ALL_SERVICES);
        let _ = GATTServApp::add_service(GATT_ALL_SERVICES);
    }
}

/// Initialise the central role and its GATT client.
pub fn start_central_role(task: u8) {
    central_role_init();
    let _ = start_central_device(task);
}

/// Central-role Init only (no StartDevice).
///
/// Multi-role binaries (CentPeri, MultiCentPeri) must initialise **both**
/// roles before configuring parameters or starting either device: each role
/// init calls `GAP_Init`, which resets shared GAP state, so
/// `PeripheralStartDevice` followed by `CentralInit` leaves the peripheral
/// face dead (observed: no advertising, no scan results until power cycle).
pub fn central_role_init() {
    unsafe {
        let _ = GAPRole_CentralInit();
    }
}

/// Start the central role's GATT client and device task (Init already done).
///
/// Returns the `GAPRole_CentralStartDevice` status so multi-role binaries can
/// surface it (a second role's StartDevice resets the link layer; the status
/// tells whether this face actually came up).
pub fn start_central_device(task: u8) -> bStatus_t {
    unsafe {
        let _ = GATT_InitClient();
        GATT_RegisterForInd(task);
        GATT_RegisterForReq(task);
        let bond = &GAP_BOND_CBS as *const gapBondCBs_t as *mut gapBondCBs_t;
        let cbs = &GAP_CENTRAL_CBS as *const gapCentralRoleCB_t as *mut gapCentralRoleCB_t;
        GAPRole_CentralStartDevice(task, bond, cbs)
    }
}

/// Start an active/passive central scan.
///
/// `scan_units` is in 0.625 ms Tick units (`TGAP_DISC_SCAN`). Returns the
/// discovery status (multi-role bring-up needs to see it).
pub fn start_scan_status(scan_units: u16, max_results: u8, active: bool) -> bStatus_t {
    set_gap_param(TGAP_DISC_SCAN, scan_units);
    set_role_u8(GAPROLE_MAX_SCAN_RES, max_results);
    unsafe { GAPRole_CentralStartDiscovery(DEVDISC_MODE_ALL, active as u8, 0) }
}

/// [`start_scan_status`] without the status.
pub fn start_scan(scan_units: u16, max_results: u8, active: bool) {
    let _ = start_scan_status(scan_units, max_results, active);
}

/// Establish a link to a peer address (LSB-first, stack order).
pub fn establish_link(addr_type: u8, addr: &[u8; 6]) -> bStatus_t {
    GAPRole::central_establish_link(false, false, addr_type, addr)
}

// ---------------------------------------------------------------------------
// GATT server dispatch
// ---------------------------------------------------------------------------

const MAX_NOTE_VALUES: usize = 96;

static mut NOTE_PTRS: [*const u8; MAX_NOTE_VALUES] = [core::ptr::null(); MAX_NOTE_VALUES];
static mut NOTE_READ_LEN: [u16; MAX_NOTE_VALUES] = [0; MAX_NOTE_VALUES];
static mut NOTE_WRITE_CAP: [u16; MAX_NOTE_VALUES] = [0; MAX_NOTE_VALUES];
static mut NOTE_COUNT: usize = 0;

/// Register the readable/writable extent of one attribute value.
pub fn note_value(ptr: *const u8, read_len: u16, write_cap: u16) {
    unsafe {
        let mut i = 0;
        while i < NOTE_COUNT {
            if NOTE_PTRS[i] == ptr {
                NOTE_READ_LEN[i] = read_len;
                NOTE_WRITE_CAP[i] = write_cap;
                return;
            }
            i += 1;
        }
        if NOTE_COUNT < MAX_NOTE_VALUES {
            NOTE_PTRS[NOTE_COUNT] = ptr;
            NOTE_READ_LEN[NOTE_COUNT] = read_len;
            NOTE_WRITE_CAP[NOTE_COUNT] = write_cap;
            NOTE_COUNT += 1;
        }
    }
}

fn note_index(ptr: *const u8) -> Option<usize> {
    unsafe {
        let mut i = 0;
        while i < NOTE_COUNT {
            if NOTE_PTRS[i] == ptr {
                return Some(i);
            }
            i += 1;
        }
        None
    }
}

/// Change the number of bytes returned by a read (dynamic response lengths).
pub fn set_read_len(ptr: *const u8, len: u16) {
    unsafe {
        if let Some(i) = note_index(ptr) {
            NOTE_READ_LEN[i] = len;
        }
    }
}

/// Write-callback hook. Called after the new bytes were copied into the
/// attribute value buffer. Returning non-zero becomes the ATT error code.
pub type WriteHook = unsafe fn(u16, *mut GattAttribute, u16) -> u8;

/// CCCD write hook, called for every accepted CCCD write.
pub type CccdHook = unsafe fn(u16, *mut GattAttribute);

static mut WRITE_HOOK: Option<WriteHook> = None;
static mut CCCD_HOOK: Option<CccdHook> = None;

pub fn set_write_hook(hook: WriteHook) {
    unsafe { WRITE_HOOK = Some(hook) };
}

pub fn set_cccd_hook(hook: CccdHook) {
    unsafe { CCCD_HOOK = Some(hook) };
}

fn is_cccd(attr: &GattAttribute) -> bool {
    attr.type_.len == 2 && attr.type_ == GATT_CLIENT_CHAR_CFG_UUID
}

unsafe extern "C" fn read_attr_cb(
    conn: u16,
    p_attr: *mut GattAttribute,
    p_value: *mut u8,
    p_len: *mut u16,
    offset: u16,
    max_len: u16,
    _method: u8,
) -> u8 {
    if p_attr.is_null() || p_value.is_null() || p_len.is_null() {
        return ATT_ERR_INVALID_HANDLE;
    }
    let attr = &*p_attr;
    *p_len = 0;

    if is_cccd(attr) {
        let cfg = GATTServApp::read_char_cfg(conn, attr.value as *const gattCharCfg_t);
        let bytes = [cfg as u8, (cfg >> 8) as u8];
        if offset as usize >= bytes.len() {
            return ATT_ERR_INVALID_OFFSET;
        }
        let n = core::cmp::min(max_len as usize, bytes.len() - offset as usize);
        core::ptr::copy_nonoverlapping(bytes.as_ptr().add(offset as usize), p_value, n);
        *p_len = n as u16;
        return 0;
    }

    let Some(index) = note_index(attr.value) else {
        return ATT_ERR_INVALID_HANDLE;
    };
    let total = unsafe { NOTE_READ_LEN[index] };
    if offset > total {
        return ATT_ERR_INVALID_OFFSET;
    }
    let n = core::cmp::min(max_len, total - offset);
    if n != 0 {
        core::ptr::copy_nonoverlapping(attr.value.add(offset as usize), p_value, n as usize);
    }
    *p_len = n;
    0
}

unsafe extern "C" fn write_attr_cb(
    conn: u16,
    p_attr: *mut GattAttribute,
    p_value: *mut u8,
    len: u16,
    offset: u16,
    _method: u8,
) -> u8 {
    if p_attr.is_null() || (p_value.is_null() && len != 0) {
        return ATT_ERR_INVALID_HANDLE;
    }
    let attr = &*p_attr;

    if is_cccd(attr) {
        let status = GATTServApp::process_ccc_write_req(
            conn,
            p_attr,
            p_value,
            len,
            offset,
            GATT_CLIENT_CFG_NOTIFY | GATT_CLIENT_CFG_INDICATE,
        );
        let code = match status {
            Ok(()) => 0,
            Err(e) => e.get(),
        };
        if code == 0 {
            if let Some(hook) = CCCD_HOOK {
                hook(conn, p_attr);
            }
        }
        return code;
    }

    let Some(index) = note_index(attr.value) else {
        return ATT_ERR_WRITE_NOT_PERMITTED;
    };
    let cap = unsafe { NOTE_WRITE_CAP[index] };
    if cap == 0 {
        return ATT_ERR_WRITE_NOT_PERMITTED;
    }
    if offset > cap || len > cap - offset {
        return ATT_ERR_INVALID_VALUE_SIZE;
    }
    if len != 0 {
        core::ptr::copy_nonoverlapping(p_value, attr.value as *mut u8, len as usize);
    }

    if let Some(hook) = WRITE_HOOK {
        return hook(conn, p_attr, len);
    }
    0
}

static SERVICE_CBS: gattServiceCBs_t = gattServiceCBs_t {
    pfnReadAttrCB: Some(read_attr_cb),
    pfnWriteAttrCB: Some(write_attr_cb),
    pfnAuthorizeAttrCB: None,
};

/// Read callback pointer, for `process_char_cfg`.
pub fn service_read_cb() -> Option<
    unsafe extern "C" fn(u16, *mut GattAttribute, *mut u8, *mut u16, u16, u16, u8) -> u8,
> {
    Some(read_attr_cb)
}

/// Common service callback table (one handler set per binary).
pub fn service_cbs() -> &'static gattServiceCBs_t {
    &SERVICE_CBS
}

/// Register one already-filled attribute table.
///
/// Handles are assigned by the stack in registration order.
pub fn register_attrs(attrs: &'static mut [GattAttribute]) -> bStatus_t {
    // M17 hardware-passing sequence: initialize every CCCD table before
    // registering the service (the earlier bisect suspicion that
    // InitCharCfg stops advertising was disproven by UART status evidence).
    for attr in attrs.iter() {
        if attr_uuid(attr) == gatt_uuid::GATT_CLIENT_CHAR_CFG_UUID {
            unsafe {
                GATTServApp::init_char_cfg(INVALID_CONNHANDLE, attr.value as *mut gattCharCfg_t);
            }
        }
    }
    let ptr = attrs.as_mut_ptr();
    let len = attrs.len();
    let status = unsafe { GATTServApp::register_service(attrs, 16, &SERVICE_CBS) };
    if status.is_ok() {
        unsafe { patch_declarations(core::slice::from_raw_parts_mut(ptr, len)) };
    }
    status
}

/// Write the assigned value handles into every characteristic declaration.
///
/// The stack also fills these when it registers a service; doing it here keeps
/// discovery correct even if a blob revision leaves the declaration bytes
/// untouched, and running it twice is harmless.
unsafe fn patch_declarations(attrs: &mut [GattAttribute]) {
    for i in 0..attrs.len() {
        if attr_uuid(&attrs[i]) != GATT_CHARACTER_UUID {
            continue;
        }
        if i + 1 >= attrs.len() {
            break;
        }
        let handle = attrs[i + 1].handle;
        let value = attrs[i].value as *mut u8;
        *value.add(1) = handle as u8;
        *value.add(2) = (handle >> 8) as u8;
    }
}

/// UUID of an attribute type (only valid for 16-bit UUIDs).
pub fn attr_uuid(attr: *const GattAttribute) -> u16 {
    unsafe {
        if (*attr).type_.len != 2 {
            return 0;
        }
        let p = (*attr).type_.uuid;
        u16::from_le_bytes([*p, *p.add(1)])
    }
}

/// Attribute handle at `index` after registration.
pub fn attr_handle(attrs: &[GattAttribute], index: usize) -> u16 {
    attrs.get(index).map(|a| a.handle).unwrap_or(0)
}

/// Send a notification if the client enabled it in this CCCD table entry.
pub fn notify_if(conn: u16, cccd: *const gattCharCfg_t, handle: u16, payload: &[u8]) -> bool {
    let cfg = GATTServApp::read_char_cfg(conn, cccd);
    if cfg & GATT_CLIENT_CFG_NOTIFY != 0 {
        ble::client::send_notification(conn, handle, payload, false).is_ok()
    } else {
        false
    }
}

/// Send an indication if the client enabled it.
pub fn indicate_if(conn: u16, cccd: *const gattCharCfg_t, handle: u16, payload: &[u8]) -> bool {
    let cfg = GATTServApp::read_char_cfg(conn, cccd);
    if cfg & GATT_CLIENT_CFG_INDICATE != 0 {
        ble::client::send_indication(conn, handle, payload, false, task_id()).is_ok()
    } else {
        false
    }
}

// ---------------------------------------------------------------------------
// Time base
// ---------------------------------------------------------------------------

static mut SYSTICK_DIV: u32 = 0;

/// Milliseconds derived from the free-running SysTick counter.
pub fn now_ms() -> u32 {
    let cycles = unsafe { pac::SYSTICK.cnt().read() as u32 };
    let div = unsafe {
        if SYSTICK_DIV == 0 {
            SYSTICK_DIV = core::cmp::max(1, ble::systick_hz() / 1000);
        }
        SYSTICK_DIV
    };
    cycles / div
}

/// Simple periodic deadline. Periods below one millisecond are not modelled.
#[derive(Clone, Copy)]
pub struct Ticker {
    period: u32,
    next: u32,
}

impl Ticker {
    pub fn new(period_ms: u32) -> Self {
        Self {
            period: period_ms,
            next: now_ms().wrapping_add(period_ms),
        }
    }

    /// Restart the phase from `now`.
    pub fn restart(&mut self) {
        self.next = now_ms().wrapping_add(self.period);
    }

    pub fn due(&mut self, now: u32) -> bool {
        if now.wrapping_sub(self.next) < 0x8000_0000 {
            self.next = now.wrapping_add(self.period);
            true
        } else {
            false
        }
    }
}

/// One-shot deadline.
#[derive(Clone, Copy)]
pub struct Deadline {
    at: u32,
    armed: bool,
}

impl Deadline {
    pub fn after(ms: u32) -> Self {
        Self {
            at: now_ms().wrapping_add(ms),
            armed: true,
        }
    }

    pub fn never() -> Self {
        Self {
            at: 0,
            armed: false,
        }
    }

    pub fn arm(&mut self, ms: u32) {
        self.at = now_ms().wrapping_add(ms);
        self.armed = true;
    }

    pub fn cancel(&mut self) {
        self.armed = false;
    }

    pub fn due(&mut self, now: u32) -> bool {
        if self.armed && now.wrapping_sub(self.at) < 0x8000_0000 {
            self.armed = false;
            true
        } else {
            false
        }
    }
}

/// Live shim pubsub subscriber, installed by [`boot`].
///
/// `hal_tmos_task` publishes stack events into the shim channel and defers
/// `tmos_msg_deallocate` to `TmosEvent::Drop`. The subscriber must stay alive
/// and be drained (see [`run`]); dropping it at boot pins message buffers in
/// the 4-slot queue and the library's GATT server stalls once the small
/// buffer pool exhausts (M17's `tmos_poll` performs the same drain).
static mut EVENT_SUB: Option<ble::EventSubscriber> = None;

/// Busy-poll TMOS pump, one callback per millisecond.
///
/// This mirrors the EVT main loops (`HAL_SLEEP=FALSE`, no WFI). Stack messages
/// delivered to the shim task (GATT client indications/responses registered
/// with `GATT_RegisterForInd`/`GATT_RegisterForReq`) are dispatched to the
/// per-binary app handler before the message is deallocated — without this the
/// central-role GATT client never observes MTU/discovery responses.
pub fn run<F: FnMut(u32)>(mut on_tick: F) -> ! {
    let mut last = now_ms();
    loop {
        unsafe { TMOS_SystemProcess() };
        unsafe {
            if let Some(sub) = (*core::ptr::addr_of_mut!(EVENT_SUB)).as_mut() {
                while let Some(event) = sub.try_next_message_pure() {
                    let id = event.message_id();
                    // GAP events use the role callbacks (pfnStateChange /
                    // eventCB); only stack messages (GATT client traffic) are
                    // handed to the per-binary handler to avoid double
                    // dispatch.
                    if id != ble::TmosEvent::GAP_MSG_EVENT {
                        if let Some(handler) = APP_HANDLER {
                            handler(id, event.0 as *mut u8);
                        }
                    }
                }
            }
        }
        let now = now_ms();
        if now != last {
            last = now;
            on_tick(now);
        }
    }
}

/// `TMOS_GetSystemClock()` in 0.625 ms units.
pub fn system_clock() -> u32 {
    unsafe { TMOS_GetSystemClock() }
}

pub unsafe fn termininate(conn: u16) {
    let _ = GAPRole_TerminateLink(conn);
}

/// Parsed advertising name from a raw AD payload (complete or short name).
pub fn find_adv_name(data: &[u8]) -> Option<&[u8]> {
    let mut i = 0;
    while i + 1 < data.len() {
        let len = data[i] as usize;
        if len == 0 || i + 1 + len > data.len() {
            break;
        }
        let ty = data[i + 1];
        if ty == GAP_ADTYPE_LOCAL_NAME_COMPLETE || ty == GAP_ADTYPE_LOCAL_NAME_SHORT {
            return Some(&data[i + 2..i + 1 + len]);
        }
        i += 1 + len;
    }
    None
}

/// Does this advertisement carry `name` (complete or short local name)?
pub fn adv_name_is(data: &[u8], name: &[u8]) -> bool {
    match find_adv_name(data) {
        Some(found) => found == name,
        None => false,
    }
}

/// Parse RSSI and address from a `gapDeviceInfoEvent_t`, logging the classic
/// "Device <addr> RSSI <rssi>" style line used by the observer.
pub unsafe fn print_device(addr: &[u8; 6], addr_type: u8, rssi: i8, data: &[u8]) {
    ble::println!(
        "Device {:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X} type {} RSSI {}",
        addr[5],
        addr[4],
        addr[3],
        addr[2],
        addr[1],
        addr[0],
        addr_type,
        rssi
    );
    if let Some(name) = find_adv_name(data) {
        if let Ok(text) = core::str::from_utf8(name) {
            ble::println!("  name {}", text);
        }
    }
}