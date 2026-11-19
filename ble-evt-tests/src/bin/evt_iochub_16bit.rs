//! IoCHub (16-bit variant) — spec source `docs/m18-evt-specs.md` (IoCHub_NET).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - scan name `ch583_ble_iochub` (GAP device name `CH583_ble_iochub`),
//!   service FFF3 with FFF4 notify + CCCD and FFF5 write/write-no-rsp
//! - FFF4 notifies a 1-byte data-point counter every 3000 ms after subscribe
//! - writes to FFF5 are logged and echoed back on FFF4 (host-verifiable loop)
//!
//! Deviations from EVT
//! - EVT IoCHub_NET bridges to a wired IO hub; the hub side is not present on
//!   this board, so the DP counter is synthetic and writes echo over BLE
//! - fixed nominal MAC; bonding RAM-only (SNV off); no HAL_SLEEP

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
    dp: Ticker,
    counter: u8,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    if attr_uuid(attr) != 0xFFF5 || len == 0 {
        return 0;
    }
    let byte = services::iochub::V2[0];
    ble::println!("iochub rx {} byte(s): 0x{:02x}", len, byte);
    let ctx = &mut *addr_of_mut!(CTX);
    if let Some(ctx) = ctx.as_mut() {
        if ctx.conn != INVALID_CONNHANDLE {
            let _ = ble_evt_tests::notify_if(
                ctx.conn,
                services::iochub::cccd_tx(),
                services::iochub::tx_handle(),
                &[byte],
            );
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
                ctx.dp = Ticker::new(3000);
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
    if ctx.conn != INVALID_CONNHANDLE && ctx.dp.due(now) {
        ctx.counter = ctx.counter.wrapping_add(1);
        let _ = ble_evt_tests::notify_if(
            ctx.conn,
            services::iochub::cccd_tx(),
            services::iochub::tx_handle(),
            &[ctx.counter],
        );
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_app_handler(on_event);
    set_gap_handler(on_gap);
    set_write_hook(on_write);
    bond_peripheral(true, GAPBOND_IO_CAP_DISPLAY_ONLY);
    set_peripheral_conn(8, 20, 0, 100);

    // M17 hardware-passing order: role init → adv params + advert enabled
    // → GGS/GATTServApp → services → name → StartDevice.
    peripheral_role_init();

    let mut adv = ble_evt_tests::adv::simple_adv(0xFFF3);
    set_adv_data(adv.as_slice());
    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"ch583_ble_iochub")
        ;
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(160); // 100 ms
    adv_enable(true);

    add_gatt_services();
    let _ = services::iochub::register();
    let _ = services::devinfo::register();
    set_device_name("CH583_ble_iochub");


    unsafe {
        let _ = GAPRole_PeripheralStartDevice(task, bond_cbs(), role_cbs());
    }

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            dp: Ticker::new(3000),
            counter: 0,
        });
    }

    ble::println!("advertising: ch583_ble_iochub");
    ble_evt_tests::run(on_tick)
}