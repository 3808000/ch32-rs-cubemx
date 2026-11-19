//! Central — spec source `docs/m18-evt-specs.md` (Central).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - 1.5 s active scan (2400 × 0.625 ms), connects to peer named `M18-PEER`,
//!   MTU exchange (247 requested), discovers FFE0 → FFE1 + CCCD, subscribes,
//!   then alternating write 0x5A / read FFE1 every 1600 ms; prints notify values
//! - connection estimate 20..60 (25..75 ms), supervision 100 (1 s)
//!
//! Deviations from EVT
//! - EVT targets fixed MAC 84:C2:E4:03:02:02; peer matched by name here
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

static mut LINK: Option<SingleLink> = None;
static mut CYCLE: Option<Ticker> = None;

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_DEVICE_INFO_EVENT => {
            let info = (*event).deviceInfo;
            let data = core::slice::from_raw_parts(info.pEvtData, info.dataLen as usize);
            let idle = (*addr_of!(LINK)).is_none();
            if adv_name_is(data, PEER_NAME.as_bytes()) && idle {
                ble::println!("peer found, establishing link");
                let _ = establish_link(info.addrType, &info.addr);
            }
        }
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            *addr_of_mut!(LINK) = Some(SingleLink::new(link.connectionHandle, task_id()));
            *addr_of_mut!(CYCLE) = Some(Ticker::new(1600));
            unsafe {
                let _ = GAPRole_UpdateLink(link.connectionHandle, 20, 100, 0, 600);
            }
        }
        GAP_LINK_TERMINATED_EVENT => {
            *addr_of_mut!(LINK) = None;
            ble::println!("link lost, rescanning");
            start_scan(2400, 50, true);
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            if (*addr_of!(LINK)).is_none() {
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
    set_gap_param(TGAP_CONN_EST_INT_MIN, 20);
    set_gap_param(TGAP_CONN_EST_INT_MAX, 60);
    set_gap_param(TGAP_CONN_EST_SUPERV_TIMEOUT, 100);

    add_gatt_services();
    start_central_role(task);
    start_scan(2400, 50, true);

    ble::println!("scanning for {}", PEER_NAME);
    ble_evt_tests::run(on_tick)
}