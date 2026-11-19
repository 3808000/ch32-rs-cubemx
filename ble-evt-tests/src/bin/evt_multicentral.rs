//! MultiCentral — spec source `docs/m18-evt-specs.md` (MultiCentral).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - 3 central slots; scans for peers named `M18-PEER` (host may register
//!   several advertising instances); each established link runs MTU exchange,
//!   FFE0/FFE1+CCCD discovery, subscribe, then 0x5A write/read every 1600 ms
//! - with a single host peer only one slot fills; the remaining slots keep
//!   scanning (honest partial verification, see results matrix)
//!
//! Deviations from EVT
//! - EVT targets three fixed MACs (...:02/:03/:04); peers matched by name here
//! - CLK_OSC32K=0 as EVT; bonding RAM-only (SNV off); no HAL_SLEEP

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use core::ptr::addr_of;
use core::ptr::addr_of_mut;
use panic_halt as _;
use qingke_rt::entry;

ble_evt_tests::ble_isr!();

const SLOTS: usize = 3;

static mut LINKS: [Option<SingleLink>; SLOTS] = [None; SLOTS];
static mut CYCLE: Option<Ticker> = None;

unsafe fn free_slot() -> Option<usize> {
    let links = &*addr_of!(LINKS);
    (0..SLOTS).find(|&i| links[i].is_none())
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_DEVICE_INFO_EVENT => {
            let info = (*event).deviceInfo;
            let data = core::slice::from_raw_parts(info.pEvtData, info.dataLen as usize);
            // avoid re-connecting to an address we already hold
            let known = (&*addr_of!(LINKS))
                .iter()
                .flatten()
                .any(|l| l.conn != INVALID_CONNHANDLE);
            if adv_name_is(data, PEER_NAME.as_bytes()) && free_slot().is_some() && !known {
                let _ = establish_link(info.addrType, &info.addr);
            }
        }
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(i) = free_slot() {
                (&mut *addr_of_mut!(LINKS))[i] = Some(SingleLink::new(link.connectionHandle, task_id()));
                *addr_of_mut!(CYCLE) = Some(Ticker::new(1600));
                ble::println!("slot {} connected 0x{:04x}", i, link.connectionHandle);
            }
        }
        GAP_LINK_TERMINATED_EVENT => {
            let term = (*event).linkTerminate;
            for slot in (&mut *addr_of_mut!(LINKS)).iter_mut() {
                if let Some(l) = slot {
                    if l.conn == term.connectionHandle {
                        *slot = None;
                    }
                }
            }
            ble::println!("disconnected 0x{:04x}", term.connectionHandle);
            start_scan(2400, 50, true);
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            if free_slot().is_some() {
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
    let due = (unsafe { &mut *addr_of_mut!(CYCLE) })
        .as_mut()
        .map(|c| c.due(now))
        .unwrap_or(false);
    if !due {
        return;
    }
    for slot in (unsafe { &mut *addr_of_mut!(LINKS) }).iter_mut().flatten() {
        slot.tick(task_id());
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::central());
    let task = boot.task_id;

    set_gap_handler(on_gap);
    set_app_handler(on_event);
    set_gap_handler(on_gap);
    bond_central(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    set_central_conn(20, 100, 0, 100);

    add_gatt_services();
    start_central_role(task);
    start_scan(2400, 50, true);

    ble::println!("multicentral: {} slots, scanning for {}", SLOTS, PEER_NAME);
    ble_evt_tests::run(on_tick)
}