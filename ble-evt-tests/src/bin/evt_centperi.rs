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
static mut PEER_ADDR: [u8; 6] = [0; 6];
static mut PEER_ADDR_TYPE: u8 = 0;
static mut CONNECTING: bool = false;

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_DEVICE_INFO_EVENT => {
            let info = (*event).deviceInfo;
            let data = core::slice::from_raw_parts(info.pEvtData, info.dataLen as usize);
            let idle = (*addr_of!(LINK)).is_none() && !*addr_of!(CONNECTING);
            if adv_name_is(data, PEER_NAME.as_bytes()) && idle {
                // GAP_EstablishLinkReq returns bleNotReady while a discovery
                // request is pending: cancel and establish on discovery done.
                *addr_of_mut!(PEER_ADDR) = info.addr;
                *addr_of_mut!(PEER_ADDR_TYPE) = info.addrType;
                *addr_of_mut!(CONNECTING) = true;
                let _ = GAPRole_CentralCancelDiscovery();
            }
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            if *addr_of!(CONNECTING) {
                let status =
                    establish_link(*addr_of!(PEER_ADDR_TYPE), &*addr_of!(PEER_ADDR));
                if status.is_err() {
                    *addr_of_mut!(CONNECTING) = false;
                    start_scan(2400, 50, true);
                }
            } else if (*addr_of!(LINK)).is_none() {
                start_scan(2400, 50, true);
            }
        }
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            let central_link = *addr_of!(CONNECTING);
            *addr_of_mut!(CONNECTING) = false;
            // The role is not carried in the event: a link we initiated is the
            // central face (CONNECTING was set); anything else is the host
            // connecting to our peripheral face. Without this split the host's
            // connection would start a GATT-client MTU exchange over the wrong
            // role.
            if central_link && (*addr_of!(LINK)).is_none() {
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
            *addr_of_mut!(CONNECTING) = false;
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
        // Deferred discovery steps (poll) must run before the periodic cycle.
        link.poll(now, task_id());
        if let Some(cycle) = (unsafe { &mut *addr_of_mut!(CYCLE) }).as_mut() {
            if cycle.due(now) {
                link.tick(task_id());
            }
        }
    }
}

#[entry]
fn main() -> ! {
    let mut cfg = BootCfg::central();
    cfg.options.buf_max_len = 251; // MTU 247 on the central side
    // 251-byte buffers at MTU 247 need a larger pool than the default 5:
    // with 5 the RX path starves, ATT responses/notifications are dropped and
    // the WCH client's request slot stays pending forever (blePending 0x16).
    cfg.options.buf_number = 20;
    let boot = ble_evt_tests::boot(cfg);
    let task = boot.task_id;

    set_gap_handler(on_gap);
    set_app_handler(on_event);
    set_gap_handler(on_gap);
    // EVT multi-role order: both role inits first (each calls GAP_Init and
    // resets shared GAP state), then parameters, then both StartDevices.
    peripheral_role_init();
    central_role_init();
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

    // Starting one role's device resets the link layer, so the central face
    // starts first and the advertiser last.
    let _ = start_central_device(task);
    // No PeripheralInit re-run here: it would drop the central role bit from
    // the combined role mask (scan then fails with bleIncorrectMode 0x12).
    let _ = start_peripheral_device(task);
    // Re-assert advertising after both role devices are up.
    adv_enable(true);
    let _ = start_scan_status(2400, 50, true);

    ble::println!("centperi: advertising + scanning for {}", PEER_NAME);
    ble_evt_tests::run(on_tick)
}