// M17-S3：ch5xx-hal + ch5xx-ble shim 的 BLE 代码生成测试（CH582M）。
// 契约：docs/CH5XX_BACKEND_CONTRACT.md D1/D3；S1 实测：docs/m17-shim-notes.md
// （shim 编译/link 通过，BLEB/BLEL=20/21，systick_hz 为 notify 周期唯一真相）。
// 覆盖：shim 委托（ble::init/Config/无本地 stack_init）、Cargo BLE 档、32K 时钟（lse/lsi）、
//       日志串口、RF 中断、MAC 三来源、角色三档、设备名/负载上限、cube.json 往返、诚实边界。
import { describe, expect, it } from 'vitest'
import type {
  BleConfig,
  CodegenResult,
  CodegenSelection,
  DeviceData,
  PinAssignment,
  PinMode,
  ProjectConfig,
} from '@/model/types'
import { DEFAULT_BLE_CONFIG } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { mergeClockConfig } from '@/model/clock'
import { generateProject } from '@/model/codegen'
// 广播/扫描计划沿用 legacy 纯计算（单一真相，ch5xx/ble.ts 只转出 buildBlePlan）
import { buildBlePlan, bleAdvPayloadBytes, bleScanRspPayloadBytes } from '@/model/codegen/ch58x/ble'

const data: DeviceData = getDeviceData('CH582M')

function pllClock(div = 8): ProjectConfig['clock'] {
  return mergeClockConfig(data.clock, {
    source: 'PLL',
    pllSource: 'HSE',
    pll: { div },
    ahb: 1,
    apb1: 1,
    apb2: 1,
  })
}

function baseConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH582M',
    halBackend: 'ch5xx-hal',
    projectName: 'ch582-ble',
    pins: [],
    naming: { prefix: '' },
    clock: pllClock(8),
    features: { embassy: false, debugPrint: false },
    hal: { rev: 'x' },
    ...over,
  }
}

/** BLE 工程：store 互锁要求 embassy 开关为 true；ch5xx 档生成时仍走 busy-poll（不启 hal embassy）。 */
function bleConfig(over: Partial<BleConfig> = {}, cfgOver: Partial<ProjectConfig> = {}): ProjectConfig {
  return baseConfig({
    features: { embassy: true, debugPrint: false, ble: true },
    ble: { ...DEFAULT_BLE_CONFIG, ...over },
    ...cfgOver,
  })
}

function pin(pinName: string, mode: PinMode, over: Partial<PinAssignment> = {}): PinAssignment {
  return { pin: pinName, mode, params: {}, ...over }
}

function gen(config: ProjectConfig, selection?: Partial<CodegenSelection>): CodegenResult {
  return generateProject(config, data, selection)
}

function contentOf(r: CodegenResult, path: string): string {
  return r.files.find((x) => x.path === path)?.content ?? '<missing>'
}

const bleOf = (r: CodegenResult): string => contentOf(r, 'src/generated/ble.rs')

describe('接线与 Cargo BLE 档（D1/D2）', () => {
  it('features.ble → 生成 src/generated/ble.rs（generated 组）且 mod.rs 声明 pub mod ble;', () => {
    const r = gen(bleConfig())
    expect(r.errors).toEqual([])
    const f = r.files.find((x) => x.path === 'src/generated/ble.rs')
    expect(f).toBeDefined()
    expect(f!.group).toBe('generated')
    expect(contentOf(r, 'src/generated/mod.rs')).toContain('pub mod ble;')
  })

  it('BLE 模块不受 selection 开关影响（外设全关也生成）', () => {
    const r = gen(bleConfig(), { usart: false, spi: false, i2c: false, adc: false, pins: false, clock: false })
    expect(r.errors).toEqual([])
    expect(r.files.some((f) => f.path === 'src/generated/ble.rs')).toBe(true)
  })

  it('BLE 档不启 hal embassy/time-driver：features 退回 ["ch582","rt","memory-x"]', () => {
    const c = contentOf(gen(bleConfig()), 'Cargo.toml')
    expect(c).toContain(
      'ch5xx-hal = { path = "vendor/ch5xx-hal", default-features = false, features = ["ch582", "rt", "memory-x"] }',
    )
    expect(c).not.toContain('time-driver-tmr0')
    expect(c).not.toContain('embassy-executor =')
    expect(c).not.toContain('[patch.crates-io]')
  })

  it('BLE 档依赖：ch5xx-ble path + embassy-sync 0.8 + critical-section + portable-atomic', () => {
    const c = contentOf(gen(bleConfig()), 'Cargo.toml')
    expect(c).toContain('ch5xx-ble = { path = "vendor/ch5xx-ble" }')
    expect(c).toContain('embassy-sync = "0.8"')
    expect(c).toContain('critical-section = "1.2"')
    expect(c).toContain('portable-atomic = { version = "1.11", features = ["critical-section"] }')
    // shim 以 git rev 依赖 HAL：vendor 模式必须 patch 到内嵌源码，避免两份 UartTx 类型
    expect(c).toContain('[patch."https://github.com/ch32-rs/ch5xx-hal"]')
    expect(c).toContain('ch5xx-hal = { path = "vendor/ch5xx-hal" }')
  })

  it('ble + blocking（features.embassy=false）→ BLE_REQUIRES_EMBASSY error', () => {
    const cfg = bleConfig({}, { features: { embassy: false, debugPrint: false, ble: true } })
    const r = gen(cfg)
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'BLE_REQUIRES_EMBASSY')
    expect(e?.level).toBe('error')
    expect(e!.message).toContain('embassy')
  })
})

describe('shim 委托（D3：ble::init 取代本地 stack_init）', () => {
  it('import ch5xx_ble as ble；无本地 stack_init / STACK_HEAP / BLE_LibInit / TMOS_TimerInit', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('use ch5xx_ble as ble;')
    expect(c).not.toContain('fn stack_init')
    expect(c).not.toContain('stack_init(')
    expect(c).not.toContain('STACK_HEAP')
    // 注释里会提到 BLE_LibInit 的时序，实际调用/配置必须不存在
    expect(c).not.toContain('BLE_LibInit(')
    expect(c).not.toContain('TMOS_TimerInit(')
    expect(c).not.toContain('stack_srand')
    expect(c).not.toContain('hal::ble::')
  })

  it('ble::init(ble::Config { mac_lsb, sel_rtc_clock, rc_cb: None }) 逐字委托', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('let (task_id, subscriber) = ble::init(ble::Config {')
    expect(c).toContain('        mac_lsb: mac_addr_lsb(),')
    expect(c).toContain('        sel_rtc_clock: 0,')
    expect(c).toContain('        rc_cb: None,')
    expect(c).toContain('    })\n    .unwrap();')
    // 顺序：ble::init → GAPRole init
    const runBody = c.slice(c.indexOf('pub fn run('))
    expect(runBody.indexOf('ble::init(ble::Config')).toBeGreaterThanOrEqual(0)
    expect(runBody.indexOf('GAPRole::peripheral_init()')).toBeGreaterThan(
      runBody.indexOf('ble::init(ble::Config'),
    )
  })

  it('non-peripheral 角色同样委托 ble::init，但订阅者立即释放', () => {
    for (const role of ['broadcaster', 'observer'] as const) {
      const c = bleOf(gen(bleConfig({ role })))
      expect(c).toContain('let (_task_id, _) = ble::init(ble::Config {')
      expect(c).toContain('        mac_lsb: mac_addr_lsb(),')
      expect(c).toContain('        rc_cb: None,')
    }
  })

  it('notify 周期唯一真相 = ble::systick_hz()，不再假设 hclk/8', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('let notify_period: u32 = ble::systick_hz();')
    expect(c).toContain('let now = hal::pac::SYSTICK.cnt().read() as u32;')
    expect(c).toContain('now.wrapping_sub(last_notify) >= notify_period')
    expect(c).not.toContain('hclk.to_Hz() / 8')
    expect(c).not.toContain('NOTIFY_PERIOD_ITERS')
  })

  it('单订阅者 + 无原子：try_next_message_pure 只出现一次，共享状态 static mut + critical_section', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c.match(/subscriber\.try_next_message_pure\(\)/g)?.length).toBe(1)
    expect(c).toContain('static mut STATE: BleState')
    expect(c).toContain('critical_section::with(|_| unsafe { f(&mut STATE) })')
    expect(c.toLowerCase()).not.toContain('atomic')
  })
})

describe('32K 时钟源（main.rs 在 hal::init 之后、ble::init 之前）', () => {
  it('缺省 lse：main 生成 ch5xx_ble::enable_lse()（位于 hal::init 之后）', () => {
    const c = contentOf(gen(bleConfig()), 'src/main.rs')
    const iInit = c.indexOf('hal::init(')
    const iLse = c.indexOf('ch5xx_ble::enable_lse();')
    expect(iInit).toBeGreaterThanOrEqual(0)
    expect(iLse).toBeGreaterThan(iInit)
    expect(c).not.toContain('ch5xx_ble::set_clock32k_lsi();')
    // 32K 设置不在 clock.rs（shim 的寄存器序列必须晚于 hal::init）
    expect(contentOf(gen(bleConfig()), 'src/generated/clock.rs')).not.toContain('enable_lse')
  })

  it('clock32k=lsi：main 生成 set_clock32k_lsi()，SelRTCClock=1', () => {
    const r = gen(bleConfig({ clock32k: 'lsi' }))
    const c = contentOf(r, 'src/main.rs')
    const iInit = c.indexOf('hal::init(')
    expect(c.indexOf('ch5xx_ble::set_clock32k_lsi();')).toBeGreaterThan(iInit)
    expect(c).not.toContain('ch5xx_ble::enable_lse();')
    expect(bleOf(r)).toContain('sel_rtc_clock: 1,')
  })

  it('PA10/PA11（LSE 晶振）被占用 → BLE_LSE_PIN_IN_USE error', () => {
    for (const p of ['PA10', 'PA11']) {
      const r = gen(bleConfig({}, { pins: [pin(p, 'OUTPUT', { label: 'XTAL' })] }))
      expect(r.files).toEqual([])
      const e = r.errors.find((x) => x.code === 'BLE_LSE_PIN_IN_USE')
      expect(e?.level).toBe('error')
      expect(e?.pins).toContain(p)
      expect(e!.message).toContain('LSE')
      expect(e!.message).toContain('不可复用')
    }
  })
})

describe('日志串口（D3 shim 日志钩子）', () => {
  it('默认可用：UartTx::new_blocking::<0> + ble::set_default_serial + ble::println!', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('use ble::println;')
    expect(c).toContain('hal::uart::UartTx::new_blocking::<0>(')
    expect(c).toContain('unsafe { hal::peripherals::UART1::steal() },')
    expect(c).toContain('unsafe { hal::peripherals::PA9::steal() },')
    expect(c).toContain('hal::uart::Config::new(115200),')
    expect(c).toContain('ble::set_default_serial(uart);')
    expect(c).toContain('println!("BLE lib: {}", ble::lib_version());')
  })

  it('PA9 被 GPIO 占用 → 不生成 set_default_serial；README 提示日志不可用', () => {
    const r = gen(bleConfig({}, { pins: [pin('PA9', 'OUTPUT', { label: 'LED' })] }))
    expect(r.errors).toEqual([])
    expect(bleOf(r)).not.toContain('set_default_serial')
    expect(contentOf(r, 'README.md')).toContain('BLE 日志串口不可用')
    expect(contentOf(r, 'README.md')).toContain('ble::println! 在无默认串口时静默')
  })
})

describe('RF 中断（BLEB/BLEL）', () => {
  it('三角色均声明中断向量并使能 BLEB/BLEL', () => {
    for (const role of ['peripheral', 'broadcaster', 'observer'] as const) {
      const r = gen(bleConfig({ role }))
      const c = bleOf(r)
      expect(c).toContain('use hal::interrupt::InterruptExt;')
      expect(c).toContain('#[qingke_rt::interrupt]\nfn BLEL() {')
      expect(c).toContain('#[qingke_rt::interrupt]\nfn BLEB() {')
      expect(c).toContain('unsafe { ble::LLE_IRQLibHandler() }')
      expect(c).toContain('unsafe { ble::BB_IRQLibHandler() }')
      expect(c).toContain('hal::interrupt::Interrupt::BLEB.enable();')
      expect(c).toContain('hal::interrupt::Interrupt::BLEL.enable();')
    }
  })
})

describe('MAC 三来源（D3：mac_lsb 直供 shim bleConfig_t）', () => {
  it('default → [0x66, 0x55, 0x44, 0x33, 0x22, 0x11]（11:22:33:44:55:66 LSB first）', () => {
    const c = bleOf(gen(bleConfig({ macSource: 'default' })))
    expect(c).toContain('[0x66, 0x55, 0x44, 0x33, 0x22, 0x11]')
    expect(c).not.toContain('FLASH_EEPROM_CMD')
  })

  it('factory → ROM 命令 FLASH_EEPROM_CMD(GetRomInfo=0x06, 0x7F018)', () => {
    const c = bleOf(gen(bleConfig({ macSource: 'factory' })))
    expect(c).toContain('fn FLASH_EEPROM_CMD(cmd: u8, start_addr: u32, buffer: *mut u8, len: u32) -> u32;')
    expect(c).toContain('const ROM_CMD_GET_ROM_INFO: u8 = 0x06;')
    expect(c).toContain('const ROM_CFG_MAC_ADDR: u32 = 0x7F_018;')
    expect(c).toContain('FLASH_EEPROM_CMD(ROM_CMD_GET_ROM_INFO, ROM_CFG_MAC_ADDR, buf.0.as_mut_ptr(), 0);')
  })

  it('custom → 人读序 MSB 反转为 LSB first 字面量', () => {
    const c = bleOf(gen(bleConfig({ macSource: 'custom', mac: 'AA:BB:CC:DD:EE:FF' })))
    expect(c).toContain('[0xFF, 0xEE, 0xDD, 0xCC, 0xBB, 0xAA]')
  })

  it('custom 非法 MAC → BLE_MAC_INVALID error', () => {
    for (const mac of ['AA:BB:CC', 'GG:00:11:22:33:44', '']) {
      const r = gen(bleConfig({ macSource: 'custom', mac }))
      expect(r.files).toEqual([])
      expect(r.errors.some((x) => x.code === 'BLE_MAC_INVALID' && x.level === 'error')).toBe(true)
    }
  })
})

describe('角色三档（D3）', () => {
  it('peripheral：GAP/GATT 服务 + 6 属性表 + CCCD + notify 循环 + StartDevice', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('let _ = GAPRole::peripheral_init().unwrap();')
    expect(c).toContain('static mut PERIPHERAL_ATTR_TABLE: [GattAttribute; 6]')
    expect(c).toContain('GattAttrType::PRIMARY_SERVICE')
    expect(c).toContain('GattAttrType::CLIENT_CHAR_CFG')
    expect(c).toContain('const SERVICE_UUID: u16 = 0xFFE0;')
    expect(c).toContain('const NOTIFY_UUID: u16 = 0xFFE1;')
    expect(c).toContain('const WRITE_UUID: u16 = 0xFFE2;')
    expect(c).toContain(
      'GATTServApp::process_ccc_write_req(conn_handle, attr, value, len, offset, GATT_CLIENT_CFG_NOTIFY)',
    )
    expect(c).toContain('GATT_bm_alloc(conn_handle, ATT_HANDLE_VALUE_NOTI, 1, ptr::null_mut(), 0)')
    expect(c).toContain('GATT_Notification(conn_handle, &noti, 0).is_err()')
    expect(c).toContain('GAPRole_PeripheralStartDevice(task_id, &BOND_CB, &APP_CB).unwrap();')
    expect(c).toContain('tmos_poll(subscriber)')
    // 服务注册顺序：GGS → GATTServApp → register_service（run 内 StartDevice 之前）
    const runBody = c.slice(c.indexOf('pub fn run('))
    expect(runBody.indexOf('common_init();')).toBeLessThan(runBody.indexOf('peripheral_service_init();'))
    expect(runBody.indexOf('peripheral_service_init();')).toBeLessThan(
      runBody.indexOf('GAPRole_PeripheralStartDevice'),
    )
  })

  it('broadcaster：NONCONN_IND + 无 GATT 表 + 不消费订阅者', () => {
    const c = bleOf(gen(bleConfig({ role: 'broadcaster' })))
    expect(c).toContain('let _ = GAPRole::broadcaster_init().unwrap();')
    expect(c).toContain('GAPRole_SetParameter(GAPROLE_ADV_EVENT_TYPE, 1, &GAP_ADTYPE_ADV_NONCONN_IND as *const _ as _)')
    expect(c).toContain('GAPRole_BroadcasterStartDevice(&CALLBACKS).unwrap();')
    expect(c).toContain('fn tmos_poll() -> !')
    expect(c).not.toContain('PERIPHERAL_ATTR_TABLE')
    expect(c).not.toContain('GATT_bm_alloc')
    expect(c).not.toContain('subscriber.try_next_message_pure')
  })

  it('observer：扫描窗口/PHY + 周期重扫（主循环重入，不在回调内）', () => {
    const c = bleOf(gen(bleConfig({ role: 'observer', scanMs: 3000, activeScan: false })))
    expect(c).toContain('let _ = GAPRole::observer_init().unwrap();')
    expect(c).toContain('const SCAN_WINDOW_TICKS: u16 = 4800;')
    expect(c).toContain('const OBSERVER_ACTIVE_SCAN: u8 = 0;')
    expect(c).toContain('GAP_SetParamValue(TGAP_DISC_SCAN, SCAN_WINDOW_TICKS)')
    expect(c).toContain('GAP_SetParamValue(TGAP_DISC_SCAN_PHY, GAP_PHY_BIT_LE_1M)')
    expect(c).toContain('GAPRole_ObserverStartDevice(&CALLBACK).unwrap();')
    expect(c).toContain('static mut RESTART_DISCOVERY: bool = false;')
    const cb = c.slice(c.indexOf('unsafe extern "C" fn observer_event_callback'), c.indexOf('#[highcode]'))
    expect(cb).toContain('RESTART_DISCOVERY = true;')
    expect(cb).not.toContain('GAPRole_CancelSync()')
    const poll = c.slice(c.indexOf('#[highcode]\nfn tmos_poll'))
    expect(poll).toContain('GAPRole_CancelSync()')
    expect(poll).toContain('GAPRole_ObserverStartDiscovery(OBSERVER_DISCOVERY_MODE, OBSERVER_ACTIVE_SCAN, 0)')
    expect(c).not.toContain('ADVERT_DATA')
    expect(c).not.toContain('PERIPHERAL_ATTR_TABLE')
  })

  it('observer activeScan=true → OBSERVER_ACTIVE_SCAN = 1；打印地址/RSSI', () => {
    const c = bleOf(gen(bleConfig({ role: 'observer', activeScan: true })))
    expect(c).toContain('const OBSERVER_ACTIVE_SCAN: u8 = 1;')
    expect(c).toContain('ble::MacAddress::from_raw(info.addr)')
    expect(c).toContain('info.rssi')
  })
})

describe('设备名与广播负载上限（沿用 legacy 计划）', () => {
  it('peripheral：26 字节完整名 → 扫描响应恰好 31 字节，允许生成', () => {
    const name = 'A'.repeat(26)
    const plan = buildBlePlan(bleConfig({ deviceName: name }))
    expect(bleScanRspPayloadBytes(plan)).toBe(31)
    expect(gen(bleConfig({ deviceName: name })).errors).toEqual([])
  })

  it('peripheral：27 字节 → BLE_NAME_TOO_LONG error（不截断）', () => {
    const r = gen(bleConfig({ deviceName: 'A'.repeat(27) }))
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'BLE_NAME_TOO_LONG')
    expect(e?.level).toBe('error')
    expect(e!.message).toContain('26 字节')
  })

  it('broadcaster：29 字节允许、30 字节报错', () => {
    expect(gen(bleConfig({ role: 'broadcaster', deviceName: 'B'.repeat(29) })).errors).toEqual([])
    const r = gen(bleConfig({ role: 'broadcaster', deviceName: 'B'.repeat(30) }))
    expect(r.errors.some((x) => x.code === 'BLE_NAME_TOO_LONG')).toBe(true)
  })

  it('默认名负载：广播 20 字节 / 扫描响应 11 字节', () => {
    const plan = buildBlePlan(bleConfig())
    expect(bleAdvPayloadBytes(plan)).toBe(20)
    expect(bleScanRspPayloadBytes(plan)).toBe(11)
  })

  it('设备名三处同步：GGS + 广播短名 + 扫描响应完整名', () => {
    const c = bleOf(gen(bleConfig({ deviceName: 'BLE-NODE' })))
    expect(c).toContain('GGS_SetParameter(GGS_DEVICE_NAME_ATT, DEVICE_NAME.len() as u8')
    // BLE-NODE = 8 字节 → TLV 长度字节 = 1 + 8 = 0x09
    expect(c).toContain('0x09, GAP_ADTYPE_LOCAL_NAME_COMPLETE')
    expect(c).toContain('0x09, GAP_ADTYPE_LOCAL_NAME_SHORT')
    expect(c).toContain('0x42, 0x4C, 0x45, 0x2D, 0x4E, 0x4F, 0x44, 0x45')
  })
})

describe('cube.json / README（D1/D3）', () => {
  it('cube.json 往返保留 halBackend=ch5xx-hal、features.ble 与 ble 字段', () => {
    const cfg = bleConfig({ role: 'observer', deviceName: 'OBS-NODE', scanMs: 1500, activeScan: true })
    const cube = JSON.parse(contentOf(gen(cfg), 'cube.json')) as ProjectConfig
    expect(cube.halBackend).toBe('ch5xx-hal')
    expect(cube.features.ble).toBe(true)
    expect(cube.ble).toMatchObject({
      role: 'observer',
      deviceName: 'OBS-NODE',
      scanMs: 1500,
      activeScan: true,
      macSource: 'factory',
    })
    // 回读后仍按 ch5xx 分流（新建/导入一致）
    expect(gen(cube).errors).toEqual([])
    expect(contentOf(gen(cube), 'Cargo.toml')).toContain('ch5xx-hal')
  })

  it('README BLE 节说明 shim（ch5xx-ble）/ busy-poll / systick_hz / 未实测边界', () => {
    const c = contentOf(gen(bleConfig()), 'README.md')
    expect(c).toContain('ch5xx-ble')
    expect(c).toContain('busy-poll')
    expect(c).toContain('systick_hz')
    expect(c).toContain('ch5xx-hal 本身不提供 BLE')
    expect(c).toContain('PA 控制本期未移植')
    expect(c).toContain('BLE busy-poll')
  })

  it('非 BLE 工程不生成 ble.rs，也不含 shim 依赖', () => {
    const r = gen(baseConfig())
    expect(r.files.some((f) => f.path === 'src/generated/ble.rs')).toBe(false)
    expect(contentOf(r, 'src/main.rs')).not.toContain('generated::ble::run')
    expect(contentOf(r, 'Cargo.toml')).not.toContain('ch5xx-ble')
  })
})