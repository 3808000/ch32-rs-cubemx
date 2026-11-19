//! HID_Mouse — spec source `docs/m18-evt-specs.md` §7 (factual parameters).
//! Independent implementation, not EVT source translation.
//!
//! Host-side criteria
//! - name `HID Mouse`, appearance 0x03C2, flags 0x05
//! - 2A4B report map 46 B (the byte sequence is a factual table entry),
//!   2A4D input 4 B notify, 2A4D feature R/W
//! - first notification 500 ms after subscribe, then every 800 ms with
//!   `00 02 02 00`
//! - connection 10 ms, latency 0, timeout 5 s
//!
//! Deviations from EVT
//! - fixed nominal MAC, bonding RAM-only (SNV off)
//! - the 12800 ms parameter update / 1600 ms 2M PHY request are optional on
//!   the host side and are issued but not asserted

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use ble_evt_tests::{adv::AdvBuilder, BootCfg, Deadline, Ticker};
use core::ptr::addr_of_mut;
use panic_halt as _;
use qingke_rt::entry;

ble_evt_tests::ble_isr!();

struct Ctx {
    conn: u16,
    first: Deadline,
    report: Ticker,
    phy: Deadline,
    param: Deadline,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    if attr_uuid(attr) == 0x2A4D {
        ble::println!("HID feature report write, {} byte(s)", len);
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
                ctx.report = Ticker::new(800);
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
        _ => {}
    }
}

unsafe fn on_event(event: u8, msg: *mut u8) {
    if event == ble::TmosEvent::GAP_MSG_EVENT {
        on_gap(msg as *mut gapRoleEvent_t);
    }
}

fn on_tick(now: u32) {
    let Some(ctx) = (unsafe { &mut *addr_of_mut!(CTX) }).as_mut() else {
        return;
    };
    if ctx.conn == INVALID_CONNHANDLE {
        return;
    }
    if ctx.first.due(now) || ctx.report.due(now) {
        services::hid_mouse::notify_conn(ctx.conn, &[0x00, 0x02, 0x02, 0x00]);
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
    set_gap_handler(on_gap);
    set_write_hook(on_write);
    bond_peripheral(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    set_peripheral_conn(8, 8, 0, 500);

    // M17 hardware-passing order: role init → adv params + advert enabled
    // → GGS/GATTServApp → services → name → StartDevice.
    peripheral_role_init();

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_LIMITED | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.appearance(0x03C2);
    adv.name_complete(b"HID Mouse");
    set_adv_data(adv.as_slice());

    let mut rsp = AdvBuilder::new();
    rsp.uuids16_more(&[0x1812, 0x180F]);
    rsp;
    set_scan_rsp(rsp.as_slice());
    adv_enable(true);

    add_gatt_services();
    let _ = services::hid_mouse::register();
    let _ = services::battery::register();
    let _ = services::scan_params::register();
    let _ = services::devinfo::register();
    set_device_name("HID Mouse");
    set_appearance(0x03C2);


    unsafe {
        let _ = GAPRole_PeripheralStartDevice(task, bond_cbs(), role_cbs());
    }

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            first: Deadline::never(),
            report: Ticker::new(800),
            phy: Deadline::never(),
            param: Deadline::never(),
        });
    }

    ble::println!("advertising: HID Mouse");
    ble_evt_tests::run(on_tick)
}