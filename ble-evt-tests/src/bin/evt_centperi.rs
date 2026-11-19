//! CentPeri — spec source `docs/m18-evt-specs.md` (CentPeri).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - peripheral side: name `Simple Peripheral`, FFE0/FFE1..FFE5, FFE4 notify
//!   0x88 every 1600 ms (host connects and subscribes)
//! - central side: scans for `M18-PEER`, connects, MTU exchange, FFE1
//!   write/read cycle every 1600 ms (host GATT server as peer)
//! - both roles live in one firmware (1 peripheral + 3 central slots)
//!
//! Deviations from EVT
//! - central peer matched by name instead of fixed MAC 84:C2:E4:03:02:02
//! - CLK_OSC32K=0 as EVT CentPeri; bonding RAM-only (SNV off); no HAL_SLEEP

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
static mut PCNN: u16 = INVALID_CONNHANDLE;
static mut PNOTIFY: Option<Ticker> = None;
static mut CYCLE: Option<Ticker> = None;

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_DEVICE_INFO_EVENT => {
            let info = (*event).deviceInfo;
            let data = core::slice::from_raw_parts(info.pEvtData, info.dataLen as usize);
            if adv_name_is(data, PEER_NAME.as_bytes()) && (*addr_of!(LINK)).is_none() {
                let _ = establish_link(info.addrType, &info.addr);
            }
        }
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            // distinguish roles by whether we already hold a central link
            if (*addr_of!(LINK)).is_none() && (*addr_of!(PCNN)) == INVALID_CONNHANDLE {
                // first link: treat as central-side (we initiated)
                *addr_of_mut!(LINK) = Some(SingleLink::new(link.connectionHandle, task_id()));
                *addr_of_mut!(CYCLE) = Some(Ticker::new(1600));
            } else {
                *addr_of_mut!(PCNN) = link.connectionHandle;
                *addr_of_mut!(PNOTIFY) = Some(Ticker::new(1600));
            }
            ble::println!("connected 0x{:04x}", link.connectionHandle);
        }
        GAP_LINK_TERMINATED_EVENT => {
            let term = (*event).linkTerminate;
            if let Some(l) = &mut *addr_of_mut!(LINK) {
                if l.conn == term.connectionHandle {
                    *addr_of_mut!(LINK) = None;
                    start_scan(2400, 50, true);
                }
            }
            if *addr_of!(PCNN) == term.connectionHandle {
                *addr_of_mut!(PCNN) = INVALID_CONNHANDLE;
            }
            ble::println!("disconnected 0x{:04x}", term.connectionHandle);
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
    let pconn = unsafe { *addr_of!(PCNN) };
    if pconn != INVALID_CONNHANDLE {
        if let Some(t) = (unsafe { &mut *addr_of_mut!(PNOTIFY) }).as_mut() {
            if t.due(now) {
                services::simple::notify_conn(pconn, 0x88);
            }
        }
    }
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
    bond_peripheral(true, GAPBOND_IO_CAP_DISPLAY_ONLY);
    bond_central(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    set_peripheral_conn(6, 100, 0, 100);

    add_gatt_services();
    let _ = services::simple::register();
    set_device_name("Simple Peripheral");

    let mut adv = ble_evt_tests::adv::simple_adv(0xFFE0);
    set_adv_data(adv.as_slice());
    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"Simple Peripheral")
        ;
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(80);

    start_peripheral(task);
    start_central_role(task);
    start_scan(2400, 50, true);

    ble::println!("centperi: advertising + scanning for {}", PEER_NAME);
    ble_evt_tests::run(on_tick)
}