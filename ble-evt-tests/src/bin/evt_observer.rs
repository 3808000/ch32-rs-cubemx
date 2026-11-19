//! Observer — spec source `docs/m18-evt-specs.md` (Observer).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - passive-role scanner: 3 s active scan windows (4800 × 0.625 ms), max 50
//!   results, no whitelist; prints address/RSSI/name of every advertisement
//!   (host runs `peer_advertiser.py` advertising `M18-ADV`), then restarts scan
//! - observer itself does not advertise; verification is via its UART log
//!
//! Deviations from EVT
//! - log goes to UART1 PA9 (shim default serial) instead of EVT UART config
//! - no HAL_SLEEP (EVT never enabled it)

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
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

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_DEVICE_INFO_EVENT => {
            let info = (*event).deviceInfo;
            let data = core::slice::from_raw_parts(info.pEvtData, info.dataLen as usize);
            let name = find_adv_name(data).unwrap_or(b"<no name>");
            ble::println!(
                "adv {:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X} rssi {} name {:?}",
                info.addr[5],
                info.addr[4],
                info.addr[3],
                info.addr[2],
                info.addr[1],
                info.addr[0],
                info.rssi,
                core::str::from_utf8(name).unwrap_or("<bin>")
            );
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            let disc = (*event).discCmpl;
            ble::println!("scan complete: {} devices, restarting", disc.numDevs);
            let _ = GAPRole_ObserverStartDiscovery(DEVDISC_MODE_ALL, 1, 0);
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
    set_gap_param(TGAP_DISC_SCAN, 4800); // 3 s
    set_role_u8(GAPROLE_MAX_SCAN_RES, 50);
    unsafe {
        let _ = GAPRole_ObserverStartDiscovery(DEVDISC_MODE_ALL, 1, 0);
    }

    ble::println!("observer: scanning 3 s windows");
    ble_evt_tests::run(|_now| {})
}