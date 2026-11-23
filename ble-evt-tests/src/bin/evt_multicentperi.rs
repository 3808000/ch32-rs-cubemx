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

ble_evt_tests::ble_isr!();

const SLOTS: usize = 3;

const OPTS: ble::Options = ble::Options {
    buf_max_len: 251, // MTU 247 on the central side
    mem_len: 10240,
    connect_number: 0x33, // 3 peripheral + 3 central
    buf_number: 20, // 251-byte buffers: 5/8 starve the RX path at MTU 247
    tx_power: ffi::LL_TX_POWEER_6_DBM,
};

static mut LINKS: [Option<SingleLink>; SLOTS] = [None; SLOTS];
static mut PCONNS: [u16; SLOTS] = [INVALID_CONNHANDLE; SLOTS];
static mut INITIATING: bool = false;
/// Peer address saved until the scan completes (establishing while discovery
/// is pending fails with bleNotReady 0x10).
static mut PENDING_ADDR: [u8; 6] = [0; 6];
static mut PENDING_TYPE: u8 = 0;
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
                *addr_of_mut!(PENDING_ADDR) = info.addr;
                *addr_of_mut!(PENDING_TYPE) = info.addrType;
                *addr_of_mut!(INITIATING) = true;
                let _ = GAPRole_CentralCancelDiscovery();
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
            if *addr_of!(INITIATING) {
                let status = establish_link(*addr_of!(PENDING_TYPE), &*addr_of!(PENDING_ADDR));
                if status.is_err() {
                    *addr_of_mut!(INITIATING) = false;
                    start_scan(2400, 50, true);
                }
            } else if free_central().is_some() {
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
    // Deferred/retried discovery steps run every millisecond.
    for slot in (unsafe { &mut *addr_of_mut!(LINKS) }).iter_mut().flatten() {
        slot.poll(now, task_id());
    }
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
    set_gap_handler(on_gap);
    // Multi-role bring-up (same order as evt_centperi): both role inits first
    // (each calls GAP_Init), then parameters, then the central device, then
    // the peripheral device without re-running PeripheralInit (it would drop
    // the central role bit and the scan would fail with 0x12).
    peripheral_role_init();
    central_role_init();
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
        ;
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(80);

    let _ = start_central_device(task);
    let _ = start_peripheral_device(task);
    adv_enable(true);
    let _ = start_scan_status(2400, 50, true);

    ble::println!("multicentperi: 3P+3C, scanning for {}", PEER_NAME);
    ble_evt_tests::run(on_tick)
}