//! CyclingSensor — spec source `docs/m18-evt-specs.md` §4 (factual
//! parameters). Independent implementation, not EVT source translation.
//!
//! Host-side criteria
//! - adv `02 01 06 | 03 02 16 18 | 0B 09 "CSC Sensor"`, rsp `02 0A 00`
//! - fast 20 ms for 12.5 s, slow 1065 ms for 12.5 s
//! - 0x2A5B notify every 1000 ms, fixed 11 bytes with flags 0x03 and
//!   increasing wheel/crank counters
//! - 0x2A5C read `0000`, 0x2A5D read `01`
//! - 0x2A55 write `01` resets counters and produces an indication
//! - connection 25..250 ms, latency 20, timeout 10 s
//!
//! Deviations from EVT
//! - fixed nominal MAC, no factory-MAC read
//! - bonding RAM-only (SNV off)
//! - wheel/crank event times use the local SysTick millisecond clock in
//!   1/1024 s units rather than a hardware rotation sensor

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
    meas: Ticker,
    slow_adv: Deadline,
    stop_adv: Deadline,
    wheel: u32,
    crank: u16,
}

static mut CTX: Option<Ctx> = None;

fn wheel_time(now: u32) -> u16 {
    (now.wrapping_mul(1024) / 1000) as u16
}

unsafe fn on_write(conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    if attr_uuid(attr) == 0x2A55 && len >= 1 {
        let command = *(*attr).value;
        ble::println!("CSC control point 0x{:02x}", command);
        if command == 0x01 {
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.wheel = 0;
                ctx.crank = 0;
            }
            services::csc::indicate_conn(conn, &[0x01, 0x01]);
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
                ctx.meas = Ticker::new(1000);
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
        ble::println!("advertising: fast -> slow 1065 ms");
        adv_enable(false);
        set_adv_interval(1704);
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
        ctx.wheel = ctx.wheel.wrapping_add(1);
        ctx.crank = ctx.crank.wrapping_add(1);
        let t = wheel_time(now);
        let mut payload = [0u8; 11];
        payload[0] = 0x03;
        payload[1..5].copy_from_slice(&ctx.wheel.to_le_bytes());
        payload[5..7].copy_from_slice(&t.to_le_bytes());
        payload[7..9].copy_from_slice(&ctx.crank.to_le_bytes());
        payload[9..11].copy_from_slice(&t.to_le_bytes());
        services::csc::notify_conn(ctx.conn, &payload);
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
    bond_no_white_list_sync();
    set_peripheral_conn(20, 200, 20, 1000);

    // M17 hardware-passing order: role init → adv params + advert enabled
    // → GGS/GATTServApp → services → name → StartDevice.
    peripheral_role_init();

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_GENERAL | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.uuids16_more(&[0x1816]);
    adv.name_complete(b"CSC Sensor");
    set_adv_data(adv.as_slice());
    let mut rsp = AdvBuilder::new();
    rsp;
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(32);
    adv_enable(true);

    add_gatt_services();
    let _ = services::csc::register();
    let _ = services::battery::register();
    let _ = services::devinfo::register();
    set_device_name("CSC Sensor");


    unsafe {
        let _ = GAPRole_PeripheralStartDevice(task, bond_cbs(), role_cbs());
    }

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            meas: Ticker::new(1000),
            slow_adv: Deadline::after(20000),
            stop_adv: Deadline::after(40000),
            wheel: 0,
            crank: 0,
        });
    }

    ble::println!("advertising: CSC Sensor");
    ble_evt_tests::run(on_tick)
}