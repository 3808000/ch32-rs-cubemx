//! HID Touch — spec source `docs/m18-evt-specs.md` (HID_Touch, factual parameters).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - name `HID Touch`, services 1812 (HID) + 180F (battery) + 1813 (scan params)
//! - Report Map = touch digitizer descriptor; Report (2A4D, input ref 01/01) notify
//! - after subscribing: 6-byte touch report every 100 ms, alternating
//!   touch=1 (contact id n, X=378+n, Y=356) and touch=0 (release)
//!
//! Deviations from EVT
//! - fixed nominal MAC (shim has no factory-MAC binding); bonding RAM-only (SNV off)
//! - no HAL_SLEEP (EVT never enabled it either)

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
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
    report: Ticker,
    down: bool,
    contact: u8,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = link.connectionHandle;
                ctx.report = Ticker::new(100);
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

fn on_tick(now: u32) {
    let Some(ctx) = (unsafe { &mut *addr_of_mut!(CTX) }).as_mut() else {
        return;
    };
    if ctx.conn == INVALID_CONNHANDLE || !ctx.report.due(now) {
        return;
    }
    let mut report = [0u8; 6];
    if ctx.down {
        report[0] = 1; // tip switch
        report[1] = ctx.contact;
        let x = 378u16 + ctx.contact as u16;
        report[2] = x as u8;
        report[3] = (x >> 8) as u8;
        report[4] = 356u16 as u8;
        report[5] = (356u16 >> 8) as u8;
        ctx.contact = ctx.contact.wrapping_add(1) % 10;
    }
    ctx.down = !ctx.down;
    services::hid_touch::notify_conn(ctx.conn, &report);
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_app_handler(on_event);
    bond_peripheral(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    set_peripheral_conn(8, 8, 0, 500);

    add_gatt_services();
    let _ = services::hid_touch::register();
    let _ = services::battery::register();
    let _ = services::scan_params::register();
    set_device_name("HID Touch");
    set_appearance(0x03C4);

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_LIMITED | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.appearance(0x03C4);
    adv.name_complete(b"HID Touch");
    set_adv_data(adv.as_slice());

    let mut rsp = AdvBuilder::new();
    rsp.conn_interval_range(8, 8);
    rsp.uuids16_more(&[0x1812, 0x180F]);
    rsp.tx_power(0);
    set_scan_rsp(rsp.as_slice());

    start_peripheral(task);

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            report: Ticker::new(100),
            down: true,
            contact: 0,
        });
    }

    ble::println!("advertising: HID Touch");
    ble_evt_tests::run(on_tick)
}