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
static mut STATUS: Option<Ticker> = None;
static mut PEER_ADDR: [u8; 6] = [0; 6];
static mut PEER_ADDR_TYPE: u8 = 0;
static mut CONNECTING: bool = false;

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_DEVICE_INFO_EVENT => {
            let info = (*event).deviceInfo;
            let data = core::slice::from_raw_parts(info.pEvtData, info.dataLen as usize);
            let idle = (*addr_of!(LINK)).is_none() && !*addr_of!(CONNECTING);
            let named = adv_name_is(data, PEER_NAME.as_bytes());
            if named && idle {
                ble::println!(
                    "peer found addrType {} evtType 0x{:02x} addr {:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                    info.addrType,
                    info.eventType,
                    info.addr[5],
                    info.addr[4],
                    info.addr[3],
                    info.addr[2],
                    info.addr[1],
                    info.addr[0],
                );
                // GAP_EstablishLinkReq returns bleNotReady while a discovery
                // request is pending, so cancel first and establish when the
                // discovery-complete event arrives (EVT central flow).
                *addr_of_mut!(PEER_ADDR) = info.addr;
                *addr_of_mut!(PEER_ADDR_TYPE) = info.addrType;
                *addr_of_mut!(CONNECTING) = true;
                let _ = GAPRole_CentralCancelDiscovery();
            }
        }
        GAP_LINK_ESTABLISHED_EVENT => {
            *addr_of_mut!(CONNECTING) = false;
            let link = (*event).linkCmpl;
            *addr_of_mut!(LINK) = Some(SingleLink::new(link.connectionHandle, task_id()));
            *addr_of_mut!(CYCLE) = Some(Ticker::new(1600));
            unsafe {
                let _ = GAPRole_UpdateLink(link.connectionHandle, 20, 100, 0, 600);
            }
        }
        GAP_LINK_TERMINATED_EVENT => {
            *addr_of_mut!(LINK) = None;
            *addr_of_mut!(CONNECTING) = false;
            ble::println!("link lost, rescanning");
            start_scan(2400, 50, true);
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            if *addr_of!(CONNECTING) {
                let status = establish_link(*addr_of!(PEER_ADDR_TYPE), &*addr_of!(PEER_ADDR));
                ble::println!("discovery cancelled, establish_link -> {:?}", status);
                if status.is_err() {
                    *addr_of_mut!(CONNECTING) = false;
                    start_scan(2400, 50, true);
                }
            } else if (*addr_of!(LINK)).is_none() {
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
    // Liveness heartbeat: stops if the main loop or TMOS hangs.
    static mut BEAT: Option<Ticker> = None;
    let beat = unsafe {
        (&mut *addr_of_mut!(BEAT))
            .get_or_insert_with(|| Ticker::new(1000))
            .due(now)
    };
    if beat {
        ble::println!("hb");
    }
    let mut ready_stats = None;
    if let Some(link) = (unsafe { &mut *addr_of_mut!(LINK) }).as_mut() {
        link.poll(now, task_id());
        if let Some(cycle) = (unsafe { &mut *addr_of_mut!(CYCLE) }).as_mut() {
            if cycle.due(now) {
                link.tick(task_id());
            }
        }
        if link.is_ready() {
            ready_stats = Some((
                link.mtu,
                link.writes,
                link.reads,
                link.notifications,
                link.rx_bytes,
            ));
        }
    }
    if let Some(stats) = ready_stats {
        // 5 s cadence: proves notification reception in the UART log.
        let due = unsafe {
            let ticker = (&mut *addr_of_mut!(STATUS)).get_or_insert_with(|| Ticker::new(5000));
            ticker.due(now)
        };
        if due {
            ble::println!(
                "[central] stats mtu {} writes {} reads {} noti {} rx {}",
                stats.0,
                stats.1,
                stats.2,
                stats.3,
                stats.4
            );
        }
    }
}

#[entry]
fn main() -> ! {
    let mut boot_cfg = BootCfg::central();
    // MTU 247 exchange (central.rs REQUESTED_MTU) needs 251-byte buffers, and
    // incoming notifications need spare RX buffers: the EVT SpeedTest_Central
    // configuration uses BLE_BUFF_NUM=20 for the same MTU.
    boot_cfg.options.buf_max_len = 251;
    boot_cfg.options.buf_number = 20;
    let boot = ble_evt_tests::boot(boot_cfg);
    let task = boot.task_id;

    set_gap_handler(on_gap);
    set_app_handler(on_event);

    add_gatt_services();
    // Role init (GAP_Init / GAPBondMgr_Init) resets GAP and bond parameters,
    // so they must be applied afterwards; otherwise the defaults (100 ms
    // interval, 20 s supervision) end up in the CONNECT_IND.
    start_central_role(task);
    bond_central(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    set_gap_param(TGAP_CONN_EST_INT_MIN, 20);
    set_gap_param(TGAP_CONN_EST_INT_MAX, 60);
    set_gap_param(TGAP_CONN_EST_SUPERV_TIMEOUT, 100);
    start_scan(2400, 50, true);

    ble::println!("scanning for {}", PEER_NAME);
    ble_evt_tests::run(on_tick)
}
