//! SpeedTest Peripheral — spec source `docs/m18-evt-specs.md` (SpeedTest_Peripheral).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - name `Simple Peripheral`, service FFE0 (FFE1..FFE5), MTU 247 (BufMaxLen 251)
//! - 2 s after connect: flood FFE4 notifications of (MTU-3) bytes until the
//!   stack buffer pool refuses allocation; host counts bytes/s
//!
//! Deviations from EVT
//! - fixed nominal MAC (EVT SpeedTest_Peripheral defines BLE_MAC=1 with
//!   84:C2:E4:03:02:02; kept as nominal default here, host matches by name)
//! - bonding RAM-only (SNV off); no HAL_SLEEP

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use core::ptr::addr_of;
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
    buf_number: 20,
    tx_power: ffi::LL_TX_POWEER_6_DBM,
};

struct Ctx {
    conn: u16,
    mtu: u16,
    enable: Deadline,
    flooding: bool,
    sent: u32,
}

static mut CTX: Option<Ctx> = None;
static mut PAYLOAD: [u8; 244] = [0x5A; 244];

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = link.connectionHandle;
                ctx.enable = Deadline::after(2000);
                ctx.flooding = false;
                ctx.sent = 0;
            }
            ble::println!("connected 0x{:04x}", link.connectionHandle);
        }
        GAP_LINK_TERMINATED_EVENT => {
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = INVALID_CONNHANDLE;
                ctx.flooding = false;
            }
            ble::println!("disconnected after {} notifications", unsafe {
                (*addr_of!(CTX)).as_ref().map(|c| c.sent).unwrap_or(0)
            });
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
                if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                    ctx.mtu = mtu;
                }
                ble::println!("MTU updated {}", mtu);
            }
        }
        _ => {}
    }
}

fn on_tick(now: u32) {
    let Some(ctx) = (unsafe { &mut *addr_of_mut!(CTX) }).as_mut() else {
        return;
    };
    if ctx.conn == INVALID_CONNHANDLE {
        return;
    }
    if !ctx.flooding {
        if ctx.enable.due(now) {
            ctx.flooding = true;
            ble::println!("speed test start, mtu {}", ctx.mtu);
        }
        return;
    }
    // Flood within one tick: keep sending until bm_alloc refuses, then yield
    // to the TMOS pump so connection events actually drain the queue.
    let len = (ctx.mtu.saturating_sub(3)).min(244) as usize;
    let handle = services::simple8::char4_handle();
    let cccd = services::simple8::cccd4();
    for _ in 0..64 {
        if !ble_evt_tests::notify_if(ctx.conn, cccd, handle, &unsafe { &*addr_of!(PAYLOAD) }[..len]) {
            break;
        }
        ctx.sent += 1;
    }
}

#[entry]
fn main() -> ! {
    let mut cfg = BootCfg::peripheral();
    cfg.options = OPTS;
    cfg.sel_rtc_clock = 0; // EVT SpeedTest_Peripheral: CLK_OSC32K=0
    let boot = ble_evt_tests::boot(cfg);
    let task = boot.task_id;

    set_app_handler(on_event);
    bond_peripheral(true, GAPBOND_IO_CAP_DISPLAY_ONLY);
    set_peripheral_conn(6, 100, 0, 100);

    add_gatt_services();
    let _ = services::simple8::register();
    set_device_name("Simple Peripheral");

    let mut adv = ble_evt_tests::adv::simple_adv(0xFFE0);
    set_adv_data(adv.as_slice());
    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"Simple Peripheral")
        .conn_interval_range(6, 100)
        .tx_power(0);
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(80);

    start_peripheral(task);

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            mtu: 23,
            enable: Deadline::never(),
            flooding: false,
            sent: 0,
        });
    }

    ble::println!("advertising: Simple Peripheral (speed test)");
    ble_evt_tests::run(on_tick)
}