//! Broadcaster — spec source `docs/m18-evt-specs.md` (Broadcaster).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - non-connectable advertising every 100 ms, flags 0x04 (BREDR not supported),
//!   manufacturer payload `62 6C 65 04` ("ble"+len), short name `abc`
//! - scan response: complete name `Broadcaster` + Tx power 0
//! - host passive scan (btmgmt find / hcitool lescan) sees the payloads;
//!   bluez StartDiscovery may filter flags==0x04 per spec (noted deviation)
//!
//! Deviations from EVT
//! - fixed nominal MAC; no HAL_SLEEP (EVT never enabled it)

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use panic_halt as _;
use qingke_rt::entry;

ble_evt_tests::ble_isr!();

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    if (*event).gap.opcode == GAP_DEVICE_INIT_DONE_EVENT {
        ble::println!("broadcaster started");
    }
}

unsafe fn on_event(event: u8, msg: *mut u8) {
    if event == ble::TmosEvent::GAP_MSG_EVENT {
        on_gap(msg as *mut gapRoleEvent_t);
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_app_handler(on_event);
    set_gap_handler(on_gap);

    unsafe {
        let _ = GAPRole_BroadcasterInit();
    }
    set_device_name("Broadcaster");
    set_adv_type(GAP_ADTYPE_ADV_NONCONN_IND);
    set_adv_interval(160); // 100 ms

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.manufacturer(b"ble\x04");
    adv.name_short(b"abc");
    set_adv_data(adv.as_slice());

    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"Broadcaster");
    set_scan_rsp(rsp.as_slice());

    unsafe {
        let _ = GAPRole_BroadcasterStartDevice(broadcaster_cbs());
    }
    adv_enable(true);

    ble::println!("advertising: Broadcaster (non-connectable)");
    ble_evt_tests::run(|_now| {})
}