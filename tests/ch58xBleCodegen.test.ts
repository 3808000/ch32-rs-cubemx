// M12/M13：ch58x-hal BLE 协议栈代码生成测试（CH582M）。
// 契约：docs/CH58X_BLE_CONTRACT.md D1–D12；M13 实机修复见 docs/HAL_API_NOTES.md §14.2bis
// （mstatus.MIE=0 → 入口 csrs mstatus,8；SysTick WFI 停计 → BLE 档 busy-poll；无 LSE 晶振 → LSI 缺省）。
// HAL 签名基准 reference/ch58x-hal @ 611954e
// （src/ble/{mod,gap,gatt,gattservapp,ffi}.rs + examples/ble-{blinky,peripheral,broadcaster,scanner}.rs）。
// 覆盖：接线/错误兜底、LSI（不追加 enable_lse）、MAC 三来源、单订阅者、无原子、busy-poll TMOS 泵、
//       try API 逐字核对、stable 工具链、GATT 表/CCCD/notify 循环计数、
//       广播/扫描 TLV 与设备名三处同步、间隔换算、UUID 参数化、Cargo features、README 诚实边界、
//       cube.json 往返、fileGroup。
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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

  it('ble 时时钟模块被强制生成（BLE 库需要 PLL 主频配置；M14 起 stack_init 自建配置）', () => {
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

  it('main.rs：qingke_rt entry + csrs mstatus,8（hal::init 之前）+ generated::ble::run()', () => {
    const c = contentOf(gen(bleConfig()), 'src/main.rs')
    expect(c).toContain('#[qingke_rt::entry]')
    expect(c).toContain('fn main() -> !')
    expect(c).toContain('generated::ble::run();')
    const iCsrs = c.indexOf('core::arch::asm!("csrs mstatus, 8")')
    const iInit = c.indexOf('hal::init(')
    const iRun = c.indexOf('generated::ble::run(')
    expect(iCsrs).toBeGreaterThanOrEqual(0)
    expect(iInit).toBeGreaterThan(iCsrs)
    expect(iRun).toBeGreaterThan(iInit)
  })
})

describe('BLE 32K 时钟源（M14 实机裁决：lse 缺省，lsi 回退）', () => {
  it('缺省 lse：预设时钟链追加 config.clock.enable_lse()（与 SelRTCClock=0 一致）', () => {
    const c = contentOf(gen(bleConfig()), 'src/generated/clock.rs')
    expect(c).toContain('config.clock.use_pll_60mhz();')
    expect(c).toContain('config.clock.enable_lse();')
  })

  it('缺省 lse：显式 PLL 分频同样追加 enable_lse', () => {
    const c = contentOf(gen(bleConfig({}, { clock: pllClock(7) })), 'src/generated/clock.rs')
    expect(c).toContain('config.clock.mux = hal::sysctl::ClockSrc::PLL(7);')
    expect(c).toContain('config.clock.enable_lse();')
  })

  it('clock32k=lsi（无晶振板回退）：不生成 enable_lse', () => {
    const c = contentOf(gen(bleConfig({ clock32k: 'lsi' })), 'src/generated/clock.rs')
    expect(c).not.toContain('.enable_lse()')
  })

  it('旧 cube.json 无 clock32k 字段 → 按 lse 处理（parseBleConfig 缺省）', () => {
    const c = contentOf(gen(bleConfig({ clock32k: undefined })), 'src/generated/clock.rs')
    expect(c).toContain('config.clock.enable_lse();')
  })

  it('非 BLE 不生成 enable_lse（LSI 缺省）', () => {
    expect(contentOf(gen(baseConfig()), 'src/generated/clock.rs')).not.toContain('.enable_lse()')
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

describe('MAC 三来源（D1；M14：mac_addr_lsb 直供 bleConfig_t.MacAddr）', () => {
  it('default → LSB first [0x66, 0x55, 0x44, 0x33, 0x22, 0x11]（11:22:33:44:55:66）', () => {
    const c = bleOf(gen(bleConfig({ macSource: 'default' })))
    expect(c).toContain('[0x66, 0x55, 0x44, 0x33, 0x22, 0x11]')
    expect(c).not.toContain('get_mac_address')
  })

  it('factory → hal::isp::get_mac_address()（返回值即 LSB first）', () => {
    const c = bleOf(gen(bleConfig({ macSource: 'factory' })))
    expect(c).toContain('hal::isp::get_mac_address()')
  })

  it('custom → MSB 反转为 LSB first 字面量', () => {
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

  it('flags 带 GENERAL discoverable 位（M13 实机：无 discoverable 位被 bluez 发现流程过滤；observer 不广播故无 flags）', () => {
    for (const role of ['peripheral', 'broadcaster'] as const) {
      const c = bleOf(gen(bleConfig({ role })))
      expect(c).toContain('GAP_ADTYPE_FLAGS_GENERAL | GAP_ADTYPE_FLAGS_BREDR_NOT_SUPPORTED')
    }
    expect(bleOf(gen(bleConfig({ role: 'observer' })))).not.toContain('ADVERT_DATA')
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

  it('BLE 档追加 embassy-sync（try API 来源）+ critical-section（共享状态）直依赖', () => {
    const c = contentOf(gen(bleConfig()), 'Cargo.toml')
    expect(c).toContain('embassy-sync = "0.6.2"')
    expect(c).toContain('critical-section = "1.2"')
  })

  it('BLE 档无 embassy-executor/embassy-time，但保留 generic-queue 链接修复', () => {
    const c = contentOf(gen(bleConfig()), 'Cargo.toml')
    expect(c).not.toContain('embassy-executor =')
    expect(c).not.toContain('embassy-time = "0.4.0"')
    expect(c).toContain('embassy-time-queue-utils = { version = "0.1.0", features = ["generic-queue-8"] }')
    expect(c).toContain('[profile.release-debug]')
  })

  it('非 BLE 档保持 M11：features ["embassy"] 且无 embassy-sync', () => {
    const c = contentOf(gen(baseConfig()), 'Cargo.toml')
    expect(c).toContain('features = ["embassy"]')
    expect(c).not.toContain('embassy-sync')
  })
})

describe('stack_init（M14：32K 域一致自建协议栈初始化，替代 ble::init）', () => {
  it('不再调用 ble::init（其硬编码 SelRTCClock=0 LSE 在无晶振板上连接失败）', () => {
    for (const role of ['peripheral', 'broadcaster', 'observer'] as const) {
      const c = bleOf(gen(bleConfig({ role })))
      expect(c).not.toContain('ble::init(')
      expect(c).toContain('stack_init(mac_addr_lsb())')
    }
  })

  it('bleConfig_t：SelRTCClock=0（LSE 缺省）/1（lsi 回退）+ 堆 6KB + BufMaxLen=27 + ConnectNumber', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('cfg.SelRTCClock = 0;')
    // lsi 回退档 → SelRTCClock=1（M14 clock32k 选项）
    expect(bleOf(gen(bleConfig({ clock32k: 'lsi' })))).toContain('cfg.SelRTCClock = 1;')
    expect(c).toContain('static mut STACK_HEAP: [core::mem::MaybeUninit<u8>; 6 * 1024]')
    expect(c).toContain('cfg.MEMAddr = STACK_HEAP.as_ptr() as u32;')
    expect(c).toContain('cfg.BufMaxLen = 27;')
    expect(c).toContain('cfg.BufNumber = 5;')
    expect(c).toContain('cfg.TxPower = LL_TX_POWEER_6_DBM;')
    expect(c).toContain('cfg.ConnectNumber = (1 & 3) | (3 << 2);')
    expect(c).toContain('cfg.MacAddr = mac_lsb;')
  })

  it('初始化链：BLE_LibInit → TMOS_TimerInit → TMOS_ProcessEventRegister → 120s RegInit 定时', () => {
    const c = bleOf(gen(bleConfig()))
    const init = c.slice(c.indexOf('fn stack_init('))
    const i = (s: string) => init.indexOf(s)
    expect(i('BLE_LibInit(&cfg).unwrap();')).toBeGreaterThanOrEqual(0)
    expect(i('TMOS_TimerInit(core::ptr::null()).unwrap();')).toBeGreaterThan(i('BLE_LibInit'))
    expect(i('TMOS_ProcessEventRegister(Some(stack_tmos_task))')).toBeGreaterThan(i('TMOS_TimerInit'))
    expect(i('tmos_start_task(task_id, HAL_REG_INIT_EVENT, REG_INIT_INTERVAL_TICKS);')).toBeGreaterThan(i('TMOS_ProcessEventRegister'))
    expect(c).toContain('const REG_INIT_INTERVAL_TICKS: u32 = 120_000 * 1000 / 625;')
  })

  it('TMOS 任务：SYS_EVENT_MSG → publish_immediate（单订阅者）；RegInit 事件 → BLE_RegInit + 重定时', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('STACK_CHANNEL.publish_immediate(hal::ble::TmosEvent(msg as _));')
    expect(c).toContain('tmos_msg_receive(task_id)')
    expect(c).toContain('BLE_RegInit();')
    expect(c).toContain('const HAL_REG_INIT_EVENT: u16 = 0x2000;')
    // 通道参数与 HAL CHANNEL 一致（容量 4 / 2 订阅 / 2 发布）
    expect(c).toContain('hal::ble::TmosEvent,\n    4,\n    2,\n    2,')
  })

  it('SysTick 自由运行（随机种子源，只计数不开中断）+ srandCB/tsCB 接线', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('st.cmp().write(|w| w.bits(0xFFFF_FFFF));')
    expect(c).toContain('.ste()\n                .set_bit()')
    expect(c).not.toContain('stie')
    expect(c).toContain('cfg.srandCB = Some(stack_srand);')
    expect(c).toContain('cfg.tsCB = Some(hal::ble::temperature_raw);')
    expect(c).toContain('(&*hal::pac::SYSTICK::PTR).cnt().read().bits()')
  })
})

describe('ble.rs 结构与初始化顺序（D4/D6）', () => {
  it('初始化顺序：run 内 stack_init < 角色 init < 角色参数 < 公共初始化 < 服务注册 < StartDevice < 主循环', () => {
    const c = bleOf(gen(bleConfig()))
    // run 函数体（定义顺序不代表调用顺序，只看 run 内）
    const runBody = c.slice(c.indexOf('pub fn run('))
    const i = (s: string) => runBody.indexOf(s)
    const seq = [
      'stack_init(mac_addr_lsb())',
      'GAPRole::peripheral_init()',
      'role_profile_init();',
      'common_init();',
      'peripheral_service_init();',
      'GAPRole_PeripheralStartDevice(task_id, &BOND_CB, &APP_CB)',
      'tmos_poll(subscriber)',
    ]
    for (const s of seq) expect(i(s)).toBeGreaterThanOrEqual(0)
    for (let k = 1; k < seq.length; k++) expect(i(seq[k])).toBeGreaterThan(i(seq[k - 1]))
    // 服务注册在 register_service 中；StartDevice 现在直接写在 run 内（服务注册之后）
    const svcDef = c.slice(c.indexOf('unsafe fn peripheral_service_init'), c.indexOf('unsafe extern "C" fn on_gap_state_change'))
    expect(svcDef).toContain('GATTServApp::register_service(&mut PERIPHERAL_ATTR_TABLE[..]')
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
    const runBody = c.slice(c.indexOf('pub fn run('))
    expect(runBody.indexOf('common_init();')).toBeLessThan(runBody.indexOf('peripheral_service_init();'))
  })

  it('TMOS 泵：busy-poll 连续轮询（无 delay，M14）+ #[highcode] + TMOS_SystemProcess', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('#[highcode]\nfn tmos_poll(mut subscriber: ble::EventSubscriber) -> !')
    expect(c).toContain('TMOS_SystemProcess();')
    // M14 实机修复：delay 会饿死连接事件（官方 C Main_Circulation 为连续轮询）
    expect(c).not.toContain('hal::delay_us')
    // 不再使用 embassy Timer/Ticker（CH58x SysTick 空闲停计 → 上游时间驱动饿死）
    expect(c).not.toContain('Ticker::every')
    expect(c).not.toContain('embassy_time')
  })

  it('run 内先 StartDevice 再进入 busy-poll 主循环（无 spawner/spawn）', () => {
    const c = bleOf(gen(bleConfig()))
    const runBody = c.slice(c.indexOf('pub fn run('))
    expect(runBody.indexOf('GAPRole_PeripheralStartDevice(task_id, &BOND_CB, &APP_CB)')).toBeGreaterThan(0)
    expect(runBody.indexOf('tmos_poll(subscriber)')).toBeGreaterThan(
      runBody.indexOf('GAPRole_PeripheralStartDevice(task_id, &BOND_CB, &APP_CB)'),
    )
    expect(c).not.toContain('spawner.spawn')
    expect(c).not.toContain('embassy_executor')
  })

  it('单订阅者：全文件只有一处 subscriber.try_next_message_pure，无 subscriber/TmosEvent clone', () => {
    const c = bleOf(gen(bleConfig()))
    // 文件头注释会多次提到 API 名，实际调用点只能有一处（单订阅者；多消费者 = double free）
    expect(c.match(/subscriber\.try_next_message_pure\(\)/g)?.length).toBe(1)
    expect(c).not.toContain('next_message_pure().await')
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
    expect(c).not.toContain('AppEvent')
  })

  it('读回调：offset>0 → ATT_ERR_ATTR_NOT_LONG；未知 UUID → ATT_ERR_ATTR_NOT_FOUND', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('return ATT_ERR_ATTR_NOT_LONG;')
    expect(c).toContain('_ => ATT_ERR_ATTR_NOT_FOUND')
    expect(c).toContain('*plen = 1;')
  })

  it('notify：GATT_bm_alloc + GATT_Notification + 失败 GATT_bm_free + SysTick 时基周期 + read_char_cfg', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('GATT_bm_alloc(conn_handle, ATT_HANDLE_VALUE_NOTI, 1, ptr::null_mut(), 0)')
    expect(c).toContain('GATT_Notification(conn_handle, &noti, 0).is_err()')
    expect(c).toContain('GATT_bm_free(buf as *mut gattMsg_t, ATT_HANDLE_VALUE_NOTI)')
    // M14：协议栈自身时基 625µs/tick × 1600 = 1s（连续轮询后不能再数循环圈数）
    // M14：SysTick CNT 时基（≈HCLK，周期取 clocks().hclk）；TMOS_GetSystemClock 每圈含 u64 软除法弃用
    expect(c).toContain('let notify_period: u32 = hal::sysctl::clocks().hclk.to_Hz();')
    expect(c).toContain('(&*hal::pac::SYSTICK::PTR).cnt().read().bits() as u32')
    expect(c).toContain('now.wrapping_sub(last_notify) >= notify_period')
    // 注释里会提到弃用原因；只断言不存在实际调用
    expect(c).not.toContain('unsafe { TMOS_GetSystemClock() }')
    expect(c).toContain('GATTServApp::read_char_cfg(handle')
    expect(c).not.toContain('ticker')
  })

  it('写回调 1 字节命令直接落共享状态（static mut + critical_section，无 Channel）', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('static mut STATE: BleState')
    expect(c).toContain('critical_section::with(|_| unsafe { f(&mut STATE) })')
    expect(c).toContain('with_state(|s| s.notify_value = byte)')
    expect(c).not.toContain('embassy_sync::channel')
    expect(c).not.toContain('APP_CHANNEL')
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

  it('broadcaster 不消费 TmosEvent（订阅者立即释放），主循环无 event try-poll', () => {
    const c = bleOf(gen(bleConfig({ role: 'broadcaster' })))
    expect(c).toContain('let (_task_id, _) = stack_init(mac_addr_lsb());')
    expect(c).not.toContain('subscriber.try_next_message_pure')
    // stack_init 签名含 EventSubscriber（所有角色共享），但 broadcaster 主循环不接收订阅者
    expect(c).not.toContain('fn tmos_poll(mut subscriber')
    expect(c).toContain('fn tmos_poll() -> !')
    expect(c).toContain('GAPRole_BroadcasterStartDevice(&CALLBACKS)')
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

  it('observer：周期重扫（发现完成 → 置位后由主循环 CancelSync + StartDiscovery，不回调内重入）', () => {
    const c = bleOf(gen(bleConfig({ role: 'observer' })))
    expect(c).toContain('GAP_DEVICE_DISCOVERY_EVENT')
    expect(c).toContain('static mut RESTART_DISCOVERY: bool = false;')
    expect(c).toContain('GAPRole_CancelSync()')
    expect(c).toContain('GAPRole_ObserverStartDiscovery(OBSERVER_DISCOVERY_MODE, OBSERVER_ACTIVE_SCAN, 0)')
    expect(c).toContain('println!("BLE: discovery done, restarting")')
    // 回调只置位；重启发生在 tmos_poll 主循环（TMOS 回调内重入协议栈不安全）
    const cb = c.slice(c.indexOf('unsafe extern "C" fn observer_event_callback'), c.indexOf('#[highcode]'))
    expect(cb).toContain('RESTART_DISCOVERY = true;')
    expect(cb).not.toContain('GAPRole_CancelSync()')
    const poll = c.slice(c.indexOf('#[highcode]\nfn tmos_poll'))
    expect(poll).toContain('if RESTART_DISCOVERY {')
    expect(poll).toContain('GAPRole_CancelSync()')
    expect(c).not.toContain('EVENTS.receive().await')
    expect(c).not.toContain('embassy_executor')
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

  it('README BLE 节列出 D12/M13 全部诚实边界', () => {
    const c = contentOf(gen(bleConfig()), 'README.md')
    expect(c).toContain('BLE 诚实边界（D12 / M13）')
    expect(c).toContain('MTU 固定 23')
    expect(c).toContain('TX 功率固定 6dBm')
    expect(c).toContain('无 SNV')
    expect(c).toContain('central 角色不开放')
    expect(c).toContain('配对参数为缺省值')
    expect(c).toContain('旧工程启用 BLE')
    expect(c).toContain('generated::ble::run();')
    expect(c).toContain('两线调试')
    expect(c).toContain('CFG_DEBUG_EN')
    // M13：busy-poll / LSI / GPIO 异步边界
    expect(c).toContain('busy-poll')
    expect(c).toContain('HAL_API_NOTES.md')
    expect(c).toContain('32K 时钟源 LSE 缺省（M14 实机裁决）')
    expect(c).toContain('GPIO 异步等待本期 BLE 档不提供')
    expect(c).not.toContain('generated::ble::run(&spawner)')
  })

  it('README 非 BLE 仍声明未生成 BLE', () => {
    const c = contentOf(gen(baseConfig()), 'README.md')
    expect(c).toContain('本期**不生成 BLE 代码**')
    expect(c).not.toContain('BLE 诚实边界')
  })
})

describe('M13 busy-poll 运行时（实机修复回归）', () => {
  it('main.rs 无 nightly feature / embassy_executor / hal::embassy::init（busy-poll 不需要）', () => {
    const c = contentOf(gen(bleConfig()), 'src/main.rs')
    expect(c).not.toContain('#![feature(')
    expect(c).not.toContain('embassy_executor')
    expect(c).not.toContain('hal::embassy::init()')
    expect(c).not.toContain('Spawner')
    expect(c).not.toContain('.await')
  })

  it('三角色 ble.rs 均接 RF 中断：BLEL/BLEB → 库 ISR（ll_tx_wait_finish 死等实机根因）', () => {
    for (const role of ['peripheral', 'broadcaster', 'observer'] as const) {
      const c = contentOf(gen(bleConfig({ role })), 'src/generated/ble.rs')
      expect(c).toContain('fn LLE_IRQLibHandler();')
      expect(c).toContain('fn BB_IRQLibHandler();')
      expect(c).toContain('#[qingke_rt::interrupt]\nfn BLEL()')
      expect(c).toContain('#[qingke_rt::interrupt]\nfn BLEB()')
      expect(c).toContain('unsafe { LLE_IRQLibHandler() }')
      expect(c).toContain('unsafe { BB_IRQLibHandler() }')
    }
  })

  it('csrs mstatus,8 在 hal::init 之前（MIE=0 实机根因）', () => {
    const c = contentOf(gen(bleConfig()), 'src/main.rs')
    const iCsrs = c.indexOf('core::arch::asm!("csrs mstatus, 8")')
    const iInit = c.indexOf('hal::init(')
    expect(iCsrs).toBeGreaterThanOrEqual(0)
    expect(iInit).toBeGreaterThan(iCsrs)
    // 只在入口出现一次
    expect(c.match(/csrs mstatus, 8/g)?.length).toBe(1)
  })

  it('busy loop：TMOS_SystemProcess 连续轮询（无 delay，M14），且无 Ticker/Duration/await', () => {
    const c = bleOf(gen(bleConfig()))
    const poll = c.slice(c.indexOf('#[highcode]\nfn tmos_poll'))
    const iTmos = poll.indexOf('TMOS_SystemProcess();')
    expect(iTmos).toBeGreaterThanOrEqual(0)
    // M14 实机修复：300µs 间隙饿死连接事件（官方 C 为连续轮询）
    expect(poll).not.toContain('delay_us')
    expect(poll).not.toContain('Duration')
    expect(poll).not.toContain('await')
    expect(poll).not.toContain('Ticker')
  })

  it('try API 名字与 embassy-sync 0.6.2 源码逐字一致（try_next_message_pure）', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('subscriber.try_next_message_pure()')
    expect(c).toContain('embassy-sync 0.6.2')
    // 本机 cargo registry 存在时直接核对签名（CI 无 registry 则跳过源码核对）
    const root = join(homedir(), '.cargo', 'registry', 'src')
    if (!existsSync(root)) return
    let checked = false
    for (const idx of readdirSync(root)) {
      const p = join(root, idx, 'embassy-sync-0.6.2', 'src', 'pubsub', 'subscriber.rs')
      if (!existsSync(p)) continue
      const src = readFileSync(p, 'utf8')
      expect(src).toContain('pub fn try_next_message_pure(&mut self) -> Option<T>')
      checked = true
    }
    expect(checked).toBe(true)
  })

  it('工具链 stable（不再需要 nightly feature）', () => {
    const r = gen(bleConfig())
    const toolchain = contentOf(r, 'rust-toolchain.toml')
    expect(toolchain).toContain('channel = "stable"')
    expect(toolchain).not.toContain('channel = "nightly"')
  })

  it('BLE 档即使 features.embassy=true 也不生成 executor/time 依赖（忽略运行时档）', () => {
    const r = gen(bleConfig())
    const cargo = contentOf(r, 'Cargo.toml')
    expect(cargo).not.toContain('embassy-executor =')
    expect(cargo).not.toContain('embassy-time = "0.4.0"')
    expect(cargo).not.toContain('"nightly"')
    expect(cargo).toContain('critical-section = "1.2"')
  })

  it('notify 周期为 SysTick 时基（≈1s 随 HCLK）而非 embassy 定时器/TMOS 软除法（M14）', () => {
    const c = bleOf(gen(bleConfig()))
    expect(c).toContain('hal::sysctl::clocks().hclk.to_Hz()')
    expect(c).toContain('SYSTICK::PTR).cnt().read()')
    expect(c).not.toContain('NOTIFY_PERIOD_ITERS')
    expect(c).not.toContain('unsafe { TMOS_GetSystemClock() }')
    expect(c).not.toContain('embassy_time::Timer')
  })

  it('断连恢复保留：重初始化 CCCD + 清连接句柄 + 重新开广播', () => {
    const c = bleOf(gen(bleConfig()))
    const iWaiting = c.indexOf('GAPROLE_WAITING =>')
    const block = c.slice(iWaiting, c.indexOf('_ => {}', iWaiting))
    expect(block).toContain('GATTServApp::init_char_cfg(ev.linkTerminate.connectionHandle, CLIENT_CHARCFG.as_mut_ptr())')
    expect(block).toContain('with_state(|s| s.conn = None)')
    expect(block).toContain('GAPRole_SetParameter(GAPROLE_ADVERT_ENABLED, 1, &true as *const _ as _)')
  })

  it('生成物不含 create 的异步任务/#[embassy_executor::task]（busy-poll 全部同步）', () => {
    for (const role of ['peripheral', 'broadcaster', 'observer'] as const) {
      const c = bleOf(gen(bleConfig({ role })))
      expect(c).not.toContain('#[embassy_executor::task]')
      expect(c).not.toContain('async fn')
      expect(c).not.toContain('spawner')
    }
  })

  it('非 BLE blocking 档回归：入口不变、无 csrs/无 run 调用', () => {
    const r = gen(baseConfig())
    const c = contentOf(r, 'src/main.rs')
    expect(c).toContain('#[qingke_rt::entry]')
    expect(c).not.toContain('csrs mstatus')
    expect(c).not.toContain('generated::ble::run')
    expect(c).not.toContain('#![feature(')
    expect(contentOf(r, 'rust-toolchain.toml')).toContain('channel = "stable"')
  })

  it('非 BLE embassy 档回归：entry 宏 + nightly feature + hal::embassy::init', () => {
    const r = gen(baseConfig({ features: { embassy: true, debugPrint: false } }))
    const c = contentOf(r, 'src/main.rs')
    expect(c).toContain('#![feature(impl_trait_in_assoc_type)]')
    expect(c).toContain('#[embassy_executor::main(entry = "qingke_rt::entry")]')
    expect(c).toContain('hal::embassy::init();')
    expect(c).not.toContain('csrs mstatus')
    expect(contentOf(r, 'rust-toolchain.toml')).toContain('channel = "nightly"')
  })

  it('HTML 报告概览：BLE 档运行时标为 busy-poll（不谎称 blocking/embassy）', () => {
    const html = contentOf(gen(bleConfig(), { htmlReport: true }), 'report.html')
    expect(html).toContain('busy-poll（BLE，stable，无 executor/Timer）')
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
