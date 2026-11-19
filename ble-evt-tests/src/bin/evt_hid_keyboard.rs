//! HID_Keyboard — spec source `docs/m18-evt-specs.md` §6 (factual
//! parameters). Independent implementation, not EVT source translation.
//!
//! Host-side criteria
//! - name `HID Keyboard`, appearance 0x03C1, flags 0x05 (Limited)
//! - services 0x1812/0x180F/0x1813 (+0x180A)
//! - 2A4A HID info `11 01 00 01`, 2A4B report map 63 B,
//!   2A4C control point WNR, 2A4E protocol mode, 2A4D input 8 B notify,
//!   2A4D output 1 B, 2A22 boot input 8 B notify, 2A32 boot output,
//!   2A4D feature; report-reference descriptors on report characteristics
//! - first notification 500 ms after subscribe, then every 2000 ms:
//!   keycode 0x04..0x1D press followed by an all-zero release
//! - connection 10 ms, latency 0, timeout 5 s
//!
//! Deviations from EVT
//! - fixed nominal MAC, bonding RAM-only (SNV off)
//! - the 63-byte keyboard report map is authored from the HID usage tables
//!   (same size as the spec, not copied from EVT)
//! - 12800 ms connection-parameter update and 1600 ms 2M-PHY request are
//!   issued, but the peer/host decides whether they take effect

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use ble_evt_tests::{adv::AdvBuilder, BootCfg, Deadline, Ticker};
use core::ptr::addr_of_mut;
use panic_halt as _;
use qingke_rt::entry;

#[qingke_rt::interrupt]
unsafe fn BLEB() {
    ble::BB_IRQLibHandler();
}

#[qingke_rt::interrupt]
unsafe fn BLEL() {
    ble::LLE_IRQLibHandler();
}

struct Ctx {
    conn: u16,
    first: Deadline,
    report: Ticker,
    phy: Deadline,
    param: Deadline,
    key: u8,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    match attr_uuid(attr) {
        0x2A4D | 0x2A32 => ble::println!("HID output report, {} byte(s)", len),
        0x2A4C => ble::println!("HID control point 0x{:02x}", *(*attr).value),
        _ => {}
    }
    0
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = link.connectionHandle;
                ctx.first = Deadline::after(500);
                ctx.report = Ticker::new(2000);
                ctx.phy = Deadline::after(1600);
                ctx.param = Deadline::after(12800);
            }
            ble::println!("connected 0x{:04x}", link.connectionHandle);
        }
        GAP_LINK_TERMINATED_EVENT => {
            let term = (*event).linkTerminate;
            ble::println!("disconnected 0x{:04x} reason 0x{:02x}", term.connectionHandle, term.reason);
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = INVALID_CONNHANDLE;
            }
        }
        GAP_PHY_UPDATE_EVENT => {
            let phy = (*event).linkPhyUpdate;
            ble::println!("PHY update status {} tx {} rx {}", phy.status, phy.connTxPHYS, phy.connRxPHYS);
        }
        _ => {}
    }
}

unsafe fn on_event(event: u8, msg: *mut u8) {
    if event == ble::TmosEvent::GAP_MSG_EVENT {
        on_gap(msg as *mut gapRoleEvent_t);
    }
}

fn send_key(conn: u16, key: u8) {
    let mut press = [0u8; 8];
    press[2] = key;
    services::hid_keyboard::notify_conn(conn, &press);
    services::hid_keyboard::notify_conn(conn, &[0u8; 8]);
}

fn on_tick(now: u32) {
    let Some(ctx) = (unsafe { &mut *addr_of_mut!(CTX) }).as_mut() else {
        return;
    };
    if ctx.conn == INVALID_CONNHANDLE {
        return;
    }
    if ctx.first.due(now) {
        send_key(ctx.conn, ctx.key);
        ctx.key = if ctx.key >= 29 { 4 } else { ctx.key + 1 };
    }
    if ctx.report.due(now) {
        send_key(ctx.conn, ctx.key);
        ctx.key = if ctx.key >= 29 { 4 } else { ctx.key + 1 };
    }
    if ctx.phy.due(now) {
        unsafe {
            let _ = GAPRole_UpdatePHY(ctx.conn, 0, 2, 2, 0);
        }
    }
    if ctx.param.due(now) {
        unsafe {
            let _ = GAPRole_UpdateLink(ctx.conn, 8, 8, 0, 500);
        }
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_app_handler(on_event);
    set_write_hook(on_write);
    bond_peripheral(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    set_peripheral_conn(8, 8, 0, 500);

    add_gatt_services();
    let _ = services::hid_keyboard::register();
    let _ = services::battery::register();
    let _ = services::scan_params::register();
    let _ = services::devinfo::register();
    set_device_name("HID Keyboard");
    set_appearance(0x03C1);

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_LIMITED | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.appearance(0x03C1);
    adv.name_complete(b"HID Keyboard");
    set_adv_data(adv.as_slice());

    let mut rsp = AdvBuilder::new();
    rsp.uuids16_more(&[0x1812, 0x180F]);
    rsp;
    set_scan_rsp(rsp.as_slice());

    start_peripheral(task);

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            first: Deadline::never(),
            report: Ticker::new(2000),
            phy: Deadline::never(),
            param: Deadline::never(),
            key: 4,
        });
    }

    ble::println!("advertising: HID Keyboard");
    ble_evt_tests::run(on_tick)
}