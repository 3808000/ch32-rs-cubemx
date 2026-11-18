// src/generated/ble.rs 模板（M12/M13）：BLE 协议栈脚手架（busy-poll 运行时）。
// 真相源 reference/ch58x-hal @611954e：src/ble/{mod,gap,gatt,gattservapp,ffi}.rs 与
// examples/ble-{blinky,peripheral,broadcaster,scanner}.rs 逐字对照（见契约 §1）。
//
// M13 实机修复（docs/HAL_API_NOTES.md §14.2bis）：BLE 档禁用 embassy executor/Timer——
// CH58x 的 SysTick 在 WFI 空闲期间停计，上游 embassy 时间驱动会整体饿死；改为主循环 busy-poll。
// M14 实机修复（§14.2quater）：busy-poll 必须**连续轮询、无 delay**——官方 C Peripheral 的
// Main_Circulation 是 `while(1){ TMOS_SystemProcess(); }`（EVT/EXAM/BLE/Peripheral/APP/peripheral_main.c:40）。
// M13 曾按上游 Rust 示例加 hal::delay_us(300)（该示例走 embassy Timer，在本硅片上从未跑通）。
// 连接建立失败的实机根因是 32K 域错配（M13 移除 enable_lse 后硬件供 LSI、ble::init 硬编码
// SelRTCClock=0 按 LSE 定时）：广播正常但 CONNECT_IND 后链路建立失败。M14 修复 =
// stack_init 自建 bleConfig_t（SelRTCClock 随 ble.clock32k，缺省 lse=0 与 clock.rs enable_lse
// 一致，实机连接建立已验证）+ 连续轮询。notify 周期用 SysTick CNT（≈HCLK，单次 load）；
// 不用 TMOS_GetSystemClock（每圈含 __udivdi3，实测占循环 5/6 时间）。
// RF 完成中断：BLEL/BLEB 经 #[qingke_rt::interrupt] 接库 ISR，见下方接线段。
// 事件用 embassy-sync 0.6.2 的 `Subscriber::try_next_message_pure()`（实测 API 名，见
// registry/embassy-sync-0.6.2/src/pubsub/subscriber.rs:58）。
//
// 生成物硬约束：单订阅者 / 无 core::sync::atomic（共享状态用 static mut + critical_section）/
// TMOS 泵连续轮询（无 delay）/ GATT_bm_alloc。
export const BLE_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// BLE 协议栈脚手架（ch58x-hal 0.0.2，契约 docs/CH58X_BLE_CONTRACT.md；M13 busy-poll 运行时）：
// - mac_addr_lsb(): MAC 三来源（协议栈序 LSB first）
// - stack_init(): 自建 bleConfig_t 初始化（M14：SelRTCClock 按 ble.clock32k，替代 ble::init 硬编码）
// - run(): 初始化顺序 + 角色启动 + busy-poll TMOS 主循环，永不返回
// - busy-poll：不依赖 embassy 执行器/Timer（CH58x SysTick 在 WFI 空闲期间停计，上游时间驱动会饿死，
//   证据 docs/HAL_API_NOTES.md §14.2bis）；主入口另需 csrs mstatus,8 显式开全局中断（M13）
// - 连续轮询无 delay（M14）：对齐官方 C Main_Circulation；delay 会饿死连接事件（§14.2quater）
// - 事件 try-poll：embassy-sync 0.6.2 的 Subscriber::try_next_message_pure()（已按 subscriber.rs:58 逐字核对）
// - 单订阅者：TmosEvent 只在主循环 try-poll 一次即 drop（Clone/double-consumer 会 double free）
// - 不使用原子类型（imc target 无原子能力）：共享状态用 static mut + critical_section

use core::mem::size_of_val;
<% if (role === 'peripheral') { -%>
use core::ptr;
<% } -%>

use qingke_rt::highcode;

// PubSubBehavior trait 必须在作用域内才能调 publish_immediate（与 HAL src/ble/mod.rs:6 一致）
use embassy_sync::pubsub::PubSubBehavior;

use ch58x_hal as hal;
use hal::ble::ffi::*;
use hal::ble::gap::*;
use hal::ble::gattservapp::*;
<% if (role === 'peripheral') { -%>
use hal::ble::gatt::*;
use hal::ble::{self, gatt_uuid, TmosEvent};
<% } else { -%>
use hal::ble;
<% } -%>
use hal::println;

// ---------- RF 中断接线（M13 实机修复，必需） ----------
// ch58x-hal 只声明 BLEL/BLEB 中断号、不提供 ISR；qingke-rt 向量表缺省 DefaultHandler。
// 射频 TX/RX 完成由 BLE 库 ISR 处理（官方 CH58xBLE_LIB.h 声明 *IRQLibHandler；C 工程经
// 启动文件/包装接入向量表）。不接则 ll_tx_wait_finish 死等、广播不上空口（实机证实）。
extern "C" {
    fn LLE_IRQLibHandler();
    fn BB_IRQLibHandler();
}

#[qingke_rt::interrupt]
fn BLEL() {
    unsafe { LLE_IRQLibHandler() }
}

#[qingke_rt::interrupt]
fn BLEB() {
    unsafe { BB_IRQLibHandler() }
}

// ---------- 广播/扫描参数（单位 0.625ms；配置值来自 ble.advIntervalMs / ble.scanMs） ----------
<% if (role !== 'observer') { -%>

/// 广播间隔 <%- advIntervalMs %>ms → <%- advTicks %> ticks（四舍五入）<%- advClampNote %>
const ADV_INTERVAL_TICKS: u16 = <%- advTicks %>;
<% } -%>
<% if (role === 'observer') { -%>
/// 扫描窗口 <%- scanMs %>ms → <%- scanTicks %> ticks（0.625ms 单位）<%- scanClampNote %>
const SCAN_WINDOW_TICKS: u16 = <%- scanTicks %>;
/// 主动扫描（1=发 SCAN_REQ 取扫描响应，0=被动扫描）
const OBSERVER_ACTIVE_SCAN: u8 = <%- activeScan %>;
const OBSERVER_DISCOVERY_MODE: u8 = DEVDISC_MODE_ALL;
<% } -%>
<% if (role === 'peripheral') { -%>
/// 连接间隔缺省（1.25ms 单位，对齐上游 ble-peripheral：6=7.5ms / 100=125ms）
const MIN_CONN_INTERVAL: u16 = <%- connIntervalMin %>;
const MAX_CONN_INTERVAL: u16 = <%- connIntervalMax %>;

// ---------- GATT UUID16（参数化：服务 / notify 特征 / write 特征） ----------

const SERVICE_UUID: u16 = <%- serviceUuid %>;
const NOTIFY_UUID: u16 = <%- notifyUuid %>;
const WRITE_UUID: u16 = <%- writeUuid %>;

const fn lo_u16(x: u16) -> u8 {
    (x & 0xff) as u8
}

const fn hi_u16(x: u16) -> u8 {
    (x >> 8) as u8
}
<% } -%>

// ---------- 设备名（三处同步：GGS 特征 + 广播短名 TLV + 扫描响应完整名 TLV） ----------

/// 设备名 "<%- deviceNameComment %>"（UTF-8 <%- nameLen %> 字节；TLV 长度字节 = 1 + 字节数）
static DEVICE_NAME: &[u8] = &[
<%- nameBytesLines %>
];
<% if (role !== 'observer') { -%>

/// 广播包（≤31 字节；flags + WCH 厂商 0x07D7 + <%- role === 'peripheral' ? '服务 UUID + ' : '' %>短名<%- role === 'broadcaster' ? ' + Tx power' : '' %>）
static ADVERT_DATA: &[u8] = &[
<%- advertLines %>
];

/// 扫描响应（≤31 字节；完整设备名<%- role === 'peripheral' ? ' + Tx power' : '' %>）
static SCAN_RSP_DATA: &[u8] = &[
<%- scanRspLines %>
];
<% } -%>
<% if (role === 'peripheral') { -%>

// ---------- GATT：6 属性表（service + notify read + CCCD + write 特征） ----------

/// CCCD 表：[gattCharCfg_t; 4]（4 = GATT_MAX_NUM_CONN 个连接）
static mut CLIENT_CHARCFG: [gattCharCfg_t; 4] = unsafe { core::mem::zeroed() };

/// 句柄由协议栈在 register_service 后填写（注册前读 handle 无意义）
static mut PERIPHERAL_ATTR_TABLE: [GattAttribute; 6] = [
    // 0: primary service
    GattAttribute {
        type_: GattAttrType::PRIMARY_SERVICE,
        permissions: GATT_PERMIT_READ,
        handle: 0,
        value: &GattAttrType {
            len: ATT_BT_UUID_SIZE,
            uuid: &SERVICE_UUID as *const _ as _,
        } as *const _ as _,
    },
    // 1: notify 特征声明（NOTIFY | READ）
    GattAttribute {
        type_: GattAttrType::CHARACTERISTIC,
        permissions: GATT_PERMIT_READ,
        handle: 0,
        value: &(GATT_PROP_NOTIFY | GATT_PROP_READ) as *const _ as _,
    },
    // 2: notify 特征值（读回调返回当前状态，handle 供通知循环使用）
    GattAttribute {
        type_: GattAttrType::new_u16(&NOTIFY_UUID),
        permissions: GATT_PERMIT_READ,
        handle: 0,
        value: ptr::null(),
    },
    // 3: CCCD（客户端特征配置；写回调必须交给 GATTServApp::process_ccc_write_req）
    GattAttribute {
        type_: GattAttrType::CLIENT_CHAR_CFG,
        permissions: GATT_PERMIT_READ | GATT_PERMIT_WRITE,
        handle: 0,
        value: unsafe { CLIENT_CHARCFG.as_ptr() as _ },
    },
    // 4: write 特征声明
    GattAttribute {
        type_: GattAttrType::CHARACTERISTIC,
        permissions: GATT_PERMIT_READ,
        handle: 0,
        value: &GATT_PROP_WRITE as *const _ as _,
    },
    // 5: write 特征值（1 字节命令）
    GattAttribute {
        type_: GattAttrType::new_u16(&WRITE_UUID),
        permissions: GATT_PERMIT_WRITE,
        handle: 0,
        value: ptr::null(),
    },
];

// ---------- 共享状态（回调与主循环同处 TMOS 执行上下文；critical_section 只作访问纪律） ----------

/// 连接句柄 + 当前通知值（写回调直接更新；notify 主循环读取）
struct BleState {
    conn: Option<u16>,
    notify_value: u8,
}

static mut STATE: BleState = BleState {
    conn: None,
    notify_value: 0,
};

/// 访问共享状态（critical-section 实现由 qingke 的 critical-section-impl 提供，HAL 已启用）
fn with_state<R>(f: impl FnOnce(&mut BleState) -> R) -> R {
    critical_section::with(|_| unsafe { f(&mut STATE) })
}

// notify 周期 ≈1s：SysTick 自由运行计数（stack_init 已配置，实测硅片 SysTick=HCLK，M13 §14.2ter），
// 周期取 hal::sysctl::clocks().hclk（随 PLL 预设自适应）。不用 TMOS_GetSystemClock——
// 它每圈调用含 __udivdi3（clockGetTickValve 内），实测占主循环 5/6 时间（M14 §14.2quater）。

/// 读回调：offset>0 → ATT_ERR_ATTR_NOT_LONG；未知 UUID → ATT_ERR_ATTR_NOT_FOUND
unsafe extern "C" fn on_read_attr(
    _conn_handle: u16,
    attr: *mut GattAttribute,
    value: *mut u8,
    plen: *mut u16,
    offset: u16,
    _max_len: u16,
    _method: u8,
) -> u8 {
    if offset > 0 {
        return ATT_ERR_ATTR_NOT_LONG;
    }
    let uuid = *((*attr).type_.uuid as *const u16);
    match uuid {
        NOTIFY_UUID => {
            let val = with_state(|s| s.notify_value);
            *plen = 1;
            ptr::copy(&val as *const _ as _, value, 1);
            0
        }
        _ => ATT_ERR_ATTR_NOT_FOUND,
    }
}

/// 写回调：write 特征收 1 字节命令直接落到共享状态（回调在 TMOS 上下文，不能 await）；
/// CCCD 写必须走协议栈处理
unsafe extern "C" fn on_write_attr(
    conn_handle: u16,
    attr: *mut GattAttribute,
    value: *mut u8,
    len: u16,
    offset: u16,
    _method: u8,
) -> u8 {
    let uuid = *((*attr).type_.uuid as *const u16);
    if uuid == WRITE_UUID {
        if len == 0 {
            return ATT_ERR_INVALID_VALUE_SIZE;
        }
        let byte = *value;
        with_state(|s| s.notify_value = byte);
        0
    } else if uuid == gatt_uuid::GATT_CLIENT_CHAR_CFG_UUID {
        let status = GATTServApp::process_ccc_write_req(conn_handle, attr, value, len, offset, GATT_CLIENT_CFG_NOTIFY);
        if status.is_ok() {
            0
        } else {
            ATT_ERR_UNLIKELY
        }
    } else {
        ATT_ERR_ATTR_NOT_FOUND
    }
}

/// 服务注册（必须在 GGS_AddService / GATTServApp::add_service 之后、StartDevice 之前）
unsafe fn peripheral_service_init() {
    static SERVICE_CB: gattServiceCBs_t = gattServiceCBs_t {
        pfnReadAttrCB: Some(on_read_attr),
        pfnWriteAttrCB: Some(on_write_attr),
        pfnAuthorizeAttrCB: None,
    };
    GATTServApp::init_char_cfg(INVALID_CONNHANDLE, CLIENT_CHARCFG.as_mut_ptr());
    GATTServApp::register_service(&mut PERIPHERAL_ATTR_TABLE[..], GATT_MAX_ENCRYPT_KEY_SIZE, &SERVICE_CB).unwrap();
}

/// 角色状态回调（连接/广播状态；断连恢复：CCCD 重置 + 清连接句柄 + 重新开广播）
unsafe extern "C" fn on_gap_state_change(new_state: gapRole_States_t, event: *mut gapRoleEvent_t) {
    match new_state {
        GAPROLE_STARTED => println!("BLE: initialized"),
        GAPROLE_ADVERTISING => println!("BLE: advertising"),
        GAPROLE_CONNECTED => {
            let ev = &*event;
            if ev.gap.opcode == GAP_LINK_ESTABLISHED_EVENT {
                with_state(|s| s.conn = Some(ev.linkCmpl.connectionHandle));
            }
            println!("BLE: connected");
        }
        GAPROLE_WAITING => {
            let ev = &*event;
            if ev.gap.opcode == GAP_LINK_TERMINATED_EVENT {
                GATTServApp::init_char_cfg(ev.linkTerminate.connectionHandle, CLIENT_CHARCFG.as_mut_ptr());
                with_state(|s| s.conn = None);
                let _ = GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED, 1, &true as *const _ as _);
                println!("BLE: disconnected, advertising restarted");
            }
        }
        _ => {}
    }
}

/// 通知发送：pValue 必须 GATT_bm_alloc（失败/发送失败时 free）
unsafe fn send_notification(conn_handle: u16, value: u8) {
    let buf = GATT_bm_alloc(conn_handle, ATT_HANDLE_VALUE_NOTI, 1, ptr::null_mut(), 0) as *mut u8;
    if buf.is_null() {
        return; // 分配失败：下个周期重试
    }
    *buf = value;
    let noti = attHandleValueNoti_t {
        handle: PERIPHERAL_ATTR_TABLE[2].handle,
        len: 1,
        pValue: buf,
    };
    if GATT_Notification(conn_handle, &noti, 0).is_err() {
        GATT_bm_free(buf as *mut gattMsg_t, ATT_HANDLE_VALUE_NOTI);
    }
}

/// TMOS busy-poll 主循环（peripheral）：**连续轮询、无 delay**（M14 实机修复）——
/// 官方 C Main_Circulation 即 while(1){TMOS_SystemProcess();}（EVT Peripheral/peripheral_main.c:40）；
/// 300µs 轮询间隙会饿死连接事件的链路层处理（广播正常但连接建立失败，§14.2quater）。
/// notify 计时用 SysTick CNT（单次 load，≈1s 周期随 HCLK 自适应）。#[highcode] 放高速 RAM。
#[highcode]
fn tmos_poll(mut subscriber: ble::EventSubscriber) -> ! {
    let notify_period: u32 = hal::sysctl::clocks().hclk.to_Hz();
    let mut last_notify: u32 = 0;
    loop {
        unsafe {
            TMOS_SystemProcess();
        }

        // 事件 try-poll（GAP/GATT 事件由协议栈在 TMOS_SystemProcess 内投递到 pubsub）：
        // 单订阅者取到即独占，本轮结束 drop → tmos_msg_deallocate（禁止 clone / 转发）。
        // 连接期间事件频繁，静默消费——println 走阻塞 UART 会饿死 TMOS 泵（M14）。
        while let Some(event) = subscriber.try_next_message_pure() {
            let _ = event.message_id();
        }

        // 约 1s 一次：连接 + CCCD 订阅（read_char_cfg）后发送 1 字节状态
        let now = unsafe { (&*hal::pac::SYSTICK::PTR).cnt().read().bits() as u32 };
        if now.wrapping_sub(last_notify) >= notify_period {
            last_notify = now;
            let (conn, value) = with_state(|s| (s.conn, s.notify_value));
            if let Some(handle) = conn {
                let cfg = unsafe { GATTServApp::read_char_cfg(handle, CLIENT_CHARCFG.as_ptr()) };
                if cfg & GATT_CLIENT_CFG_NOTIFY != 0 {
                    unsafe { send_notification(handle, value) };
                }
            }
        }
    }
}
<% } -%>
<% if (role === 'broadcaster') { -%>

/// 广播角色回调（GAP_ADTYPE_ADV_NONCONN_IND 不可连接广播；状态仅打印）
unsafe extern "C" fn broadcaster_on_state_change(new_state: gapRole_States_t) {
    match new_state {
        GAPROLE_STARTED => println!("BLE: initialized"),
        GAPROLE_ADVERTISING => println!("BLE: advertising"),
        GAPROLE_WAITING => println!("BLE: waiting"),
        GAPROLE_ERROR => println!("BLE: error"),
        _ => {}
    }
}

/// TMOS busy-poll 主循环（broadcaster）：连续轮询、无 delay（M14，对齐官方 C Main_Circulation）
#[highcode]
fn tmos_poll() -> ! {
    loop {
        unsafe {
            TMOS_SystemProcess();
        }
    }
}
<% } -%>
<% if (role === 'observer') { -%>

/// 发现完成标记：eventCB 在 GAP 事件分发内部执行，不能就地重入 CancelSync/StartDiscovery
/// （上游 scanner 示例也是"回调置位 → 任务上下文重启"），这里改为主循环延迟重启。
static mut RESTART_DISCOVERY: bool = false;

/// 观测者事件回调（TMOS 上下文）：打印设备地址/RSSI；发现窗口结束后置位，由主循环重启扫描
unsafe extern "C" fn observer_event_callback(event: &gapRoleEvent_t) {
    match event.gap.opcode {
        GAP_DEVICE_INIT_DONE_EVENT => {
            println!("BLE: scanning");
            let _ = GAPRole_ObserverStartDiscovery(OBSERVER_DISCOVERY_MODE, OBSERVER_ACTIVE_SCAN, 0);
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            println!("BLE: discovery done, restarting");
            RESTART_DISCOVERY = true;
        }
        GAP_DEVICE_INFO_EVENT => {
            let info = event.deviceInfo;
            println!("BLE: device {}, rssi={}", ble::MacAddress::from_raw(info.addr), info.rssi);
        }
        _ => {}
    }
}

/// TMOS busy-poll 主循环（observer）：连续轮询、无 delay（M14，对齐官方 C Main_Circulation）
#[highcode]
fn tmos_poll() -> ! {
    loop {
        unsafe {
            TMOS_SystemProcess();
            // 发现窗口结束（回调置位）→ 主循环上下文重启，避免在 GAP 回调内重入协议栈
            if RESTART_DISCOVERY {
                RESTART_DISCOVERY = false;
                let _ = GAPRole_CancelSync();
                let _ = GAPRole_ObserverStartDiscovery(OBSERVER_DISCOVERY_MODE, OBSERVER_ACTIVE_SCAN, 0);
            }
        }
    }
}
<% } -%>

/// GAP/GATT 基础初始化（所有角色）：设备名 GGS + 配对缺省参数 + GAP/GATT 服务
unsafe fn common_init() {
    // 设备名：GGS 特征（与广播/扫描响应 TLV 三处同步）
    let _ = GGS_SetParameter(GGS_DEVICE_NAME_ATT, DEVICE_NAME.len() as u8, DEVICE_NAME.as_ptr() as _);

    // 配对缺省参数（D12：WAIT_FOR_REQ + bonding，非 MITM，DISPLAY_ONLY；无 SNV → 绑定不落 flash）
    let passkey: u32 = 0;
    let pair_mode = GAPBOND_PAIRING_MODE_WAIT_FOR_REQ;
    let mitm = false;
    let io_cap = GAPBOND_IO_CAP_DISPLAY_ONLY;
    let bonding = true;
    let _ = GAPBondMgr_SetParameter(GAPBOND_PERI_DEFAULT_PASSCODE, size_of_val(&passkey) as _, &passkey as *const _ as _);
    let _ = GAPBondMgr_SetParameter(GAPBOND_PERI_PAIRING_MODE, 1, &pair_mode as *const _ as _);
    let _ = GAPBondMgr_SetParameter(GAPBOND_PERI_MITM_PROTECTION, 1, &mitm as *const _ as _);
    let _ = GAPBondMgr_SetParameter(GAPBOND_PERI_IO_CAPABILITIES, 1, &io_cap as *const _ as _);
    let _ = GAPBondMgr_SetParameter(GAPBOND_PERI_BONDING_ENABLED, 1, &bonding as *const _ as _);

    // GAP + GATT 基础服务（必须在角色 StartDevice 之前）
    GGS_AddService(GATT_ALL_SERVICES).unwrap();
    GATTServApp::add_service(GATT_ALL_SERVICES).unwrap();
}
<% if (role === 'peripheral') { -%>

/// 角色参数：广播数据/扫描响应/间隔、连接间隔缺省
unsafe fn role_profile_init() {
    let _ = GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED, 1, &true as *const _ as _);
    let _ = GAPRole_SetParameter(GAPROLE_SCAN_RSP_DATA, SCAN_RSP_DATA.len() as _, SCAN_RSP_DATA.as_ptr() as _);
    let _ = GAPRole_SetParameter(GAPROLE_ADVERT_DATA, ADVERT_DATA.len() as _, ADVERT_DATA.as_ptr() as _);
    let _ = GAPRole_SetParameter(GAPROLE_MIN_CONN_INTERVAL, 2, &MIN_CONN_INTERVAL as *const _ as _);
    let _ = GAPRole_SetParameter(GAPROLE_MAX_CONN_INTERVAL, 2, &MAX_CONN_INTERVAL as *const _ as _);
    let _ = GAP_SetParamValue(TGAP_DISC_ADV_INT_MIN, ADV_INTERVAL_TICKS);
    let _ = GAP_SetParamValue(TGAP_DISC_ADV_INT_MAX, ADV_INTERVAL_TICKS);
}
<% } else if (role === 'broadcaster') { -%>

/// 角色参数：不可连接广播（ADV_NONCONN_IND=0x03）+ 广播数据 + 间隔
unsafe fn role_profile_init() {
    let _ = GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED, 1, &true as *const _ as _);
    let _ = GAPRole_SetParameter(GAPROLE_ADV_EVENT_TYPE, 1, &GAP_ADTYPE_ADV_NONCONN_IND as *const _ as _);
    let _ = GAPRole_SetParameter(GAPROLE_SCAN_RSP_DATA, SCAN_RSP_DATA.len() as _, SCAN_RSP_DATA.as_ptr() as _);
    let _ = GAPRole_SetParameter(GAPROLE_ADVERT_DATA, ADVERT_DATA.len() as _, ADVERT_DATA.as_ptr() as _);
    let _ = GAP_SetParamValue(TGAP_DISC_ADV_INT_MIN, ADV_INTERVAL_TICKS);
    let _ = GAP_SetParamValue(TGAP_DISC_ADV_INT_MAX, ADV_INTERVAL_TICKS);
}
<% } else { -%>

/// 角色参数：扫描窗口 + PHY（1M）
unsafe fn role_profile_init() {
    let _ = GAP_SetParamValue(TGAP_DISC_SCAN, SCAN_WINDOW_TICKS);
    let _ = GAP_SetParamValue(TGAP_DISC_SCAN_PHY, GAP_PHY_BIT_LE_1M);
}
<% } -%>

/// MAC 地址（协议栈序 LSB first；三来源与 M12 D1 一致）
fn mac_addr_lsb() -> [u8; 6] {
<% if (macSource === 'factory') { -%>
    // 出厂 MAC：从 ISP ROM 读取（libISP583.a 由 HAL 无条件链接；返回值即 LSB first）
    hal::isp::get_mac_address()
<% } else if (macSource === 'custom' && macBytesLiteral) { -%>
    // 自定义 MAC（配置为人读序 MSB first，此处反转为协议栈 LSB first）
    <%- macBytesLsbLiteral %>
<% } else { -%>
    // 缺省 MAC：11:22:33:44:55:66（MSB）→ LSB first
    [0x66, 0x55, 0x44, 0x33, 0x22, 0x11]
<% } -%>
}

// ---------- 协议栈初始化（M14 实机修复：32K 域与库配置一致，绕开 ble::init 硬编码） ----------
// ch58x-hal ble::init 硬编码 SelRTCClock=0（外部 LSE 32768Hz）且 rcCB=None
// （src/ble/mod.rs:190/196），无法适配无 LSE 晶振的板子。M13 移除 enable_lse 后
// 硬件供 LSI、库仍按 LSE 定时 → 广播正常但连接建立失败（实机复现）；LSE 全链
// （enable_lse + SelRTCClock=0）实机连接建立已验证。此处经公开 ffi 自建 bleConfig_t，
// SelRTCClock 由 ble.clock32k 决定（lse 缺省=0 / lsi 回退=1），与 clock.rs 的
// enable_lse 生成保持一致；不走 ble::init。官方 C 对照：CH58X_BLEInit 用
// CLK_OSC32K=1（LSI）+ rcCB=Lib_Calibration_LSI（EVT/EXAM/BLE/HAL/MCU.c:111-119）；
// LSI 校准回调未移植（Calibration_LSI 在 StdPeriphDriver 非库导出），lsi 档连接稳定性未保证。
// 证据与上游缺陷记录：docs/HAL_API_NOTES.md §14.2quater。

/// 协议栈堆（与 HAL BLE_HEAP 同尺寸 6KB；库内部管理）
static mut STACK_HEAP: [core::mem::MaybeUninit<u8>; 6 * 1024] =
    [core::mem::MaybeUninit::uninit(); 6 * 1024];

/// TMOS 事件通道（与 HAL CHANNEL 同参数：容量 4 / 2 订阅者 / 2 发布者；单订阅者约束不变）
static STACK_CHANNEL: embassy_sync::pubsub::PubSubChannel<
    embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex,
    hal::ble::TmosEvent,
    4,
    2,
    2,
> = embassy_sync::pubsub::PubSubChannel::new();

/// RF 寄存器周期重初始化事件（与 HAL hal_tmos_task 相同）
const HAL_REG_INIT_EVENT: u16 = 0x2000;
/// 120s（625µs/tick，与 HAL HAL_TMOS_TASK_INTERVAL 相同）
const REG_INIT_INTERVAL_TICKS: u32 = 120_000 * 1000 / 625;

/// TMOS 任务回调：SYS_EVENT_MSG → 投递 pubsub（无订阅者时 publish 立即 drop →
/// TmosEvent::drop 调 tmos_msg_deallocate，embassy-sync 0.6.2 try_publish 无订阅者直接 Ok）；
/// HAL_REG_INIT_EVENT → BLE_RegInit + 120s 重定时
unsafe extern "C" fn stack_tmos_task(task_id: u8, events: u16) -> u16 {
    if events & SYS_EVENT_MSG != 0 {
        let msg = tmos_msg_receive(task_id);
        if !msg.is_null() {
            STACK_CHANNEL.publish_immediate(hal::ble::TmosEvent(msg as _));
        }
        events ^ SYS_EVENT_MSG
    } else if events & HAL_REG_INIT_EVENT != 0 {
        BLE_RegInit();
        tmos_start_task(task_id, HAL_REG_INIT_EVENT, REG_INIT_INTERVAL_TICKS);
        events ^ HAL_REG_INIT_EVENT
    } else {
        0
    }
}

/// 随机种子：SysTick 自由运行计数（同 C SYS_GetSysTickCnt / HAL srand；PAC bits() 为 u64，截断）
unsafe extern "C" fn stack_srand() -> u32 {
    (&*hal::pac::SYSTICK::PTR).cnt().read().bits() as u32
}

/// 协议栈初始化（替代 ble::init）：返回 (TMOS 任务 id, 事件订阅者)
fn stack_init(mac_lsb: [u8; 6]) -> (u8, ble::EventSubscriber) {
    unsafe {
        // SysTick 自由运行（随机种子源；同 C SysTick_Config + PFIC_DisableIRQ：只计数不开中断）
        let st = &*hal::pac::SYSTICK::PTR;
        st.cmp().write(|w| w.bits(0xFFFF_FFFF));
        st.ctlr().modify(|_, w| {
            w.init()
                .set_bit()
                .mode()
                .upcount()
                .stre()
                .clear_bit()
                .stclk()
                .hclk_div8()
                .ste()
                .set_bit()
        });

        let mut cfg: bleConfig_t = core::mem::zeroed();
        cfg.MEMAddr = STACK_HEAP.as_ptr() as u32;
        cfg.MEMLen = STACK_HEAP.len() as _;
        cfg.BufMaxLen = 27; // ATT_MTU=23（与 HAL 一致）
        cfg.BufNumber = 5;
        cfg.TxNumEvent = 1;
        cfg.TxPower = LL_TX_POWEER_6_DBM;
        cfg.SelRTCClock = <%- selRtcClock %>; // M14：0=LSE 32768Hz（clock32k=lse 缺省，与 clock.rs enable_lse 一致）/ 1=LSI 32000Hz（lsi 回退）
        cfg.ConnectNumber = (1 & 3) | (3 << 2); // peripheral 1 / central 3（与 HAL 一致）
        cfg.srandCB = Some(stack_srand);
        cfg.tsCB = Some(hal::ble::temperature_raw); // RF RC 温度补偿采样（HAL 公开函数）
        cfg.rcCB = None; // LSI 校准回调：官方 C 为 Lib_Calibration_LSI（StdPeriphDriver 实现，
        // 非库导出）；先以 None 验证连通性，校准移植为后续增强项
        cfg.MacAddr = mac_lsb;
        BLE_LibInit(&cfg).unwrap();
        TMOS_TimerInit(core::ptr::null()).unwrap();
        let task_id = TMOS_ProcessEventRegister(Some(stack_tmos_task));
        tmos_start_task(task_id, HAL_REG_INIT_EVENT, REG_INIT_INTERVAL_TICKS);
        (task_id, STACK_CHANNEL.subscriber().unwrap())
    }
}

/// BLE 启动（初始化顺序契约）：stack_init → 角色 init → 角色参数 + GAP/GATT 服务 →
/// （peripheral）服务注册 → *StartDevice → busy-poll TMOS 主循环。永不返回。
/// M13：不再 spawn embassy 任务，也不用 embassy Timer（见文件头 busy-poll 说明）。
/// M14：stack_init 替代 ble::init（SelRTCClock 按 ble.clock32k，见协议栈初始化段说明）。
pub fn run() -> ! {
<% if (logSerial) { -%>
    // 日志串口（D5）：UART1/PA9 未被用户占用 → 设为默认串口，hal::println 生效
    let uart = hal::uart::UartTx::new(
        unsafe { hal::peripherals::UART1::steal() },
        unsafe { hal::peripherals::PA9::steal() },
        Default::default(),
    )
    .unwrap();
    unsafe {
        hal::set_default_serial(uart);
    }
<% } -%>
    println!("BLE lib: {}", ble::lib_version());

    // 1) 协议栈初始化（M14：stack_init 自建 bleConfig_t，SelRTCClock 与 clock.rs 32K 域一致；
    //    不调用 ble::init——其硬编码 SelRTCClock=0 无法适配无晶振板，见上方说明）
<% if (role === 'peripheral') { -%>
    let (task_id, subscriber) = stack_init(mac_addr_lsb());
<% } else { -%>
    // 非 peripheral 角色不消费 TmosEvent：立即释放订阅者（消息由协议栈自行回收）
    let (_task_id, _) = stack_init(mac_addr_lsb());
<% } -%>

    // 2) 角色初始化（紧跟 stack_init）
    let _ = GAPRole::<%- role %>_init().unwrap();

    // 3) GAP/GATT 服务 + 角色参数（顺序：GGS/GATTServApp → register_service → StartDevice）
    unsafe {
        role_profile_init();
        common_init();
<% if (role === 'peripheral') { -%>
        peripheral_service_init();
<% } -%>
    }

    // 4) 角色启动（*StartDevice 的回调结构必须是 'static）
<% if (role === 'peripheral') { -%>
    unsafe {
        static BOND_CB: gapBondCBs_t = gapBondCBs_t {
            passcodeCB: None,
            pairStateCB: None,
            oobCB: None,
        };
        static APP_CB: gapRolesCBs_t = gapRolesCBs_t {
            pfnStateChange: Some(on_gap_state_change),
            pfnRssiRead: None,
            pfnParamUpdate: None,
        };
        GAPRole_PeripheralStartDevice(task_id, &BOND_CB, &APP_CB).unwrap();
    }

    // 5) busy-poll TMOS 主循环（永不返回）
    tmos_poll(subscriber)
<% } else if (role === 'broadcaster') { -%>
    unsafe {
        static CALLBACKS: gapRolesBroadcasterCBs_t = gapRolesBroadcasterCBs_t {
            pfnStateChange: Some(broadcaster_on_state_change),
            pfnScanRecv: None,
        };
        GAPRole_BroadcasterStartDevice(&CALLBACKS).unwrap();
    }

    // 5) busy-poll TMOS 主循环（永不返回）
    tmos_poll()
<% } else { -%>
    unsafe {
        static CALLBACK: gapRoleObserverCB_t = gapRoleObserverCB_t {
            eventCB: Some(observer_event_callback),
        };
        GAPRole_ObserverStartDevice(&CALLBACK).unwrap();
    }

    // 5) busy-poll TMOS 主循环（永不返回）
    tmos_poll()
<% } -%>
}
`
