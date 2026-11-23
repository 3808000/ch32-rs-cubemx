//! HID CCCD/堆分层诊断（M18 遗留项，诊断 bin，不参与宿主判据矩阵）。
//!
//! 结论（详见 M18 契约 D5）：宿主报告的 CCCD 0x0e 是 bluez HID-over-GATT
//! 插件配对失败后对挂起 StartNotify 的本地中止（btmon 无 ATT Write 上空），
//! 不是板端 ATT 拒绝。板端可复现的两条真实错误路径：
//!   1. `GATTServApp_WriteCharCfg`：CCCD 表无本连接条目且无 0xFFFF 空槽 →
//!      0x11（bleAlreadyInRequestedMode）。表的查找上限由
//!      `ConnectNumber & 3`（peripheral 数）决定，本板为 1；
//!   2. `gattNotifyEvent` 的 `tmos_msg_allocate(0x20)` 失败 → 0x13
//!      （bleMemAllocError），TMOS 堆小对象区紧张时在服务发现阶段触发。
//!
//! 本 bin 在板端直接调用 blob 导出的 `GATT_FindHandle` /
//! `gattServApp_FindServiceCBs` / `GATTServApp_WriteAttr` /
//! `tmos_memory_getlen`，打印：
//! - HID 表每个属性的 handle/perms，以及各服务注册返回值；
//! - CCCD handle → GATT_FindHandle 的返回属性/perms/服务起始 handle；
//! - FindServiceCBs 是否命中、回调指针是否与 shim 的 write_attr_cb 一致；
//! - 本地 WriteAttr 自测状态（以 INVALID_CONNHANDLE 避免占用唯一 CCCD 槽）；
//! - boot/role-init/服务注册/StartDevice 各阶段 TMOS 堆余量。
//! 随后正常广播，供宿主 StartNotify 复现并观察 CCCD hook 是否触发。
//! 串口固定 9600（CH-Link 桥接在 115200 突发时丢字节）。

#![no_std]
#![no_main]
#![allow(static_mut_refs)]

use ble_evt_tests::prelude::*;
use ble_evt_tests::{adv::AdvBuilder, BootCfg, Ticker};
use core::ptr::addr_of_mut;
use panic_halt as _;
use qingke_rt::entry;

ble_evt_tests::ble_isr!();

// Blob 内部但导出为全局符号（llvm-nm: T），仅用于诊断。
unsafe extern "C" {
    fn GATT_FindHandle(handle: u16, p_service_handle: *mut u16) -> *mut GattAttribute;
    fn gattServApp_FindServiceCBs(service_handle: u16) -> *const gattServiceCBs_t;
    fn tmos_memory_getlen() -> u16;
    fn tmos_memory_get_max_block_len() -> u16;
    #[link_name = "GATTServApp_WriteAttr"]
    fn blob_write_attr(
        conn: u16,
        handle: u16,
        value: *mut u8,
        len: u16,
        offset: u16,
        method: u8,
    ) -> u8;
}

struct Ctx {
    conn: u16,
    report: Ticker,
}

static mut CTX: Option<Ctx> = None;

unsafe fn on_write(_conn: u16, attr: *mut GattAttribute, len: u16) -> u8 {
    ble::println!(
        "WRITE uuid=0x{:04x} handle=0x{:04x} len={}",
        attr_uuid(attr),
        (*attr).handle,
        len
    );
    0
}

unsafe fn on_cccd(conn: u16, attr: *mut GattAttribute) {
    ble::println!(
        "CCCD-WRITE conn=0x{:04x} handle=0x{:04x}",
        conn,
        (*attr).handle
    );
}

unsafe fn on_gap(event: *mut gapRoleEvent_t) {
    match (*event).gap.opcode {
        GAP_LINK_ESTABLISHED_EVENT => {
            let link = (*event).linkCmpl;
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = link.connectionHandle;
                ctx.report = Ticker::new(2000);
            }
            ble::println!("connected 0x{:04x}", link.connectionHandle);
        }
        GAP_LINK_TERMINATED_EVENT => {
            let term = (*event).linkTerminate;
            ble::println!(
                "disconnected 0x{:04x} reason 0x{:02x}",
                term.connectionHandle,
                term.reason
            );
            if let Some(ctx) = &mut *addr_of_mut!(CTX) {
                ctx.conn = INVALID_CONNHANDLE;
            }
        }
        _ => {}
    }
}

fn on_event(event: u8, msg: *mut u8) {
    if event == ble::TmosEvent::GAP_MSG_EVENT {
        unsafe { on_gap(msg as *mut gapRoleEvent_t) };
    }
}

/// Dump an attribute table and probe the three 0x0e candidate links.
unsafe fn diagnose(label: &str, attrs: &[GattAttribute], cccd_index: Option<usize>) {
    ble::println!("--- {} ---", label);
    for (i, a) in attrs.iter().enumerate() {
        ble::println!(
            "  #{:02} uuid=0x{:04x} handle=0x{:04x} perms=0x{:02x}",
            i,
            attr_uuid(a),
            a.handle,
            a.permissions
        );
    }
    let service_handle = attrs[0].handle;
    let cbs = gattServApp_FindServiceCBs(service_handle);
    ble::println!(
        "service start=0x{:04x} FindServiceCBs={:p}",
        service_handle,
        cbs
    );
    if !cbs.is_null() {
        let cb = &*cbs;
        ble::println!(
            "  read={:#010x} write={:#010x} auth={:#010x}",
            cb.pfnReadAttrCB.map_or(0, |p| p as usize),
            cb.pfnWriteAttrCB.map_or(0, |p| p as usize),
            cb.pfnAuthorizeAttrCB.map_or(0, |p| p as usize),
        );
    }
    let Some(index) = cccd_index else {
        return;
    };
    let cccd_handle = attrs[index].handle;
    let mut found_service = 0u16;
    let found = GATT_FindHandle(cccd_handle, &mut found_service);
    ble::println!(
        "FindHandle(cccd 0x{:04x}) = {:p} perms=0x{:02x} service=0x{:04x}",
        cccd_handle,
        found,
        if found.is_null() {
            0xff
        } else {
            (*found).permissions
        },
        found_service
    );
    let cbs2 = gattServApp_FindServiceCBs(found_service);
    ble::println!("FindServiceCBs(found 0x{:04x}) = {:p}", found_service, cbs2);

    // Local write self-test: exactly the call gattServApp_ProcessWriteReq makes.
    // Use INVALID_CONNHANDLE (0xFFFF), never 0: the blob sizes each CCCD table
    // lookup by the peripheral connection count (1 here), so a write with a
    // real-looking handle such as 0 occupies the only free entry and a later
    // genuine connection's CCCD write fails in GATTServApp_WriteCharCfg with
    // 0x11 (bleAlreadyInRequestedMode).
    let mut value = [0x01u8, 0x00];
    let status = blob_write_attr(
        INVALID_CONNHANDLE,
        cccd_handle,
        value.as_mut_ptr(),
        2,
        0,
        0x12,
    );
    ble::println!("blob WriteAttr(cccd) status = 0x{:02x}", status);
}

fn on_tick(now: u32) {
    let Some(ctx) = (unsafe { &mut *addr_of_mut!(CTX) }).as_mut() else {
        return;
    };
    if ctx.conn == INVALID_CONNHANDLE {
        return;
    }
    if ctx.report.due(now) {
        let mut press = [0u8; 8];
        press[2] = 0x04;
        services::hid_keyboard::notify_conn(ctx.conn, &press);
    }
}

#[entry]
fn main() -> ! {
    // 9600 波特：CH-Link 串口桥在 115200 突发时丢字节。
    let mut boot_cfg = BootCfg::peripheral();
    boot_cfg.uart_baud = 9600;
    let boot = ble_evt_tests::boot(boot_cfg);
    let task = boot.task_id;
    unsafe {
        ble::println!(
            "heap after boot: free={} max={}",
            tmos_memory_getlen(),
            tmos_memory_get_max_block_len()
        );
    }

    set_app_handler(on_event);
    set_gap_handler(on_gap);
    set_write_hook(on_write);
    set_cccd_hook(on_cccd);
    bond_peripheral(false, GAPBOND_IO_CAP_NO_INPUT_NO_OUTPUT);
    set_peripheral_conn(8, 8, 0, 500);

    peripheral_role_init();
    unsafe {
        ble::println!(
            "heap after role init: free={} max={}",
            tmos_memory_getlen(),
            tmos_memory_get_max_block_len()
        );
    }

    let mut adv = AdvBuilder::new();
    adv.flags(GAP_ADTYPE_FLAGS_LIMITED | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED);
    adv.appearance(0x03C1);
    adv.name_complete(b"HID Keyboard");
    set_adv_data(adv.as_slice());

    let mut rsp = AdvBuilder::new();
    rsp.uuids16_more(&[0x1812, 0x180F]);
    rsp;
    set_scan_rsp(rsp.as_slice());
    adv_enable(true);

    add_gatt_services();
    let s_hid = services::hid_keyboard::register();
    let s_bat = services::battery::register();
    let s_scan = services::scan_params::register();
    let s_dev = services::devinfo::register();
    ble::println!(
        "register: hid={:?} battery={:?} scan={:?} devinfo={:?}",
        s_hid,
        s_bat,
        s_scan,
        s_dev
    );
    set_device_name("HID Keyboard");
    set_appearance(0x03C1);
    unsafe {
        ble::println!(
            "heap after services: free={} max={}",
            tmos_memory_getlen(),
            tmos_memory_get_max_block_len()
        );
    }

    unsafe {
        diagnose(
            "HID keyboard",
            core::slice::from_raw_parts(
                core::ptr::addr_of!(services::hid_keyboard::ATTRS) as *const GattAttribute,
                24,
            ),
            Some(11),
        );
        diagnose(
            "battery",
            core::slice::from_raw_parts(
                core::ptr::addr_of!(services::battery::ATTRS) as *const GattAttribute,
                4,
            ),
            Some(3),
        );
        diagnose(
            "scan params",
            core::slice::from_raw_parts(
                core::ptr::addr_of!(services::scan_params::ATTRS) as *const GattAttribute,
                6,
            ),
            Some(5),
        );
    }

    unsafe {
        let _ = GAPRole_PeripheralStartDevice(task, bond_cbs(), role_cbs());
    }
    unsafe {
        ble::println!(
            "heap after StartDevice: free={} max={}",
            tmos_memory_getlen(),
            tmos_memory_get_max_block_len()
        );
    }

    unsafe {
        *addr_of_mut!(CTX) = Some(Ctx {
            conn: INVALID_CONNHANDLE,
            report: Ticker::new(2000),
        });
    }

    ble::println!("advertising: HID Keyboard (dbg)");
    ble_evt_tests::run(on_tick)
}
