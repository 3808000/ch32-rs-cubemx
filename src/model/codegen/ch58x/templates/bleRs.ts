// src/generated/ble.rs 模板（M12）：BLE 协议栈脚手架。
// 真相源 reference/ch58x-hal @611954e：src/ble/{mod,gap,gatt,gattservapp,ffi}.rs 与
// examples/ble-{blinky,peripheral,broadcaster,scanner}.rs 逐字对照（见契约 §1）。
// 生成物硬约束：单订阅者 / 无 core::sync::atomic / TMOS 泵 300µs #[highcode] / GATT_bm_alloc。
export const BLE_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// BLE 协议栈脚手架（ch58x-hal 0.0.2，契约 docs/CH58X_BLE_CONTRACT.md）：
// - config(): 协议栈配置（MAC 三来源）
// - run(spawner): 初始化顺序 + 角色启动 + TMOS 泵，永不返回
// - 单订阅者：TmosEvent 只在 gap 任务消费一次即 drop（Clone/double-consumer 会 double free）
// - 不使用原子类型（imc target 无原子能力）：跨任务状态一律走 embassy_sync Channel

use core::mem::size_of_val;
<% if (role === 'peripheral') { -%>
use core::{ptr, slice};
<% } -%>

use embassy_executor::Spawner;
<% if (role !== 'broadcaster') { -%>
use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::channel::Channel;
<% } -%>
use embassy_time::{Duration, Ticker};
use qingke_rt::highcode;

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
    // 2: notify 特征值（读回调返回当前状态，handle 供通知任务使用）
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

/// 当前状态值：读回调与写回调都在 TMOS_SystemProcess 同一执行上下文更新（无跨任务共享）
static mut NOTIFY_VALUE: u8 = 0;

/// GATT 回调 → 通知任务的事件（回调在 TMOS 上下文执行，不能 await，只能 try_send）
enum AppEvent {
    Subscribed(u16),
    Unsubscribed(u16),
    Disconnected,
    Write(u8),
}

static APP_CHANNEL: Channel<CriticalSectionRawMutex, AppEvent, 8> = Channel::new();

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
            let val = NOTIFY_VALUE;
            *plen = 1;
            ptr::copy(&val as *const _ as _, value, 1);
            0
        }
        _ => ATT_ERR_ATTR_NOT_FOUND,
    }
}

/// 写回调：write 特征收 1 字节命令经 Channel 发给通知任务；CCCD 写必须走协议栈处理
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
        NOTIFY_VALUE = *value;
        let _ = APP_CHANNEL.try_send(AppEvent::Write(*value));
        0
    } else if uuid == gatt_uuid::GATT_CLIENT_CHAR_CFG_UUID {
        let status = GATTServApp::process_ccc_write_req(conn_handle, attr, value, len, offset, GATT_CLIENT_CFG_NOTIFY);
        if status.is_ok() {
            let cfg = slice::from_raw_parts(value, len as usize);
            if cfg.len() == 2 && cfg[0] == 0x01 && cfg[1] == 0x00 {
                let _ = APP_CHANNEL.try_send(AppEvent::Subscribed(conn_handle));
            } else {
                let _ = APP_CHANNEL.try_send(AppEvent::Unsubscribed(conn_handle));
            }
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

/// 角色状态回调（连接/广播状态；断连恢复：CCCD 重置 + 重新开广播）
unsafe extern "C" fn on_gap_state_change(new_state: gapRole_States_t, event: *mut gapRoleEvent_t) {
    match new_state {
        GAPROLE_STARTED => println!("BLE: initialized"),
        GAPROLE_ADVERTISING => println!("BLE: advertising"),
        GAPROLE_CONNECTED => println!("BLE: connected"),
        GAPROLE_WAITING => {
            let ev = &*event;
            if ev.gap.opcode == GAP_LINK_TERMINATED_EVENT {
                GATTServApp::init_char_cfg(ev.linkTerminate.connectionHandle, CLIENT_CHARCFG.as_mut_ptr());
                let _ = APP_CHANNEL.try_send(AppEvent::Disconnected);
                let _ = GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED, 1, &true as *const _ as _);
                println!("BLE: disconnected, advertising restarted");
            }
        }
        _ => {}
    }
}

/// 通知任务：每 1s 在订阅后发 1 字节状态；pValue 必须 GATT_bm_alloc（失败/发送失败时 free）
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

#[embassy_executor::task]
async fn notify_task() -> ! {
    let mut ticker = Ticker::every(Duration::from_millis(1000));
    let mut conn: Option<u16> = None;
    let mut value: u8 = 0;
    loop {
        ticker.next().await;
        // 非阻塞排空事件（GATT 回调在 TMOS 上下文用 try_send，不能等待）
        loop {
            match APP_CHANNEL.try_receive() {
                Ok(AppEvent::Subscribed(handle)) => conn = Some(handle),
                Ok(AppEvent::Unsubscribed(_)) | Ok(AppEvent::Disconnected) => conn = None,
                Ok(AppEvent::Write(byte)) => value = byte,
                Err(_) => break,
            }
        }
        if let Some(handle) = conn {
            if GATTServApp::read_char_cfg(handle, unsafe { CLIENT_CHARCFG.as_ptr() }) & GATT_CLIENT_CFG_NOTIFY != 0 {
                unsafe { send_notification(handle, value) };
            }
        }
    }
}

#[embassy_executor::task]
async fn peripheral_gap_task(task_id: u8, mut subscriber: ble::EventSubscriber) -> ! {
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
        // StartDevice 必须在服务注册之后（契约 §1）；回调必须是 'static
        GAPRole_PeripheralStartDevice(task_id, &BOND_CB, &APP_CB).unwrap();
    }
    loop {
        // 单订阅者：取到即独占，本轮结束 drop → tmos_msg_deallocate（禁止 clone / 转发）
        let event = subscriber.next_message_pure().await;
        match event.message_id() {
            TmosEvent::GAP_MSG_EVENT => {
                let opcode = unsafe { (*(event.0 as *const gapRoleEvent_t)).gap.opcode };
                if opcode != GAP_LINK_ESTABLISHED_EVENT && opcode != GAP_LINK_TERMINATED_EVENT {
                    println!("BLE: GAP event 0x{:02x}", opcode);
                }
            }
            TmosEvent::GATT_MSG_EVENT => println!("BLE: GATT message"),
            _ => {}
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

#[embassy_executor::task]
async fn broadcaster_task() {
    static CALLBACKS: gapRolesBroadcasterCBs_t = gapRolesBroadcasterCBs_t {
        pfnStateChange: Some(broadcaster_on_state_change),
        pfnScanRecv: None,
    };
    unsafe {
        GAPRole_BroadcasterStartDevice(&CALLBACKS).unwrap();
    }
}
<% } -%>
<% if (role === 'observer') { -%>

/// 发现完成事件通道（eventCB 在 TMOS 上下文，只能 try_send）
static EVENTS: Channel<CriticalSectionRawMutex, bool, 4> = Channel::new();

/// 观测者事件回调：打印设备地址/RSSI；发现窗口结束 → 通知任务重启扫描
unsafe extern "C" fn observer_event_callback(event: &gapRoleEvent_t) {
    match event.gap.opcode {
        GAP_DEVICE_INIT_DONE_EVENT => {
            println!("BLE: scanning");
            let _ = GAPRole_ObserverStartDiscovery(OBSERVER_DISCOVERY_MODE, OBSERVER_ACTIVE_SCAN, 0);
        }
        GAP_DEVICE_DISCOVERY_EVENT => {
            let _ = EVENTS.try_send(true);
        }
        GAP_DEVICE_INFO_EVENT => {
            let info = event.deviceInfo;
            println!("BLE: device {}, rssi={}", ble::MacAddress::from_raw(info.addr), info.rssi);
        }
        _ => {}
    }
}

/// 周期重扫：每个扫描窗口（scanMs）结束后重新发起发现流程
#[embassy_executor::task]
async fn observer_task() -> ! {
    static CALLBACK: gapRoleObserverCB_t = gapRoleObserverCB_t {
        eventCB: Some(observer_event_callback),
    };
    unsafe {
        GAPRole_ObserverStartDevice(&CALLBACK).unwrap();
    }
    loop {
        let _ = EVENTS.receive().await;
        println!("BLE: discovery done, restarting");
        unsafe {
            let _ = GAPRole_CancelSync();
            GAPRole_ObserverStartDiscovery(OBSERVER_DISCOVERY_MODE, OBSERVER_ACTIVE_SCAN, 0).unwrap();
        }
    }
}
<% } -%>

/// TMOS 主循环：协议栈靠 TMOS_SystemProcess 推进，必须每 300µs 调一次
/// （5 个上游 BLE 示例一致，不可省；#[highcode] 放到高速 RAM 执行）
#[highcode]
#[embassy_executor::task]
async fn tmos_mainloop() {
    let mut ticker = Ticker::every(Duration::from_micros(300));
    loop {
        ticker.next().await;
        unsafe {
            TMOS_SystemProcess();
        }
    }
}

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

/// 协议栈配置（MAC 三来源；设备名/UUID 不在此处）
pub fn config() -> ble::Config {
<% if (macSource === 'factory') { -%>
    let mut config = ble::Config::default();
    // 出厂 MAC：从 ISP ROM 读取（libISP583.a 由 HAL 无条件链接）
    config.use_factory_mac_address();
    config
<% } else if (macSource === 'custom' && macBytesLiteral) { -%>
    let mut config = ble::Config::default();
    // 自定义 MAC（人读序 MSB first；MacAddress::from_msb 内部反转为协议栈 LSB first）
    config.mac_addr = ble::MacAddress::from_msb(<%- macBytesLiteral %>);
    config
<% } else { -%>
    // 缺省 MAC：ble::Config::default() = 11:22:33:44:55:66
    ble::Config::default()
<% } -%>
}

/// BLE 启动（初始化顺序契约）：ble::init → 角色 init → GAP/GATT 服务 →
/// （peripheral）服务注册 → spawn TMOS 泵 + 角色任务 → 事件循环 await。永不返回。
pub async fn run(spawner: &Spawner) -> ! {
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

    // 1) 协议栈初始化（LSE 由 clock.rs 的 enable_lse() 提供）
<% if (role === 'peripheral') { -%>
    let (task_id, subscriber) = ble::init(config()).unwrap();
<% } else { -%>
    // 非 peripheral 角色不消费 TmosEvent：立即释放订阅者（消息由协议栈自行回收）
    let (_task_id, _) = ble::init(config()).unwrap();
<% } -%>

    // 2) 角色初始化（紧跟 ble::init）
    let _ = GAPRole::<%- role %>_init().unwrap();

    // 3) GAP/GATT 服务 + 角色参数（顺序：GGS/GATTServApp → register_service → StartDevice）
    unsafe {
        role_profile_init();
        common_init();
<% if (role === 'peripheral') { -%>
        peripheral_service_init();
<% } -%>
    }

    // 4) TMOS 泵 + 角色任务（peripheral 的 StartDevice 在任务首行，晚于服务注册）
    spawner.spawn(tmos_mainloop()).unwrap();
<% if (role === 'peripheral') { -%>
    spawner.spawn(notify_task()).unwrap();
    spawner.spawn(peripheral_gap_task(task_id, subscriber)).unwrap();
<% } else if (role === 'broadcaster') { -%>
    spawner.spawn(broadcaster_task()).unwrap();
<% } else { -%>
    spawner.spawn(observer_task()).unwrap();
<% } -%>

    // 5) 事件循环（各任务已 spawn，主任务只保持存活）
    loop {
        core::future::pending::<()>().await;
    }
}
`
