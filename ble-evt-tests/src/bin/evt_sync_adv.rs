//! SYNC_ADV — spec source `docs/m18-evt-specs.md` (SYNC_ADV).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - extended non-connectable non-scannable advertising (type 0x07), 100 ms
//!   primary interval, flags 0x04 + manufacturer "ble" + short name `abc`
//! - periodic advertising train: SID 8, 100 ms interval (80 × 1.25 ms),
//!   TxPower included, secondary PHY LE 1M, max skip 0
//! - periodic payload 44 bytes: manufacturer header + 40 bytes cycling 1..10,
//!   byte[5] increments once per second
//! - BlueZ exposes no periodic-sync API: verification is build-only here plus
//!   a second board running evt_sync_scan (honest limitation, see matrix)
//!
//! Deviations from EVT
//! - EVT defines BLE_MAC=1 (84:C2:E4:03:02:02); nominal MAC used here
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

static mut PERIODIC: [u8; 44] = [0; 44];
static mut TICK: Option<Ticker> = None;
static mut COUNTER: u8 = 0;

unsafe fn publish_periodic() {
    let p = &mut *addr_of_mut!(PERIODIC);
    // manufacturer-specific AD structure inside the periodic payload
    p[0] = 43; // length of remaining AD structure
    p[1] = 0xFF; // manufacturer specific
    p[2] = b'b';
    p[3] = b'l';
    p[4] = b'e';
    p[5] = *addr_of!(COUNTER);
    for i in 6..44 {
        p[i] = ((i - 6) % 10 + 1) as u8;
    }
    let _ = GAPRole_SetParameter(
        GAPROLE_PERIODIC_ADVERT_DATA,
        p.len() as u16,
        p.as_ptr() as *const _,
    );
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_DEVICE_INIT_DONE_EVENT => ble::println!("sync advertiser started"),
        GAP_MAKE_PERIODIC_ADV_DONE_EVENT => ble::println!("periodic advertising enabled"),
        _ => {}
    }
}

unsafe fn on_event(event: u8, msg: *mut u8) {
    if event == ble::TmosEvent::GAP_MSG_EVENT {
        on_gap(msg as *mut gapRoleEvent_t);
    }
}

fn on_tick(now: u32) {
    let due = (unsafe { &mut *addr_of_mut!(TICK) })
        .as_mut()
        .map(|t| t.due(now))
        .unwrap_or(false);
    if due {
        unsafe {
            *addr_of_mut!(COUNTER) = (*addr_of!(COUNTER)).wrapping_add(1);
            publish_periodic();
        }
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;

    set_gap_handler(on_gap);
    set_app_handler(on_event);

    unsafe {
        let _ = GAPRole_BroadcasterInit();
    }
    set_device_name("Broadcaster");
    set_adv_type(GAP_ADTYPE_EXT_NONCONN_NONSCAN_UNDIRECT);
    set_adv_interval(160); // 100 ms primary

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.manufacturer(b"ble");
    adv.name_short(b"abc");
    set_adv_data(adv.as_slice());

    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"Broadcaster").tx_power(0);
    set_scan_rsp(rsp.as_slice());

    // periodic train parameters (1.25 ms units for interval)
    set_gap_param(TGAP_PERIODIC_ADV_INT_MIN, 80);
    set_gap_param(TGAP_PERIODIC_ADV_INT_MAX, 80);
    set_gap_param(TGAP_PERIODIC_ADV_PROPERTIES, GAP_PERI_PROPERTIES_INCLUDE_TXPOWER);
    set_gap_param(TGAP_ADV_SECONDARY_PHY, GAP_PHY_VAL_LE_1M as u16);
    set_gap_param(TGAP_ADV_SECONDARY_MAX_SKIP, 0);
    set_gap_param(TGAP_ADV_ADVERTISING_SID, 8);

    unsafe {
        publish_periodic();
        let _ = GAPRole_BroadcasterStartDevice(broadcaster_cbs());
    }
    adv_enable(true);
    set_role_u8(GAPROLE_PERIODIC_ADVERT_ENABLED, 1);

    unsafe {
        *addr_of_mut!(TICK) = Some(Ticker::new(1000));
    }

    ble::println!("advertising: SYNC_ADV sid 8");
    ble_evt_tests::run(on_tick)
}