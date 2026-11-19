//! UART diagnostic clone of `evt_peripheral` — prints every setup status and
//! periodically reads back GAP role state. Root-cause probe for the
//! peripheral-family advertising silence (M18 D5 BLOCKED item).
//!
//! Independent implementation; spec source `docs/m18-evt-specs.md` §1.

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use core::ptr::addr_of_mut;
use qingke_rt::entry;

/// Print the panic message + location before halting (panic_halt is silent).
#[panic_handler]
fn panic(info: &core::panic::PanicInfo) -> ! {
    unsafe { ble::println!("PANIC {}", info) };
    loop {
        core::hint::spin_loop();
    }
}

ble_evt_tests::ble_isr!();

struct Ctx {
    conn: u16,
    notify: Ticker,
    rssi: Ticker,
    update: Deadline,
    probe: Ticker,
}

static mut CTX: Option<Ctx> = None;

unsafe fn dump_role(tag: &str) {
    let mut state: u32 = 0xFFFF_FFFF;
    let mut enabled: u32 = 0xFFFF_FFFF;
    let mut evtype: u32 = 0xFFFF_FFFF;
    let mut chanmap: u32 = 0xFFFF_FFFF;
    let s = GAPRole_GetParameter(GAPROLE_STATE, &mut state as *mut u32 as *mut _);
    let e = GAPRole_GetParameter(GAPROLE_ADVERT_ENABLED, &mut enabled as *mut u32 as *mut _);
    let t = GAPRole_GetParameter(GAPROLE_ADV_EVENT_TYPE, &mut evtype as *mut u32 as *mut _);
    let c = GAPRole_GetParameter(GAPROLE_ADV_CHANNEL_MAP, &mut chanmap as *mut u32 as *mut _);
    ble::println!(
        "{}: state={} (st {:?}) adv_en={} (st {:?}) evtype={} (st {:?}) chanmap=0x{:x} (st {:?}) clk={}",
        tag,
        state as u8, s,
        enabled as u8, e,
        evtype as u8, t,
        chanmap as u8, c,
        ble_evt_tests::system_clock()
    );
}

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    match attr_uuid(attr) {
        0xFFE1 => ble::println!("profile ChangeCB CHAR1, {} byte(s)", len),
        0xFFE3 => ble::println!("profile ChangeCB CHAR3, {} byte(s)", len),
        _ => {}
    }
    0
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    ble::println!("gap opcode 0x{:02x}", (*event).gap.opcode);
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            let connected = &mut *addr_of_mut!(CTX);
            if let Some(ctx) = connected {
                ctx.conn = link.connectionHandle;
                ctx.notify = Ticker::new(1600);
                ctx.rssi = Ticker::new(3200);
                ctx.update = Deadline::after(6400);
            }
            ble::println!(
                "connected 0x{:04x} interval {} latency {} timeout {}",
                link.connectionHandle,
                link.connInterval,
                link.connLatency,
                link.connTimeout
            );
        }
        GAP_LINK_TERMINATED_EVENT => {
            let term = (*event).linkTerminate;
            ble::println!("disconnected 0x{:04x} reason 0x{:02x}", term.connectionHandle, term.reason);
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = INVALID_CONNHANDLE;
            }
        }
        GAP_LINK_PARAM_UPDATE_EVENT => {
            let update = (*event).linkUpdate;
            ble::println!(
                "conn update 0x{:04x} status {} interval {}",
                update.connectionHandle,
                update.status,
                update.connInterval
            );
        }
        _ => {}
    }
}

unsafe fn on_event(event: u8, msg: *mut u8) {
    match event {
        ble::TmosEvent::GAP_MSG_EVENT => on_gap(msg as *mut gapRoleEvent_t),
        ble::TmosEvent::GATT_MSG_EVENT => {
            let message = &*(msg as *const gattMsgEvent_t);
            if let GattClientEvent::MtuUpdated { mtu, .. } = message.decode() {
                ble::println!("MTU updated {}", mtu);
            }
        }
        _ => {}
    }
}

fn on_tick(now: u32) {
    let ctx = unsafe { &mut *addr_of_mut!(CTX) };
    let Some(ctx) = ctx.as_mut() else { return };

    if ctx.probe.due(now) {
        unsafe { dump_role("tick") };
    }
    if ctx.conn == INVALID_CONNHANDLE {
        return;
    }
    if ctx.notify.due(now) {
        services::simple::notify_conn(ctx.conn, 0x88);
    }
    if ctx.rssi.due(now) {
        unsafe {
            let _ = GAPRole_ReadRssiCmd(ctx.conn);
        }
    }
    if ctx.update.due(now) {
        unsafe {
            let _ = GAPRole_PeripheralConnParamUpdateReq(ctx.conn, 6, 100, 0, 100, task_id());
        }
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(ble_evt_tests::BootCfg::central());
    let task = boot.task_id;

    set_app_handler(on_event);
    set_gap_handler(on_gap);
    set_write_hook(on_write);
    bond_peripheral(true, GAPBOND_IO_CAP_DISPLAY_ONLY);
    set_peripheral_conn(6, 100, 0, 100);

    // M17 hardware-passing order: role init → role params (adv enabled first)
    // → GGS/GATTServApp → init_char_cfg + register_service → StartDevice.
    unsafe {
        let i = GAPRole_PeripheralInit();
        ble::println!("PeripheralInit={:?}", i);
    }

    let mut adv = ble_evt_tests::adv::simple_adv(0xFFE0);
    unsafe {
        let s = GAPRole_SetParameter(
            GAPROLE_ADVERT_DATA,
            adv.as_slice().len() as u16,
            adv.as_slice().as_ptr() as *const _,
        );
        ble::println!("set adv_data len={} st={:?}", adv.as_slice().len(), s);
    }
    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"Simple Peripheral");
    unsafe {
        let s = GAPRole_SetParameter(
            GAPROLE_SCAN_RSP_DATA,
            rsp.as_slice().len() as u16,
            rsp.as_slice().as_ptr() as *const _,
        );
        ble::println!("set scan_rsp len={} st={:?}", rsp.as_slice().len(), s);
    }
    set_adv_interval(80);
    adv_enable(true);

    unsafe {
        let ggs = GGS_AddService(GATT_ALL_SERVICES);
        let gatt = GATTServApp::add_service(GATT_ALL_SERVICES);
        ble::println!("GGS_AddService={:?} GATTServApp_AddService={:?}", ggs, gatt);
        GATTServApp::init_char_cfg(INVALID_CONNHANDLE, services::simple::CCCD4.as_mut_ptr());
    }
    let reg = services::simple::register();
    ble::println!("simple::register={:?}", reg);
    set_device_name("Simple Peripheral");

    unsafe {
        let s = GAPRole_PeripheralStartDevice(task, bond_cbs(), role_cbs());
        ble::println!("PeripheralStartDevice={:?}", s);
        dump_role("after-start");
    }

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            notify: Ticker::new(1600),
            rssi: Ticker::new(3200),
            update: Deadline::never(),
            probe: Ticker::new(1000),
        });
    }

    ble::println!("advertising: Simple Peripheral");
    ble_evt_tests::run(on_tick)
}