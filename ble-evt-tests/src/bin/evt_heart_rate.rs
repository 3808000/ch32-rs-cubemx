//! HeartRate — spec source `docs/m18-evt-specs.md` §3 (factual parameters).
//! Independent implementation, not EVT source translation.
//!
//! Host-side criteria
//! - advertising contains flags 0x06, UUIDs 0x180D+0x180F and the complete
//!   name `Heart Rate Sensor`; empty scan response
//! - fast advertising 20 ms for 18.75 s, then 1000 ms forever
//! - 0x2A37 notify every 2000 ms, 2 bytes `00 <bpm>`, bpm 73..80 then wrap
//! - 0x2A38 read returns `00`; 0x2A39 write accepted
//! - battery 0x2A19 read/notify 100 every 15000 ms
//! - connection 25..200 ms, latency 1, timeout 10 s
//!
//! Deviations from EVT
//! - fixed nominal MAC (shim has no factory-MAC binding)
//! - bonding is RAM-only (SNV off)
//! - 0x2A39 only acknowledges the write; the EVT "clear energy" side effect
//!   has no observable payload because flags stay 0

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
    bpm: u8,
    hr: Ticker,
    batt: Ticker,
    slow_adv: Deadline,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    if attr_uuid(attr) == 0x2A39 {
        ble::println!("HR control point write ({} byte(s))", len);
    }
    0
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = link.connectionHandle;
                ctx.hr = Ticker::new(2000);
                ctx.batt = Ticker::new(15000);
            }
            ble::println!(
                "connected 0x{:04x} interval {} latency {} timeout {}",
                link.connectionHandle,
                link.connInterval,
                link.connLatency,
                link.connTimeout
            );
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

    if ctx.conn == INVALID_CONNHANDLE {
        return;
    }

    if ctx.hr.due(now) {
        let bpm = ctx.bpm;
        services::heart_rate::notify_conn(ctx.conn, bpm);
        ctx.bpm = if bpm >= 80 { 73 } else { bpm + 1 };
    }
    if ctx.batt.due(now) {
        services::battery::notify_conn(ctx.conn, 100);
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_app_handler(on_event);
    set_gap_handler(on_gap);
    set_write_hook(on_write);
    bond_peripheral(false, GAPBOND_IO_CAP_DISPLAY_ONLY);
    set_peripheral_conn(20, 160, 1, 1000);

    // M17 hardware-passing order (see evt_peripheral): role init → adv
    // params + advert enabled → GGS/GATTServApp → services → name → start.
    peripheral_role_init();

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_GENERAL | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.uuids16_more(&[0x180D, 0x180F]);
    adv.name_complete(b"Heart Rate Sensor");
    set_adv_data(adv.as_slice());
    // The spec's scanRspData is empty.
    set_adv_interval(32); // 20 ms
    adv_enable(true);

    add_gatt_services();
    let _ = services::heart_rate::register();
    let _ = services::battery::register();
    let _ = services::devinfo::register();
    set_device_name("Heart Rate Sensor");

    unsafe {
        let _ = GAPRole_PeripheralStartDevice(task, bond_cbs(), role_cbs());
    }

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            bpm: 73,
            hr: Ticker::new(2000),
            batt: Ticker::new(15000),
            slow_adv: Deadline::after(30000),
        });
    }

    ble::println!("advertising: Heart Rate Sensor");
    ble_evt_tests::run(on_tick)
}