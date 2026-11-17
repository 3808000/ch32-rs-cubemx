// src/generated/ble.rs 模板（M12/M13）：BLE 协议栈脚手架（busy-poll 运行时）。
// 真相源 reference/ch58x-hal @611954e：src/ble/{mod,gap,gatt,gattservapp,ffi}.rs 与
// examples/ble-{blinky,peripheral,broadcaster,scanner}.rs 逐字对照（见契约 §1）。
//
// M13 实机修复（docs/HAL_API_NOTES.md §14.2bis）：BLE 档禁用 embassy executor/Timer——
// CH58x 的 SysTick 在 WFI 空闲期间停计，上游 embassy 时间驱动会整体饿死；改为主循环 busy-poll：
// `loop { TMOS_SystemProcess(); 事件 try-poll; hal::delay_us(300); }`（主循环忙等，不依赖 Timer/executor；
// 但 RF 完成中断必需：BLEL/BLEB 经 #[qingke_rt::interrupt] 接库 ISR，见下方接线段）。
// 事件用 embassy-sync 0.6.2 的 `Subscriber::try_next_message_pure()`（实测 API 名，见
// registry/embassy-sync-0.6.2/src/pubsub/subscriber.rs:58）。
//
// 生成物硬约束：单订阅者 / 无 core::sync::atomic（共享状态用 static mut + critical_section）/
// TMOS 泵 300µs / GATT_bm_alloc。
export const BLE_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// BLE 协议栈脚手架（ch58x-hal 0.0.2，契约 docs/CH58X_BLE_CONTRACT.md；M13 busy-poll 运行时）：
// - config(): 协议栈配置（MAC 三来源）
// - run(): 初始化顺序 + 角色启动 + busy-poll TMOS 主循环，永不返回
// - busy-poll：不依赖 embassy 执行器/Timer（CH58x SysTick 在 WFI 空闲期间停计，上游时间驱动会饿死，
//   证据 docs/HAL_API_NOTES.md §14.2bis）；主入口另需 csrs mstatus,8 显式开全局中断（M13）
// - 事件 try-poll：embassy-sync 0.6.2 的 Subscriber::try_next_message_pure()（已按 subscriber.rs:58 逐字核对）
// - 单订阅者：TmosEvent 只在主循环 try-poll 一次即 drop（Clone/double-consumer 会 double free）
// - 不使用原子类型（imc target 无原子能力）：共享状态用 static mut + critical_section

use core::mem::size_of_val;
<% if (role === 'peripheral') { -%>
use core::ptr;
<% } -%>

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

/// notify 周期（近似值，非精确定时）：主循环每圈 = TMOS_SystemProcess + delay_us(300)，
/// 1_000_000 / 300 ≈ 3333 圈 ≈ 1s（hal::delay_us 是校准忙等，实际周期随 SYSCLK/HAL 校准浮动）
const NOTIFY_PERIOD_ITERS: u32 = 1_000_000 / 300;

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

/// TMOS busy-poll 主循环（peripheral）：协议栈靠 TMOS_SystemProcess 推进，必须每 ~300µs 调一次
/// （5 个上游 BLE 示例一致，不可省）。hal::delay_us 是纯忙等，不依赖中断/Timer；#[highcode] 放高速 RAM。
#[highcode]
fn tmos_poll(mut subscriber: ble::EventSubscriber) -> ! {
    let mut ticks: u32 = 0;
    loop {
        unsafe {
            TMOS_SystemProcess();
        }

        // 事件 try-poll（GAP/GATT 事件由协议栈在 TMOS_SystemProcess 内投递到 pubsub）：
        // 单订阅者取到即独占，本轮结束 drop → tmos_msg_deallocate（禁止 clone / 转发）。
        while let Some(event) = subscriber.try_next_message_pure() {
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

        // 约 1s 一次：连接 + CCCD 订阅（read_char_cfg）后发送 1 字节状态
        ticks = ticks.wrapping_add(1);
        if ticks >= NOTIFY_PERIOD_ITERS {
            ticks = 0;
            let (conn, value) = with_state(|s| (s.conn, s.notify_value));
            if let Some(handle) = conn {
                let cfg = unsafe { GATTServApp::read_char_cfg(handle, CLIENT_CHARCFG.as_ptr()) };
                if cfg & GATT_CLIENT_CFG_NOTIFY != 0 {
                    unsafe { send_notification(handle, value) };
                }
            }
        }

        hal::delay_us(300);
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

/// TMOS busy-poll 主循环（broadcaster）：hal::delay_us 为纯忙等，不依赖中断/Timer
#[highcode]
fn tmos_poll() -> ! {
    loop {
        unsafe {
            TMOS_SystemProcess();
        }
        hal::delay_us(300);
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

/// TMOS busy-poll 主循环（observer）：hal::delay_us 为纯忙等，不依赖中断/Timer
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
        hal::delay_us(300);
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

/// BLE 启动（初始化顺序契约）：ble::init → 角色 init → 角色参数 + GAP/GATT 服务 →
/// （peripheral）服务注册 → *StartDevice → busy-poll TMOS 主循环。永不返回。
/// M13：不再 spawn embassy 任务，也不用 embassy Timer（见文件头 busy-poll 说明）。
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

    // 1) 协议栈初始化（32K 低频域走 LSI 缺省：不调用 enable_lse；库在 SelRTCClock=0 时内部回退）
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
