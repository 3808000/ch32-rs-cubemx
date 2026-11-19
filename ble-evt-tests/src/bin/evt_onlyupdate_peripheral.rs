//! OnlyUpdateApp_Peripheral — spec source `docs/m18-evt-specs.md` §2
//! (factual parameters). Independent implementation, not EVT source
//! translation.
//!
//! Host-side criteria
//! - identical advertising/GATT surface to §1 (`Simple Peripheral`, 0xFFE0)
//! - FFE4 notifies 1 byte 0x88 every 1600 ms
//! - writing FFE3 prints the OTA decision and drops the link
//!
//! Deviations from EVT
//! - writing FFE3 does **not** erase DataFlash, set the image flag, or reset
//!   the MCU: this crate is a GATT/behaviour test and never touches flash.
//!   The binary only logs `jump OTA` and terminates the link.
//! - fixed nominal MAC instead of the factory MAC
//! - bonding is RAM-only (SNV off in the shim)

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use ble_evt_tests::{adv::AdvBuilder, BootCfg, Ticker};
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
    notify: Ticker,
    rssi: Ticker,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    match attr_uuid(attr) {
        0xFFE1 => ble::println!("profile ChangeCB CHAR1, {} byte(s)", len),
        0xFFE3 => {
            ble::println!("profile ChangeCB CHAR3 -> jump OTA");
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                if ctx.conn != INVALID_CONNHANDLE {
                    let _ = GAPRole_TerminateLink(ctx.conn);
                }
            }
        }
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
                ctx.notify = Ticker::new(1600);
                ctx.rssi = Ticker::new(3200);
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
    if ctx.notify.due(now) {
        services::simple::notify_conn(ctx.conn, 0x88);
    }
    if ctx.rssi.due(now) {
        unsafe {
            let _ = GAPRole_ReadRssiCmd(ctx.conn);
        }
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_app_handler(on_event);
    set_write_hook(on_write);
    bond_peripheral(true, GAPBOND_IO_CAP_DISPLAY_ONLY);
    set_peripheral_conn(6, 100, 0, 100);

    add_gatt_services();
    let _ = services::simple::register();
    set_device_name("Simple Peripheral");

    let mut adv = ble_evt_tests::adv::simple_adv(0xFFE0);
    set_adv_data(adv.as_slice());
    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"Simple Peripheral")
        ;
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(80);

    start_peripheral(task);

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            notify: Ticker::new(1600),
            rssi: Ticker::new(3200),
        });
    }

    ble::println!("advertising: Simple Peripheral (OTA trigger on FFE3)");
    ble_evt_tests::run(on_tick)
}