//! BLE_UART — spec source `docs/m18-evt-specs.md` (BLE_UART, 16-bit variant).
//!
//! Independent implementation; not a translation of EVT sources.
//!
//! Host-side criteria
//! - name `ch583_ble_uart`, service FFF0 with FFF1 notify (BLE→host) and
//!   FFF2 write/write-no-rsp (host→BLE), 100 ms advertising
//! - writing FFF2 echoes the bytes back on FFF1 (EVT "notify back test") AND
//!   forwards them to UART3 TX; bytes received on UART3 RX notify on FFF1
//! - UART3 = PA5 (TX) / PA4 (RX), remap 0, 115200 8N1 (CH583 EVT pins, both
//!   bonded out on CH582M QFN48)
//!
//! Deviations from EVT
//! - fixed nominal MAC; bonding RAM-only (SNV off); no HAL_SLEEP
//! - notify payload capped at negotiated MTU-3 (EVT uses ATT_GetMTU()-3)

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
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

struct Ctx {
    conn: u16,
    mtu: u16,
    uart: hal::uart::Uart<'static, hal::peripherals::UART3, hal::mode::Blocking>,
    rx: [u8; 64],
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    if attr_uuid(attr) != 0xFFF2 {
        return 0;
    }
    let Some(ctx) = &mut *addr_of_mut!(CTX) else {
        return 0;
    };
    let src = services::uart::V2.as_ptr();
    let n = (len as usize).min(1);
    let bytes = core::slice::from_raw_parts(src, n);
    // forward to UART3 TX (best effort; blocking write)
    let _ = ctx.uart.blocking_write(bytes);
    // echo back over BLE so the host can verify without a UART loopback
    if ctx.conn != INVALID_CONNHANDLE {
        let cap = (ctx.mtu.saturating_sub(3)).max(1) as usize;
        let chunk = &bytes[..n.min(cap)];
        let _ = ble_evt_tests::notify_if(
            ctx.conn,
            services::uart::cccd_tx(),
            services::uart::tx_handle(),
            chunk,
        );
    }
    0
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = link.connectionHandle;
            }
            ble::println!("connected 0x{:04x}", link.connectionHandle);
        }
        GAP_LINK_TERMINATED_EVENT => {
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = INVALID_CONNHANDLE;
            }
            ble::println!("disconnected");
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
                if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                    ctx.mtu = mtu;
                }
                ble::println!("MTU updated {}", mtu);
            }
        }
        _ => {}
    }
}

fn on_tick(_now: u32) {
    let Some(ctx) = (unsafe { &mut *addr_of_mut!(CTX) }).as_mut() else {
        return;
    };
    if ctx.conn == INVALID_CONNHANDLE {
        return;
    }
    // UART3 RX → BLE notify (poll; blocking_read_some returns what is available)
    if let Ok(n) = ctx.uart.blocking_read_some(&mut ctx.rx) {
        if n > 0 {
            let cap = (ctx.mtu.saturating_sub(3)).max(1) as usize;
            let _ = ble_evt_tests::notify_if(
                ctx.conn,
                services::uart::cccd_tx(),
                services::uart::tx_handle(),
                &ctx.rx[..n.min(cap)],
            );
        }
    }
}

#[entry]
fn main() -> ! {
    let boot = ble_evt_tests::boot(BootCfg::peripheral());
    let task = boot.task_id;
    let p = boot.p;

    let uart = hal::uart::Uart::new_blocking::<0>(
        p.UART3,
        p.PA4,
        p.PA5,
        hal::uart::Config::new(115200),
    )
    .unwrap();

    set_app_handler(on_event);
    set_write_hook(on_write);
    bond_peripheral(true, GAPBOND_IO_CAP_DISPLAY_ONLY);
    set_peripheral_conn(8, 20, 0, 100);

    add_gatt_services();
    let _ = services::uart::register();
    set_device_name("ch583_ble_uart");

    let mut adv = ble_evt_tests::adv::simple_adv(0xFFF0);
    set_adv_data(adv.as_slice());
    let mut rsp = AdvBuilder::new();
    rsp.name_complete(b"ch583_ble_uart")
        .conn_interval_range(8, 20)
        .tx_power(0);
    set_scan_rsp(rsp.as_slice());
    set_adv_interval(160); // 100 ms

    start_peripheral(task);

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            mtu: 23,
            uart,
            rx: [0; 64],
        });
    }

    ble::println!("advertising: ch583_ble_uart");
    ble_evt_tests::run(on_tick)
}