//! MultiCentPeri — spec source `docs/m18-evt-specs.md` (MultiCentPeri).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - peripheral side: 3 connection slots, name `Simple Peripheral`, FFE0 with
//!   FFE1..FFE5; FFE4 notifies 0x88 every 1600 ms per subscribed connection
//! - central side: 3 slots scanning for `M18-PEER`, MTU exchange + FFE1
//!   write/read cycle every 1600 ms per link
//! - heap 10 KiB / BufMaxLen 27 / 3P+3C as EVT MultiCentPeri .cproject
//!
//! Deviations from EVT
//! - central peers matched by name instead of three fixed MACs
//! - CLK_OSC32K=0 as EVT; bonding RAM-only (SNV off); no HAL_SLEEP
//! - with one host peer only one central slot and one peripheral slot fill

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

const SLOTS: usize = 3;

const OPTS: ble::Options = ble::Options {
    buf_max_len: 27,
    mem_len: 10240,
    connect_number: 0x33, // 3 peripheral + 3 central
    buf_number: 8,
    tx_power: ffi::LL_TX_POWEER_6_DBM,
};

static mut LINKS: [Option<SingleLink>; SLOTS] = [None; SLOTS];
static mut PCONNS: [u16; SLOTS] = [INVALID_CONNHANDLE; SLOTS];
static mut INITIATING: bool = false;
static mut PNOTIFY: Option<Ticker> = None;
static mut CYCLE: Option<Ticker> = None;

unsafe fn free_central() -> Option<usize> {
    (0..SLOTS).find(|&i| (&*addr_of!(LINKS))[i].is_none())
}

unsafe fn free_peripheral() -> Option<usize> {
    (0..SLOTS).find(|&i| (&*addr_of!(PCONNS))[i] == INVALID_CONNHANDLE)
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_DEVICE_INFO_EVENT => {
            let info = (*event).deviceInfo;
            let data = core::slice::from_raw_parts(info.pEvtData, info.dataLen as usize);
            if adv_name_is(data, PEER_NAME.as_bytes()) && free_central().is_some() && !*addr_of!(INITIATING) {
                *addr_of_mut!(INITIATING) = true;
                let _ = establish_link(info.addrType, &info.addr);
            }
        }
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if *addr_of!(INITIATING) {
                *addr_of_mut!(INITIATING) = false;
                if let Some(i) = free_central() {
                    (&mut *addr_of_mut!(LINKS))[i] = Some(SingleLink::new(link.connectionHandle, task_id()));
                    *addr_of_mut!(CYCLE) = Some(Ticker::new(1600));
                    ble::println!("central slot {} conn 0x{:04x}", i, link.connectionHandle);
                }
            } else if let Some(i) = free_peripheral() {
                (&mut *addr_of_mut!(PCONNS))[i] = link.connectionHandle;
                *addr_of_mut!(PNOTIFY) = Some(Ticker::new(1600));
                ble::println!("peripheral slot {} conn 0x{:04x}", i, link.connectionHandle);
            }
        }
        GAP_LINK_TERMINATED_EVENT => {
            let term = (*event).linkTerminate;
            *addr_of_mut!(INITIATING) = false;
            for slot in (&mut *addr_of_mut!(LINKS)).iter_mut() {
                if let Some(l) = slot {
                    if l.conn == term.connectionHandle {
                        *slot = None;
                    }
                }
            }
            for p in (&mut *addr_of_mut!(PCONNS)).iter_mut() {
                if *p == term.connectionHandle {
                    *p = INVALID_CONNHANDLE;
                }
            }
            ble::println!("disconnected 0x{:04x}", term.connectionHandle);
            if free_central().is_some() {
                start_scan(2400, 50, true);
            }
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            if free_central().is_some() {
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
            for slot in (&mut *addr_of_mut!(LINKS)).iter_mut().flatten() {
                slot.handle(&decoded, task_id());
            }
        }
        _ => {}
    }
}

fn on_tick(now: u32) {
    let pdue = (unsafe { &mut *addr_of_mut!(PNOTIFY) })
        .as_mut()
        .map(|t| t.due(now))
        .unwrap_or(false);
    if pdue {
        for &conn in unsafe { &*addr_of!(PCONNS) } {
            if conn != INVALID_CONNHANDLE {
                ble_evt_tests::notify_if(conn, services::simple8::cccd4(), services::simple8::char4_handle(), &[0x88; 8]);
            }
        }
    }
    let cdue = (unsafe { &mut *addr_of_mut!(CYCLE) })
        .as_mut()
        .map(|t| t.due(now))
        .unwrap_or(false);
    if cdue {
        for slot in (unsafe { &mut *addr_of_mut!(LINKS) }).iter_mut().flatten() {
            slot.tick(task_id());
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
    bond_peripheral(true, GAPBOND_IO_CAP_DISPLAY_ONLY);
    bond_central(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
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
    start_central_role(task);
    start_scan(2400, 50, true);

    ble::println!("multicentperi: 3P+3C, scanning for {}", PEER_NAME);
    ble_evt_tests::run(on_tick)
}