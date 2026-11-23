//! HID Touch — spec source `docs/m18-evt-specs.md` (HID_Touch, factual parameters).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - name `HID Touch`, appearance 0x03C5 (Digitizer Tablet)
//! - services 1812 (HID) + 180F (battery) + 1813 (scan params) + 180A (devinfo)
//! - Report Map = touch digitizer descriptor; Report (2A4D, input ref 01/01) notify
//! - first report 500 ms after subscribing, then one 6-byte report every 100 ms:
//!   touch=1, contactID=0, X=378+send_char (+4 per report, first 382),
//!   Y=356; when send_char would reach 100 send a release report
//!   (touch=0, X=478, Y=356) and restart from 378
//!
//! Deviations from EVT
//! - fixed nominal MAC (shim has no factory-MAC binding); bonding RAM-only (SNV off)
//! - no HAL_SLEEP (EVT never enabled it either)
//! - BlueZ's HID-over-GATT plugin fixes the connection interval at 195 ms, so
//!   100 ms reports are delivered one per connection event (≥195 ms apart)
//!   until the peer changes the interval; the EVT touch profile does not
//!   request a connection-parameter update.

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use ble_evt_tests::{BootCfg, Deadline, Ticker};
use core::ptr::addr_of_mut;
use panic_halt as _;
use qingke_rt::entry;

ble_evt_tests::ble_isr!();

struct Ctx {
    conn: u16,
    first: Deadline,
    report: Ticker,
    started: bool,
    send_char: u8,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = link.connectionHandle;
                ctx.first = Deadline::after(500);
                ctx.report = Ticker::new(100);
                ctx.started = false;
                ctx.send_char = 0;
            }
            ble::println!("connected 0x{:04x}", link.connectionHandle);
        }
        GAP_LINK_TERMINATED_EVENT => {
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = INVALID_CONNHANDLE;
            }
            ble::println!("disconnected");
        }
        _ => {}
    }
}

unsafe fn on_event(event: u8, msg: *mut u8) {
    if event == ble::TmosEvent::GAP_MSG_EVENT {
        on_gap(msg as *mut gapRoleEvent_t);
    }
}

/// Build and send one 6-byte digitizer report per the spec sequence.
fn send_report(conn: u16, send_char: &mut u8) {
    let mut report = [0u8; 6];
    if *send_char >= 96 {
        // Release: touch=0, contactID 0, X=478, Y=356; restart from 378.
        report[2] = 478u16 as u8;
        report[3] = (478u16 >> 8) as u8;
        *send_char = 0;
    } else {
        *send_char = send_char.wrapping_add(4);
        report[0] = 1; // tip switch
        let x = 378u16 + *send_char as u16;
        report[2] = x as u8;
        report[3] = (x >> 8) as u8;
    }
    report[4] = 356u16 as u8;
    report[5] = (356u16 >> 8) as u8;
    services::hid_touch::notify_conn(conn, &report);
}

fn on_tick(now: u32) {
    let Some(ctx) = (unsafe { &mut *addr_of_mut!(CTX) }).as_mut() else {
        return;
    };
    if ctx.conn == INVALID_CONNHANDLE {
        return;
    }
    if !ctx.started {
        // Spec: first report 500 ms after notify is enabled.
        if ctx.first.due(now) {
            ctx.started = true;
            ctx.report.restart();
            send_report(ctx.conn, &mut ctx.send_char);
        }
        return;
    }
    if ctx.report.due(now) {
        send_report(ctx.conn, &mut ctx.send_char);
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_app_handler(on_event);
    set_gap_handler(on_gap);
    bond_peripheral(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    set_peripheral_conn(8, 8, 0, 500);

    // M17 hardware-passing order: role init → adv params + advert enabled
    // → GGS/GATTServApp → services → name → StartDevice.
    peripheral_role_init();

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_LIMITED | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.appearance(0x03C5);
    adv.name_complete(b"HID Touch");
    set_adv_data(adv.as_slice());

    let mut rsp = AdvBuilder::new();
    rsp.uuids16_more(&[0x1812, 0x180F]);
    set_scan_rsp(rsp.as_slice());
    adv_enable(true);

    add_gatt_services();
    let _ = services::hid_touch::register();
    let _ = services::battery::register();
    let _ = services::scan_params::register();
    let _ = services::devinfo::register();
    set_device_name("HID Touch");
    set_appearance(0x03C5);

    unsafe {
        let _ = GAPRole_PeripheralStartDevice(task, bond_cbs(), role_cbs());
    }

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            first: Deadline::never(),
            report: Ticker::new(100),
            started: false,
            send_char: 0,
        });
    }

    ble::println!("advertising: HID Touch");
    ble_evt_tests::run(on_tick)
}
