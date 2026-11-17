// M12：ch58x-hal BLE 协议栈代码生成测试（CH582M）。
// 契约：docs/CH58X_BLE_CONTRACT.md D1–D12；HAL 签名基准 reference/ch58x-hal @ 611954e
// （src/ble/{mod,gap,gatt,gattservapp,ffi}.rs + examples/ble-{blinky,peripheral,broadcaster,scanner}.rs）。
// 覆盖：接线/错误兜底、LSE、MAC 三来源、单订阅者、无原子、TMOS 泵、GATT 表/CCCD/notify、
//       广播/扫描 TLV 与设备名三处同步、间隔换算、UUID 参数化、Cargo features、README 诚实边界、
//       cube.json 往返、fileGroup。
import { describe, expect, it } from 'vitest'
import type { BleConfig, CodegenResult, CodegenSelection, DeviceData, PinAssignment, PinMode, ProjectConfig } from '@/model/types'
import { DEFAULT_BLE_CONFIG } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { mergeClockConfig } from '@/model/clock'
import { generateProject } from '@/model/codegen'
import {
  advIntervalTicks,
  bleAdvPayloadBytes,
  bleScanRspPayloadBytes,
  buildBlePlan,
  parseMacAddress,
  scanWindowTicks,
  shortNameBytes,
  utf8Bytes,
} from '@/model/codegen/ch58x/ble'
import { bleGenerationErrors, bleLogSerialAvailable, featureWarnings } from '@/model/codegen/ch58x/derive'
import { CH58X_HAL_REV } from '@/model/codegen/halRev'

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
    projectName: 'ch582-ble',
    pins: [],
    naming: { prefix: '' },
    clock: pllClock(8),
    features: { embassy: false, debugPrint: false },
    hal: { rev: CH58X_HAL_REV },
    ...over,
  }
}

/** BLE 工程：embassy + features.ble + ble 配置（默认 peripheral/100ms/FFE0-2）。 */
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

function af(pinName: string, fn: string, remap = 0): PinAssignment {
  return pin(pinName, 'AF', { function: fn, remap })
}

function gen(config: ProjectConfig, selection?: Partial<CodegenSelection>): CodegenResult {
  return generateProject(config, data, selection)
}

function contentOf(r: CodegenResult, path: string): string {
  return r.files.find((x) => x.path === path)?.content ?? '<missing>'
}

const bleOf = (r: CodegenResult): string => contentOf(r, 'src/generated/ble.rs')

describe('BLE 接线（D1/D2/D4）', () => {
  it('features.ble + embassy → 生成 src/generated/ble.rs 且归入 generated 组', () => {
    const r = gen(bleConfig())
    expect(r.errors).toEqual([])
    const f = r.files.find((x) => x.path === 'src/generated/ble.rs')
    expect(f).toBeDefined()
    expect(f!.group).toBe('generated')
  })

  it('BLE 模块不受 selection 开关影响（外设模块关掉也生成，main.rs 依赖它）', () => {
    const r = gen(bleConfig(), { usart: false, spi: false, i2c: false, adc: false, pins: false, clock: false })
    expect(r.errors).toEqual([])
    expect(r.files.some((f) => f.path === 'src/generated/ble.rs')).toBe(true)
  })

  it('ble + blocking（features.embassy=false）→ BLE_REQUIRES_EMBASSY error，阻止导出', () => {
    const cfg = bleConfig({}, { features: { embassy: false, debugPrint: false, ble: true } })
    const r = gen(cfg)
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'BLE_REQUIRES_EMBASSY')
    expect(e?.level).toBe('error')
    expect(e?.message).toContain('embassy')
  })

  it('ble 时时钟模块被强制生成（ble::init 硬编码 SelRTCClock=0，需要 LSE）', () => {
    const r = gen(bleConfig(), { clock: false })
    expect(r.errors).toEqual([])
    expect(r.files.some((f) => f.path === 'src/generated/clock.rs')).toBe(true)
    expect(contentOf(r, 'src/main.rs')).toContain('hal::init(generated::clock::config())')
  })

  it('非 BLE 工程不生成 ble.rs，main 不含 run 调用（M11 行为不变）', () => {
    const r = gen(baseConfig())
    expect(r.files.some((f) => f.path === 'src/generated/ble.rs')).toBe(false)
    expect(contentOf(r, 'src/main.rs')).not.toContain('generated::ble::run')
  })

  it('mod.rs 声明 pub mod ble;', () => {
    const r = gen(bleConfig())
    expect(contentOf(r, 'src/generated/mod.rs')).toContain('pub mod ble;')
  })

  it('main.rs 末尾调用 generated::ble::run(&spawner).await（spawner 参数去下划线）', () => {
    const c = contentOf(gen(bleConfig()), 'src/main.rs')
    expect(c).toContain('async fn main(spawner: embassy_executor::Spawner) -> !')
    expect(c).toContain('generated::ble::run(&spawner).await;')
    const iInit = c.indexOf('hal::init(')
    const iEmbassy = c.indexOf('hal::embassy::init();')
    const iRun = c.indexOf('generated::ble::run(')
    expect(iEmbassy).toBeGreaterThan(iInit)
    expect(iRun).toBeGreaterThan(iEmbassy)
  })
})

describe('LSE（D3）', () => {
  it('预设时钟链追加 .enable_lse()', () => {
    const c = contentOf(gen(bleConfig()), 'src/generated/clock.rs')
    expect(c).toContain('config.clock.use_pll_60mhz().enable_lse();')
  })

  it('显式 PLL 分频追加 config.clock.enable_lse();', () => {
    const c = contentOf(gen(bleConfig({}, { clock: pllClock(7) })), 'src/generated/clock.rs')
    expect(c).toContain('config.clock.mux = hal::sysctl::ClockSrc::PLL(7);')
    expect(c).toContain('config.clock.enable_lse();')
  })

  it('非 BLE 不生成 enable_lse（LSI 缺省）', () => {
    expect(contentOf(gen(baseConfig()), 'src/generated/clock.rs')).not.toContain('enable_lse')
  })

  it('PA10/PA11（LSE 晶振）被占用 → BLE_LSE_PIN_IN_USE error', () => {
    for (const p of ['PA10', 'PA11']) {
      const r = gen(bleConfig({}, { pins: [pin(p, 'OUTPUT', { label: 'XTAL' })] }))
      expect(r.files).toEqual([])
      const e = r.errors.find((x) => x.code === 'BLE_LSE_PIN_IN_USE')
      expect(e?.level).toBe('error')
      expect(e?.pins).toContain(p)
    }
  })
})

describe('MAC 三来源（D1）', () => {
  it('default → ble::Config::default()（11:22:33:44:55:66）', () => {
    const c = bleOf(gen(bleConfig({ macSource: 'default' })))
    expect(c).toContain('// 缺省 MAC：ble::Config::default() = 11:22:33:44:55:66')
    expect(c).not.toContain('use_factory_mac_address')
  })

  it('factory → config.use_factory_mac_address()', () => {
    const c = bleOf(gen(bleConfig({ macSource: 'factory' })))
    expect(c).toContain('config.use_factory_mac_address();')
  })

  it('custom → MacAddress::from_msb([0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF])', () => {
    const c = bleOf(gen(bleConfig({ macSource: 'custom', mac: 'AA:BB:CC:DD:EE:FF' })))
    expect(c).toContain('config.mac_addr = ble::MacAddress::from_msb([0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);')
  })

  it('custom 非法 MAC → BLE_MAC_INVALID error', () => {
    for (const mac of ['AA:BB:CC', 'GG:00:11:22:33:44', '']) {
      const r = gen(bleConfig({ macSource: 'custom', mac }))
      expect(r.files).toEqual([])
      expect(r.errors.some((x) => x.code === 'BLE_MAC_INVALID' && x.level === 'error')).toBe(true)
    }
  })

  it('parseMacAddress 纯函数：合法（: 或 - 分隔）/非法', () => {
    expect(parseMacAddress('00:11:22:aa:BB:cc')).toEqual([0x00, 0x11, 0x22, 0xaa, 0xbb, 0xcc])
    expect(parseMacAddress('00-11-22-33-44-55')).toEqual([0x00, 0x11, 0x22, 0x33, 0x44, 0x55])
    expect(parseMacAddress('00:11:22:33:44')).toBeNull()
    expect(parseMacAddress('GG:00:11:22:33:44')).toBeNull()
    expect(parseMacAddress(undefined)).toBeNull()
  })
})

describe('设备名与 TLV（D4/D7）', () => {
  it('peripheral：26 字节完整名 → 扫描响应恰好 31 字节，允许生成', () => {
    const name = 'A'.repeat(26)
    const plan = buildBlePlan(bleConfig({ deviceName: name }))
    expect(bleScanRspPayloadBytes(plan)).toBe(31)
    expect(gen(bleConfig({ deviceName: name })).errors).toEqual([])
  })

  it('peripheral：27 字节完整名 → BLE_NAME_TOO_LONG error（不截断）', () => {
    const r = gen(bleConfig({ deviceName: 'A'.repeat(27) }))
    expect(r.files).toEqual([])
    const e = r.errors.find((x) => x.code === 'BLE_NAME_TOO_LONG')
    expect(e?.level).toBe('error')
    expect(e?.message).toContain('26 字节')
  })

  it('broadcaster：29 字节允许、30 字节报错（扫描响应只需完整名 TLV）', () => {
    expect(gen(bleConfig({ role: 'broadcaster', deviceName: 'B'.repeat(29) })).errors).toEqual([])
    const r = gen(bleConfig({ role: 'broadcaster', deviceName: 'B'.repeat(30) }))
    expect(r.errors.some((x) => x.code === 'BLE_NAME_TOO_LONG')).toBe(true)
  })

  it('UTF-8 按字节计：7 个汉字（21 字节）允许、9 个汉字（27 字节）→ BLE_NAME_TOO_LONG', () => {
    const ok = '温湿度节点一号'
    expect(utf8Bytes(ok).length).toBe(21)
    expect(gen(bleConfig({ deviceName: ok })).errors).toEqual([])
    const bad = '温湿度节点一号二号'
    expect(utf8Bytes(bad).length).toBe(27)
    expect(gen(bleConfig({ deviceName: bad })).errors.some((x) => x.code === 'BLE_NAME_TOO_LONG')).toBe(true)
  })

  it('名字 >248 字节 → BLE_NAME_TOO_LONG（GAP 上限）', () => {
    const r = gen(bleConfig({ deviceName: 'A'.repeat(249) }))
    expect(r.errors.some((x) => x.code === 'BLE_NAME_TOO_LONG')).toBe(true)
  })

  it('设备名三处同步：GGS + 广播短名 + 扫描响应完整名', () => {
    const c = bleOf(gen(bleConfig({ deviceName: 'BLE-NODE' })))
    // GGS
    expect(c).toContain('GGS_SetParameter(GGS_DEVICE_NAME_ATT, DEVICE_NAME.len() as u8')
    // 扫描响应完整名
    expect(c).toContain('GAP_ADTYPE_LOCAL_NAME_COMPLETE')
    // 广播短名
    expect(c).toContain('GAP_ADTYPE_LOCAL_NAME_SHORT')
    // 三处都是同一份 DEVICE_NAME 字节（BLE-NODE 的 ASCII）
    expect(c).toContain('0x42, 0x4C, 0x45, 0x2D, 0x4E, 0x4F, 0x44, 0x45')
  })

  it('TLV 长度字节自动计算 = 1 + UTF-8 字节数（默认 CH582M → 0x07）', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('0x07, GAP_ADTYPE_LOCAL_NAME_COMPLETE')
    expect(c).toContain('0x07, GAP_ADTYPE_LOCAL_NAME_SHORT')
  })

  it('短名按码点截断：≤8 字节且不切断 UTF-8', () => {
    expect(shortNameBytes('CH582M')).toEqual([0x43, 0x48, 0x35, 0x38, 0x32, 0x4d])
    // 每个汉字 3 字节：最多 2 个汉字（6 字节），不会切出半个码点
    expect(shortNameBytes('温度传感器节点')).toEqual(utf8Bytes('温度'))
  })

  it('广播包包含 flags + WCH 厂商 0x07D7 + 服务 UUID（peripheral）', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('GAP_ADTYPE_FLAGS')
    expect(c).toContain('0xD7, 0x07')
    expect(c).toContain('0x03, GAP_ADTYPE_16BIT_MORE, lo_u16(SERVICE_UUID), hi_u16(SERVICE_UUID)')
  })
})

describe('Cargo（D8）', () => {
  it('BLE 档 HAL features = ["embassy", "ble"]（vendor）', () => {
    const c = contentOf(gen(bleConfig()), 'Cargo.toml')
    expect(c).toContain('ch58x-hal = { path = "vendor/ch58x-hal", default-features = false, features = ["embassy", "ble"] }')
    expect(c).toContain('ble feature 额外链接 vendor/LIBCH58xBLE.a')
  })

  it('BLE 档 HAL features = ["embassy", "ble"]（git）', () => {
    const c = contentOf(gen(bleConfig(), { vendorHal: false }), 'Cargo.toml')
    expect(c).toContain('features = ["embassy", "ble"]')
    expect(c).toContain(`rev = "${CH58X_HAL_REV}"`)
  })

  it('BLE 档追加 embassy-sync = "0.6.2" 直依赖（Channel 跨任务状态）', () => {
    const c = contentOf(gen(bleConfig()), 'Cargo.toml')
    expect(c).toContain('embassy-sync = "0.6.2"')
  })

  it('BLE 档不出现 generic-queue（embassy 档 integrated queue，__pender 由 main 宏提供）', () => {
    const c = contentOf(gen(bleConfig()), 'Cargo.toml')
    expect(c).not.toContain('generic-queue')
    expect(c).toContain('embassy-executor = { version = "0.7.0"')
    expect(c).toContain('embassy-time = "0.4.0"')
  })

  it('非 BLE 档保持 M11：features ["embassy"] 且无 embassy-sync', () => {
    const c = contentOf(gen(baseConfig()), 'Cargo.toml')
    expect(c).toContain('features = ["embassy"]')
    expect(c).not.toContain('embassy-sync')
  })
})

describe('ble.rs 结构与初始化顺序（D4/D6）', () => {
  it('初始化顺序：run 内 ble::init < 角色 init < 角色参数 < 公共初始化 < 服务注册', () => {
    const c = bleOf(gen(bleConfig()))
    // run 函数体（定义顺序不代表调用顺序，只看 run 内）
    const runBody = c.slice(c.indexOf('pub async fn run('))
    const i = (s: string) => runBody.indexOf(s)
    const seq = [
      'ble::init(config())',
      'GAPRole::peripheral_init()',
      'role_profile_init();',
      'common_init();',
      'peripheral_service_init();',
      'spawner.spawn(peripheral_gap_task(task_id, subscriber))',
    ]
    for (const s of seq) expect(i(s)).toBeGreaterThanOrEqual(0)
    for (let k = 1; k < seq.length; k++) expect(i(seq[k])).toBeGreaterThan(i(seq[k - 1]))
    // 服务注册在 register_service 中；StartDevice 在角色任务首行（注册之后才 spawn 该任务）
    const svcDef = c.slice(c.indexOf('unsafe fn peripheral_service_init'), c.indexOf('unsafe extern "C" fn on_gap_state_change'))
    expect(svcDef).toContain('GATTServApp::register_service(&mut PERIPHERAL_ATTR_TABLE[..]')
    const gapDef = c.slice(c.indexOf('async fn peripheral_gap_task'), c.indexOf('/// TMOS 主循环'))
    expect(gapDef).toContain('GAPRole_PeripheralStartDevice(task_id, &BOND_CB, &APP_CB)')
  })

  it('契约 §1 服务注册在 StartDevice 之前（GGS/GATTServApp 先于 register_service）', () => {
    const c = bleOf(gen(bleConfig()))
    const commonDef = c.slice(c.indexOf('unsafe fn common_init'), c.indexOf('/// 角色参数'))
    expect(commonDef.indexOf('GGS_AddService(GATT_ALL_SERVICES)')).toBeGreaterThanOrEqual(0)
    expect(commonDef.indexOf('GATTServApp::add_service(GATT_ALL_SERVICES)')).toBeGreaterThan(
      commonDef.indexOf('GGS_AddService(GATT_ALL_SERVICES)'),
    )
    const svcDef = c.slice(c.indexOf('unsafe fn peripheral_service_init'), c.indexOf('unsafe extern "C" fn on_gap_state_change'))
    expect(svcDef.indexOf('register_service')).toBeGreaterThan(0)
    // 调用顺序：common_init 在 peripheral_service_init 之前
    const runBody = c.slice(c.indexOf('pub async fn run('))
    expect(runBody.indexOf('common_init();')).toBeLessThan(runBody.indexOf('peripheral_service_init();'))
  })

  it('TMOS 泵：独立 task + 300µs + #[highcode] + TMOS_SystemProcess', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('#[highcode]\n#[embassy_executor::task]\nasync fn tmos_mainloop()')
    expect(c).toContain('Ticker::every(Duration::from_micros(300))')
    expect(c).toContain('TMOS_SystemProcess();')
  })

  it('run 先 spawn TMOS 泵，再 spawn 角色任务', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c.indexOf('spawner.spawn(tmos_mainloop())')).toBeGreaterThan(0)
    expect(c.indexOf('spawner.spawn(peripheral_gap_task(task_id, subscriber))')).toBeGreaterThan(
      c.indexOf('spawner.spawn(tmos_mainloop())'),
    )
  })

  it('单订阅者：全文件只有一个 next_message_pure，无 subscriber/TmosEvent clone', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c.match(/next_message_pure/g)?.length).toBe(1)
    expect(c).not.toContain('subscriber.clone')
    expect(c).not.toContain('.clone()')
    expect(c).not.toContain('second subscriber')
  })

  it('无原子：生成物不含 atomic / AtomicBool（imc target）', () => {
    for (const role of ['peripheral', 'broadcaster', 'observer'] as const) {
      const c = bleOf(gen(bleConfig({ role })))
      expect(c.toLowerCase()).not.toContain('atomic')
    }
  })

  it('GATT 6 属性表：PRIMARY_SERVICE / CHARACTERISTIC / CLIENT_CHAR_CFG', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('static mut PERIPHERAL_ATTR_TABLE: [GattAttribute; 6]')
    expect(c).toContain('GattAttrType::PRIMARY_SERVICE')
    expect(c).toContain('GattAttrType::CHARACTERISTIC')
    expect(c).toContain('GattAttrType::CLIENT_CHAR_CFG')
    expect(c).toContain('GATT_PERMIT_READ | GATT_PERMIT_WRITE')
  })

  it('UUID16 参数化：默认 FFE0/FFE1/FFE2 + GattAttrType::new_u16', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('const SERVICE_UUID: u16 = 0xFFE0;')
    expect(c).toContain('const NOTIFY_UUID: u16 = 0xFFE1;')
    expect(c).toContain('const WRITE_UUID: u16 = 0xFFE2;')
    expect(c).toContain('GattAttrType::new_u16(&NOTIFY_UUID)')
    expect(c).toContain('GattAttrType::new_u16(&WRITE_UUID)')
    expect(c).toContain('uuid: &SERVICE_UUID as *const _ as _')
  })

  it('自定义 UUID16 生效（0xAA00/0xAA01/0xAA02）', () => {
    const c = bleOf(
      gen(bleConfig({ serviceUuid16: 0xaa00, notifyUuid16: 0xaa01, writeUuid16: 0xaa02 })),
    )
    expect(c).toContain('const SERVICE_UUID: u16 = 0xAA00;')
    expect(c).toContain('const NOTIFY_UUID: u16 = 0xAA01;')
    expect(c).toContain('const WRITE_UUID: u16 = 0xAA02;')
    expect(c).toContain('lo_u16(SERVICE_UUID)')
  })

  it('CCCD 写必须交给 process_ccc_write_req + GATT_CLIENT_CFG_NOTIFY', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain(
      'GATTServApp::process_ccc_write_req(conn_handle, attr, value, len, offset, GATT_CLIENT_CFG_NOTIFY)',
    )
    expect(c).toContain('AppEvent::Subscribed(conn_handle)')
  })

  it('读回调：offset>0 → ATT_ERR_ATTR_NOT_LONG；未知 UUID → ATT_ERR_ATTR_NOT_FOUND', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('return ATT_ERR_ATTR_NOT_LONG;')
    expect(c).toContain('_ => ATT_ERR_ATTR_NOT_FOUND')
    expect(c).toContain('*plen = 1;')
  })

  it('notify：GATT_bm_alloc + GATT_Notification + 失败 GATT_bm_free + 订阅后 1s 周期', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('GATT_bm_alloc(conn_handle, ATT_HANDLE_VALUE_NOTI, 1, ptr::null_mut(), 0)')
    expect(c).toContain('GATT_Notification(conn_handle, &noti, 0).is_err()')
    expect(c).toContain('GATT_bm_free(buf as *mut gattMsg_t, ATT_HANDLE_VALUE_NOTI)')
    expect(c).toContain('Ticker::every(Duration::from_millis(1000))')
    expect(c).toContain('GATTServApp::read_char_cfg(handle')
  })

  it('写回调 1 字节命令经 Channel 发 AppEvent::Write', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('static APP_CHANNEL: Channel<CriticalSectionRawMutex, AppEvent, 8>')
    expect(c).toContain('APP_CHANNEL.try_send(AppEvent::Write(*value))')
    expect(c).toContain('enum AppEvent')
  })

  it('断连恢复：GAPROLE_WAITING + GAP_LINK_TERMINATED_EVENT → init_char_cfg + 重开广播', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('GAPROLE_WAITING =>')
    expect(c).toContain('GAP_LINK_TERMINATED_EVENT')
    expect(c).toContain('GATTServApp::init_char_cfg(ev.linkTerminate.connectionHandle, CLIENT_CHARCFG.as_mut_ptr())')
    expect(c).toContain('GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED, 1, &true as *const _ as _)')
  })

  it('配对缺省参数（D12）：WAIT_FOR_REQ + bonding + 非 MITM + DISPLAY_ONLY', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('let pair_mode = GAPBOND_PAIRING_MODE_WAIT_FOR_REQ;')
    expect(c).toContain('let mitm = false;')
    expect(c).toContain('let io_cap = GAPBOND_IO_CAP_DISPLAY_ONLY;')
    expect(c).toContain('let bonding = true;')
  })

  it('连接间隔缺省 6/100（1.25ms 单位）', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('const MIN_CONN_INTERVAL: u16 = 6;')
    expect(c).toContain('const MAX_CONN_INTERVAL: u16 = 100;')
    expect(c).toContain('GAPRole_SetParameter(GAPROLE_MIN_CONN_INTERVAL, 2, &MIN_CONN_INTERVAL as *const _ as _)')
  })

  it('回调结构体为 static（*StartDevice 要求 &\'static）', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('static BOND_CB: gapBondCBs_t')
    expect(c).toContain('static APP_CB: gapRolesCBs_t')
    expect(c).toContain('static SERVICE_CB: gattServiceCBs_t')
  })
})

describe('broadcaster（D4）', () => {
  it('广播：NONCONN_IND(0x03) + 短名 + Tx power，无 GATT 表', () => {
    const c = bleOf(gen(bleConfig({ role: 'broadcaster' })))
    expect(c).toContain('GAPRole::broadcaster_init()')
    expect(c).toContain('GAPRole_SetParameter(GAPROLE_ADV_EVENT_TYPE, 1, &GAP_ADTYPE_ADV_NONCONN_IND as *const _ as _)')
    expect(c).toContain('GAP_ADTYPE_LOCAL_NAME_SHORT')
    expect(c).toContain('GAP_ADTYPE_POWER_LEVEL')
    expect(c).not.toContain('PERIPHERAL_ATTR_TABLE')
    expect(c).not.toContain('GATT_bm_alloc')
  })

  it('扫描响应只有完整名（无 power 段、无 GATT）', () => {
    const c = bleOf(gen(bleConfig({ role: 'broadcaster' })))
    const scan = c.slice(c.indexOf('static SCAN_RSP_DATA'), c.indexOf('/// 广播角色回调'))
    expect(scan).toContain('GAP_ADTYPE_LOCAL_NAME_COMPLETE')
    expect(scan).not.toContain('GAP_ADTYPE_POWER_LEVEL')
  })

  it('broadcaster 不消费 TmosEvent（订阅者立即释放）', () => {
    const c = bleOf(gen(bleConfig({ role: 'broadcaster' })))
    expect(c).toContain('let (_task_id, _) = ble::init(config()).unwrap();')
    expect(c).not.toContain('next_message_pure')
  })
})

describe('observer（D4）', () => {
  it('observer：GAPROLE_ObserverStartDevice + 扫描窗口 ticks + activeScan 参数', () => {
    const c = bleOf(gen(bleConfig({ role: 'observer', scanMs: 3000, activeScan: false })))
    expect(c).toContain('const SCAN_WINDOW_TICKS: u16 = 4800;')
    expect(c).toContain('const OBSERVER_ACTIVE_SCAN: u8 = 0;')
    expect(c).toContain('GAPRole_ObserverStartDevice(&CALLBACK)')
    expect(c).toContain('GAP_SetParamValue(TGAP_DISC_SCAN, SCAN_WINDOW_TICKS)')
    expect(c).toContain('GAP_SetParamValue(TGAP_DISC_SCAN_PHY, GAP_PHY_BIT_LE_1M)')
  })

  it('observer：activeScan=true → 1；打印设备地址/RSSI', () => {
    const c = bleOf(gen(bleConfig({ role: 'observer', activeScan: true })))
    expect(c).toContain('const OBSERVER_ACTIVE_SCAN: u8 = 1;')
    expect(c).toContain('ble::MacAddress::from_raw(info.addr)')
    expect(c).toContain('info.rssi')
  })

  it('observer：周期重扫（发现完成 → CancelSync + StartDiscovery）', () => {
    const c = bleOf(gen(bleConfig({ role: 'observer' })))
    expect(c).toContain('GAP_DEVICE_DISCOVERY_EVENT')
    expect(c).toContain('GAPRole_CancelSync()')
    expect(c).toContain('GAPRole_ObserverStartDiscovery(OBSERVER_DISCOVERY_MODE, OBSERVER_ACTIVE_SCAN, 0)')
    expect(c).toContain('EVENTS.receive().await')
  })

  it('observer 不生成广播数据/GATT 表', () => {
    const c = bleOf(gen(bleConfig({ role: 'observer' })))
    expect(c).not.toContain('ADVERT_DATA')
    expect(c).not.toContain('PERIPHERAL_ATTR_TABLE')
    expect(c).not.toContain('GATT_bm_alloc')
  })
})

describe('单位换算（D4 契约 §1 单位表）', () => {
  it('广播间隔：100ms→160、101ms→162（四舍五入，0.625ms/单位）', () => {
    expect(advIntervalTicks(100)).toBe(160)
    expect(advIntervalTicks(101)).toBe(162)
  })

  it('广播间隔钳制：1ms→0x20(20ms)、20s→0x4000(10.24s)', () => {
    expect(advIntervalTicks(1)).toBe(0x20)
    expect(advIntervalTicks(20000)).toBe(0x4000)
    expect(contentOf(gen(bleConfig({ advIntervalMs: 1 })), 'src/generated/ble.rs')).toContain(
      'const ADV_INTERVAL_TICKS: u16 = 32;',
    )
  })

  it('扫描窗口：3000ms→4800、1ms→0x04、20s→0x4000', () => {
    expect(scanWindowTicks(3000)).toBe(4800)
    expect(scanWindowTicks(1)).toBe(0x04)
    expect(scanWindowTicks(20000)).toBe(0x4000)
  })

  it('广播/扫描响应负载字节数计算（peripheral 默认名 6 字节）', () => {
    const plan = buildBlePlan(bleConfig())
    expect(bleAdvPayloadBytes(plan)).toBe(20) // flags3 + mfr5 + uuid4 + nameTlv(2+6)
    expect(bleScanRspPayloadBytes(plan)).toBe(11) // nameTlv(2+6) + power3
    expect(bleAdvPayloadBytes(plan)).toBeLessThanOrEqual(31)
  })
})

describe('日志串口（D5）', () => {
  it('默认可用：生成 UartTx + set_default_serial（UART1/PA9 steal）', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('hal::uart::UartTx::new(')
    expect(c).toContain('hal::peripherals::UART1::steal()')
    expect(c).toContain('hal::peripherals::PA9::steal()')
    expect(c).toContain('hal::set_default_serial(uart);')
  })

  it('UART1 已被用户启用 → 不生成日志 wiring + BLE_LOG_SERIAL_UNAVAILABLE warning', () => {
    const cfg = bleConfig({}, { pins: [af('PA9', 'UART1_TX'), af('PA8', 'UART1_RX')] })
    const r = gen(cfg)
    expect(r.errors).toEqual([])
    const c = bleOf(r)
    expect(c).not.toContain('set_default_serial')
    const readme = contentOf(r, 'README.md')
    expect(readme).toContain('BLE 日志串口不可用')
    expect(readme).toContain('未生成 UartTx/set_default_serial')
    expect(readme).toContain('BLE 功能不受影响')
  })

  it('PA9 被普通 GPIO 占用 → 同样 warning（引脚级占用即放弃日志）', () => {
    const cfg = bleConfig({}, { pins: [pin('PA9', 'OUTPUT', { label: 'LED' })] })
    const r = gen(cfg)
    expect(bleOf(r)).not.toContain('set_default_serial')
    expect(contentOf(r, 'README.md')).toContain('BLE 日志串口不可用')
  })

  it('bleLogSerialAvailable 纯函数：BLE 关闭恒 false', () => {
    expect(bleLogSerialAvailable(baseConfig(), [])).toBe(false)
  })

  it('BLE_ADC_SHARED warning：BLE + ADC 同时启用', () => {
    const cfg = bleConfig({}, { pins: [pin('PA4', 'ANALOG', { function: 'ADC_IN0' })] })
    const r = gen(cfg)
    expect(r.errors).toEqual([])
    expect(contentOf(r, 'README.md')).toContain('BLE 的温度采样回调')
  })

  it('featureWarnings 支持旧调用（不传上下文）且 BLE warning 需要上下文', () => {
    const cfg = bleConfig()
    expect(featureWarnings(cfg).some((w) => w.code === 'BLE_LOG_SERIAL_UNAVAILABLE')).toBe(false)
    expect(featureWarnings(cfg, { logSerial: false }).some((w) => w.code === 'BLE_LOG_SERIAL_UNAVAILABLE')).toBe(true)
  })
})

describe('cube.json / README（D1/D12）', () => {
  it('cube.json 往返保留 ble 字段', () => {
    const cfg = bleConfig({ role: 'observer', deviceName: 'OBS-NODE', scanMs: 1500, activeScan: true })
    const cube = JSON.parse(contentOf(gen(cfg), 'cube.json')) as ProjectConfig
    expect(cube.features.ble).toBe(true)
    expect(cube.ble).toMatchObject({
      role: 'observer',
      deviceName: 'OBS-NODE',
      scanMs: 1500,
      activeScan: true,
      macSource: 'factory',
    })
  })

  it('README BLE 节列出 D12 全部诚实边界', () => {
    const c = contentOf(gen(bleConfig()), 'README.md')
    expect(c).toContain('BLE 诚实边界（D12）')
    expect(c).toContain('MTU 固定 23')
    expect(c).toContain('TX 功率固定 6dBm')
    expect(c).toContain('无 SNV')
    expect(c).toContain('central 角色不开放')
    expect(c).toContain('配对参数为缺省值')
    expect(c).toContain('旧工程启用 BLE')
    expect(c).toContain('generated::ble::run(&spawner).await;')
    expect(c).toContain('两线调试')
    expect(c).toContain('CFG_DEBUG_EN')
  })

  it('README 非 BLE 仍声明未生成 BLE', () => {
    const c = contentOf(gen(baseConfig()), 'README.md')
    expect(c).toContain('本期**不生成 BLE 代码**')
    expect(c).not.toContain('BLE 诚实边界')
  })
})

describe('derive 纯函数（BLE 兜底规则）', () => {
  it('bleGenerationErrors：非 BLE 返回空', () => {
    expect(bleGenerationErrors(baseConfig())).toEqual([])
  })

  it('bleGenerationErrors：已有同 code 时不重复报（冲突链优先）', () => {
    const cfg = bleConfig({ role: 'peripheral', deviceName: 'A'.repeat(40) })
    const dedup = bleGenerationErrors(cfg, new Set(['BLE_NAME_TOO_LONG']))
    expect(dedup.some((e) => e.code === 'BLE_NAME_TOO_LONG')).toBe(false)
  })

  it('bleGenerationErrors：blocking → BLE_REQUIRES_EMBASSY', () => {
    const cfg = bleConfig({}, { features: { embassy: false, debugPrint: false, ble: true } })
    expect(bleGenerationErrors(cfg).some((e) => e.code === 'BLE_REQUIRES_EMBASSY')).toBe(true)
  })
})
