//! RunningSensor — spec source `docs/m18-evt-specs.md` §5 (factual
//! parameters). Independent implementation, not EVT source translation.
//!
//! Host-side criteria
//! - adv `02 01 06 | 03 02 14 18`; rsp `0B 09 "RSC Sensor"`
//! - fast 30 ms for 12.5 s, slow 1000 ms for 12.5 s
//! - 0x2A53 notify every 2000 ms, 10 bytes, flags cycling through the
//!   running-set `0x07,0x04,0x05,0x06`
//! - 0x2A54 read `0000`, 0x2A5D read `00`, 0x2A55 write + indication
//! - connection 25..200 ms, latency 0, timeout 10 s
//!
//! Deviations from EVT
//! - fixed nominal MAC, no factory-MAC read
//! - bonding RAM-only (SNV off)
//! - motion values are synthetic and use SysTick time

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
    meas: Ticker,
    slow_adv: Deadline,
    stop_adv: Deadline,
    flags_idx: u8,
    distance: u32,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    if attr_uuid(attr) == 0x2A55 && len >= 1 {
        let command = *(*attr).value;
        ble::println!("RSC control point 0x{:02x}", command);
        if command == 0x01 {
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.distance = 0;
                ctx.flags_idx = 0;
            }
            services::rsc::indicate_conn(conn, &[0x01, 0x01]);
        }
    }
    0
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = link.connectionHandle;
                ctx.meas = Ticker::new(2000);
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

    if ctx.slow_adv.due(now) {
        ble::println!("advertising: fast -> slow 1000 ms");
        adv_enable(false);
        set_adv_interval(1600);
        adv_enable(true);
    }
    if ctx.stop_adv.due(now) {
        ble::println!("advertising: slow window finished");
        adv_enable(false);
    }

    if ctx.conn == INVALID_CONNHANDLE {
        return;
    }
    if ctx.meas.due(now) {
        let base = [0x03u8, 0x00, 0x01, 0x02][ctx.flags_idx as usize % 4];
        let flags = base | 0x04; // simulated runner
        ctx.flags_idx = ctx.flags_idx.wrapping_add(1);
        ctx.distance = ctx.distance.wrapping_add(100); // 0.1 m units

        let mut payload = [0u8; 10];
        payload[0] = flags;
        payload[1..3].copy_from_slice(&0x0100u16.to_le_bytes()); // 1.0 m/s
        payload[3] = 80; // steps/min
        payload[4..6].copy_from_slice(&100u16.to_le_bytes()); // 100 cm
        payload[6..10].copy_from_slice(&ctx.distance.to_le_bytes());
        services::rsc::notify_conn(ctx.conn, &payload);
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_app_handler(on_event);
    set_write_hook(on_write);
    bond_peripheral(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    bond_no_white_list_sync();
    set_peripheral_conn(20, 160, 0, 1000);

    add_gatt_services();
    let _ = services::rsc::register();
    let _ = services::battery::register();
    let _ = services::devinfo::register();
    set_device_name("RSC Sensor");

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_GENERAL | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.uuids16_more(&[0x1814]);
    set_adv_data(adv.as_slice());
    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"RSC Sensor");
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(48); // 30 ms

    start_peripheral(task);

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            meas: Ticker::new(2000),
            slow_adv: Deadline::after(20000),
            stop_adv: Deadline::after(40000),
            flags_idx: 0,
            distance: 0,
        });
    }

    ble::println!("advertising: RSC Sensor");
    ble_evt_tests::run(on_tick)
}