//! SpeedTest Central — spec source `docs/m18-evt-specs.md` (SpeedTest_Central).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - scans for a peer advertising name `M18-PEER` (host GATT server), connects,
//!   exchanges MTU 247, discovers FFE0/FFE4+CCCD, subscribes and counts
//!   notification bytes/s; periodic 0x5A write to FFE1 every 1600 ms
//!
//! Deviations from EVT
//! - EVT targets fixed MAC 84:C2:E4:03:02:02; here the peer is matched by name
//! - CLK_OSC32K=0 as EVT; bonding RAM-only (SNV off); no HAL_SLEEP

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

static mut LINK: Option<SingleLink> = None;
static mut CYCLE: Option<Ticker> = None;
static mut STATS: Option<Ticker> = None;

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_DEVICE_INFO_EVENT => {
            let info = (*event).deviceInfo;
            let data = core::slice::from_raw_parts(info.pEvtData, info.dataLen as usize);
            let idle = (*addr_of!(LINK)).as_ref().map(|l| l.conn == INVALID_CONNHANDLE).unwrap_or(true);
            if adv_name_is(data, PEER_NAME.as_bytes()) && idle {
                ble::println!("peer found, establishing link");
                let _ = establish_link(info.addrType, &info.addr);
            }
        }
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            *addr_of_mut!(LINK) = Some(SingleLink::new(link.connectionHandle, task_id()));
            *addr_of_mut!(CYCLE) = Some(Ticker::new(1600));
            *addr_of_mut!(STATS) = Some(Ticker::new(5000));
        }
        GAP_LINK_TERMINATED_EVENT => {
            if let Some(l) = &mut *addr_of_mut!(LINK) {
                ble::println!(
                    "link lost: {} notifications, {} bytes, {} writes",
                    l.notifications,
                    l.rx_bytes,
                    l.writes
                );
            }
            *addr_of_mut!(LINK) = None;
            start_scan(2400, 50, true);
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            let idle = (*addr_of!(LINK)).is_none();
            if idle {
                start_scan(2400, 50, true);
            }
        }
        _ => {}
    }
}

unsafe fn on_event(event: u8, msg: *mut u8) {
    match event {
        ble::TmosEvent::GAP_MSG_EVENT => on_gap(msg as *mut gapRoleEvent_t),
        ble::TmosEvent::GATT_MSG_EVENT => {
            let message = &*(msg as *const gattMsgEvent_t);
            let decoded = message.decode();
            if let Some(link) = &mut *addr_of_mut!(LINK) {
                link.handle(&decoded, task_id());
            }
        }
        _ => {}
    }
}

fn on_tick(now: u32) {
    if let Some(link) = (unsafe { &mut *addr_of_mut!(LINK) }).as_mut() {
        if let Some(cycle) = (unsafe { &mut *addr_of_mut!(CYCLE) }).as_mut() {
            if cycle.due(now) {
                link.tick(task_id());
            }
        }
        if let Some(stats) = (unsafe { &mut *addr_of_mut!(STATS) }).as_mut() {
            if stats.due(now) {
                ble::println!(
                    "throughput: {} notifications / {} bytes (mtu {})",
                    link.notifications,
                    link.rx_bytes,
                    link.mtu
                );
            }
        }
    }
}

#[entry]
fn main() -> ! {
    let mut cfg = BootCfg::central();
    cfg.options = OPTS;
    let boot = ble_evt_tests::boot(cfg);
    let task = boot.task_id;

    set_gap_handler(on_gap);
    set_app_handler(on_event);
    bond_central(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    set_central_conn(12, 12, 0, 600);

    add_gatt_services();
    start_central_role(task);
    start_scan(2400, 50, true);

    ble::println!("scanning for {}", PEER_NAME);
    ble_evt_tests::run(on_tick)
}