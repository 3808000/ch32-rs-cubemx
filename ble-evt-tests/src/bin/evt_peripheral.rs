//! Peripheral — spec source `docs/m18-evt-specs.md` §1 (factual parameters).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - name `Simple Peripheral`, advertising UUID 0xFFE0, 50 ms interval
//! - service FFE0 with FFE1 R/W (1 B, init 1), FFE2 R (1 B, init 2),
//!   FFE3 W (1 B, init 3), FFE4 notify (1 B, init 4) + CCCD,
//!   FFE5 R (5 B, {1,2,3,4,5}); each characteristic has a User Description
//! - FFE4 notifies 1 byte 0x88 every 1600 ms after subscribing
//! - connection 7.5..125 ms, latency 0, timeout 1 s
//!
//! Deviations from EVT
//! - factory MAC is replaced by a fixed nominal address (shim has no
//!   `GetMACAddress` binding)
//! - bonding runs in RAM only (shim keeps SNV off); no persistence
//! - no `HAL_SLEEP` (same as EVT: sleep was never enabled)

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use core::ptr::addr_of_mut;
use panic_halt as _;
use qingke_rt::entry;

ble_evt_tests::ble_isr!();

struct Ctx {
    conn: u16,
    notify: Ticker,
    rssi: Ticker,
    update: Deadline,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    match attr_uuid(attr) {
        0xFFE1 => ble::println!("profile ChangeCB CHAR1, {} byte(s)", len),
        0xFFE3 => ble::println!("profile ChangeCB CHAR3, {} byte(s)", len),
        _ => {}
    }
    0
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            let connected = &mut *addr_of_mut!(CTX);
            if let Some(ctx) = connected {
                ctx.conn = link.connectionHandle;
                ctx.notify = Ticker::new(1600);
                ctx.rssi = Ticker::new(3200);
                ctx.update = Deadline::after(6400);
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
        GAP_LINK_PARAM_UPDATE_EVENT => {
            let update = (*event).linkUpdate;
            ble::println!(
                "conn update 0x{:04x} status {} interval {}",
                update.connectionHandle,
                update.status,
                update.connInterval
            );
        }
        _ => {}
    }
}

unsafe fn on_event(event: u8, msg: *mut u8) {
    match event {
        ble::TmosEvent::GAP_MSG_EVENT => on_gap(msg as *mut gapRoleEvent_t),
        ble::TmosEvent::GATT_MSG_EVENT => {
            let message = &*(msg as *const gattMsgEvent_t);
            if let GattClientEvent::MtuUpdated { mtu, .. } = message.decode() {
                ble::println!("MTU updated {}", mtu);
            }
        }
        _ => {}
    }
}

fn on_tick(now: u32) {
    let ctx = unsafe { &mut *addr_of_mut!(CTX) };
    let Some(ctx) = ctx.as_mut() else { return };
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
    if ctx.update.due(now) {
        unsafe {
            let _ = GAPRole_PeripheralConnParamUpdateReq(ctx.conn, 6, 100, 0, 100, task_id());
        }
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(ble_evt_tests::BootCfg::peripheral());
    let task = boot.task_id;

    set_app_handler(on_event);
    set_gap_handler(on_gap);
    set_write_hook(on_write);
    bond_peripheral(true, GAPBOND_IO_CAP_DISPLAY_ONLY);
    set_peripheral_conn(6, 100, 0, 100);

    // M17 hardware-passing order (A/B-verified on this board): role init →
    // adv params + advert enabled → GGS/GATTServApp → service registration →
    // device name → StartDevice. Registering services before the role task
    // exists, or enabling advertising only after StartDevice, leaves the
    // GATT server silent during discovery.
    peripheral_role_init();

    let mut adv = ble_evt_tests::adv::simple_adv(0xFFE0);
    set_adv_data(adv.as_slice());
    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"Simple Peripheral");
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(80);
    adv_enable(true);

    unsafe {
        let _ = GGS_AddService(GATT_ALL_SERVICES);
        let _ = GATTServApp::add_service(GATT_ALL_SERVICES);
    }
    let _ = services::simple::register();
    set_device_name("Simple Peripheral");

    unsafe {
        let _ = GAPRole_PeripheralStartDevice(task, bond_cbs(), role_cbs());
    }

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            notify: Ticker::new(1600),
            rssi: Ticker::new(3200),
            update: Deadline::never(),
        });
    }

    ble::println!("advertising: Simple Peripheral");
    ble_evt_tests::run(on_tick)
}