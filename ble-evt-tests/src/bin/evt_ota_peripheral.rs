//! OTA peripheral (BackupUpgrade_OTA service surface) — spec source
//! `docs/m18-evt-specs.md` (BackupUpgrade_OTA / OnlyUpdateApp_IAP OTA profile).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - name `Simple Peripheral`, 100 ms advertising, MTU 247 (BufMaxLen 251)
//! - services FFE0 (FFE1..FFE5, FFE4 notify 8 B every 1000 ms) and FEE0 with
//!   FEE1 read+write+write-no-rsp (no CCCD); read returns ≤20 B response
//! - FEE1 command 0x84 (IAP_INFO) answers image flag / size / block size;
//!   program/erase/verify/end commands (0x80/0x81/0x82/0x83) are **stubbed to
//!   ATT error** — this test never touches flash (safety boundary)
//!
//! Deviations from EVT
//! - no flash writes at all (EVT OTA reprograms the image area); dual-image
//!   flag reported as 0
//! - fixed nominal MAC; bonding RAM-only (SNV off); no HAL_SLEEP

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

const OPTS: ble::Options = ble::Options {
    buf_max_len: 251,
    mem_len: 10240,
    connect_number: 0x0D,
    buf_number: 8,
    tx_power: ffi::LL_TX_POWEER_6_DBM,
};

const CMD_PROM: u8 = 0x80;
const CMD_ERASE: u8 = 0x81;
const CMD_VERIFY: u8 = 0x82;
const CMD_END: u8 = 0x83;
const CMD_INFO: u8 = 0x84;

struct Ctx {
    conn: u16,
    notify: Ticker,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    if attr_uuid(attr) != 0xFEE1 || len == 0 {
        return 0;
    }
    let buf = services::ota::value();
    match buf[0] {
        CMD_INFO => {
            // image flag 0 (no OTA pending), image size 0, block size 4096
            let resp: [u8; 8] = [CMD_INFO, 0, 0, 0, 0, 0, 0x00, 0x10];
            buf[..8].copy_from_slice(&resp);
            services::ota::set_resp_len(8);
            ble::println!("IAP_INFO answered (flag 0, block 4096)");
            0
        }
        CMD_PROM | CMD_ERASE | CMD_VERIFY | CMD_END => {
            ble::println!("IAP cmd 0x{:02x} refused: flash writes disabled in test", buf[0]);
            ATT_ERR_WRITE_NOT_PERMITTED
        }
        _ => ATT_ERR_INVALID_VALUE_SIZE,
    }
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = link.connectionHandle;
                ctx.notify = Ticker::new(1000);
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
    if ctx.conn != INVALID_CONNHANDLE && ctx.notify.due(now) {
        ble_evt_tests::notify_if(ctx.conn, services::simple8::cccd4(), services::simple8::char4_handle(), &[0x88; 8]);
    }
}

#[entry]
fn main() -> ! {
    let mut cfg = BootCfg::peripheral();
    cfg.options = OPTS;
    let boot = ble_evt_tests::boot(cfg);
    let task = boot.task_id;

    set_app_handler(on_event);
    set_write_hook(on_write);
    bond_peripheral(true, GAPBOND_IO_CAP_DISPLAY_ONLY);
    set_peripheral_conn(6, 12, 0, 1000);

    add_gatt_services();
    let _ = services::simple8::register();
    let _ = services::ota::register();
    set_device_name("Simple Peripheral");

    let mut adv = ble_evt_tests::adv::simple_adv(0xFFE0);
    set_adv_data(adv.as_slice());
    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"Simple Peripheral")
        .conn_interval_range(6, 12)
        .tx_power(0);
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(160); // 100 ms

    start_peripheral(task);

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            notify: Ticker::new(1000),
        });
    }

    ble::println!("advertising: Simple Peripheral (OTA surface, flash-safe)");
    ble_evt_tests::run(on_tick)
}