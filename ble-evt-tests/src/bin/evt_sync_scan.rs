//! SYNC_SCAN — spec source `docs/m18-evt-specs.md` (SYNC_SCAN).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - passive extended scan (3 s windows, 58 max results); on an extended
//!   advertisement with periodicAdvInterval != 0, creates a periodic sync
//!   (skip 0, syncTimeout = (interval*6+7)/8 in 10 ms units)
//! - prints GAP_SYNC_ESTABLISHED / periodic payload (len + byte[5] counter) /
//!   GAP_SYNC_LOST; lost sync restarts scanning
//! - needs a peer running evt_sync_adv (second board); BlueZ cannot sync to
//!   periodic trains, so host-side verification is build-only (see matrix)
//!
//! Deviations from EVT
//! - EVT filters on fixed MAC 84:C2:E4:03:02:02; here any periodic advertiser
//! - no HAL_SLEEP (EVT never enabled it)

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

static mut SYNCED: bool = false;

unsafe fn rescan() {
    *addr_of_mut!(SYNCED) = false;
    let _ = GAPRole_ObserverStartDiscovery(DEVDISC_MODE_ALL, 0, 0);
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_EXT_ADV_DEVICE_INFO_EVENT => {
            let info = (*event).deviceExtAdvInfo;
            if info.periodicAdvInterval != 0 && !*addr_of!(SYNCED) {
                let timeout = (info.periodicAdvInterval * 6 + 7) / 8;
                let mut sync = gapCreateSync_t {
                    options: 0,
                    advertising_SID: info.advertisingSID,
                    addrType: info.addrType,
                    addr: info.addr,
                    skip: 0,
                    syncTimeout: timeout,
                    syncCTEType: 0,
                };
                ble::println!(
                    "periodic advertiser sid {} interval {}, creating sync",
                    info.advertisingSID,
                    info.periodicAdvInterval
                );
                let _ = GAPRole::create_sync(&mut sync);
            }
        }
        GAP_SYNC_ESTABLISHED_EVENT => {
            let est = (*event).syncEstEvt;
            *addr_of_mut!(SYNCED) = true;
            ble::println!("sync established handle 0x{:04x}", est.syncHandle);
        }
        GAP_PERIODIC_ADV_DEVICE_INFO_EVENT => {
            let info = (*event).devicePeriodicInfo;
            let data = core::slice::from_raw_parts(info.pEvtData, info.dataLength as usize);
            ble::println!(
                "periodic data len {} byte5 {}",
                data.len(),
                data.get(5).copied().unwrap_or(0)
            );
        }
        GAP_SYNC_LOST_EVENT => {
            ble::println!("sync lost, rescanning");
            rescan();
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            if !*addr_of!(SYNCED) {
                rescan();
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

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_gap_handler(on_gap);
    set_app_handler(on_event);

    unsafe {
        let _ = GAPRole_ObserverInit();
        let _ = GAPRole_ObserverStartDevice(observer_cbs());
    }
    set_gap_param(TGAP_DISC_SCAN, 4800);
    set_role_u8(GAPROLE_MAX_SCAN_RES, 58);
    unsafe {
        let _ = GAPRole_ObserverStartDiscovery(DEVDISC_MODE_ALL, 0, 0);
    }

    ble::println!("sync scan: passive extended scan");
    ble_evt_tests::run(|_now| {})
}