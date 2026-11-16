// M3.1 NVIC/PFIC：irq.rs 生成、mod.rs 接线、项目文件解析与中断冲突规则。
import { describe, expect, it } from 'vitest'
import type { Conflict, PinAssignment, ProjectConfig } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { generateProject } from '@/model/codegen'
import { clampIrqPriority, enabledIrqs, renderIrq } from '@/model/codegen/irq'
import { checkConflicts } from '@/model/conflicts'
import { parseProjectFile, serializeProjectFile } from '@/services/projectFile'

const v003 = getDeviceData('CH32V003F4P6')
const h417 = getDeviceData('CH32H417QEU6')

function baseConfig(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'irq-demo',
    pins: [],
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: false },
    hal: { rev: 'test' },
    ...over,
  }
}

function pin(name: string, mode: PinAssignment['mode'], over: Partial<PinAssignment> = {}): PinAssignment {
  return { pin: name, mode, params: {}, ...over }
}

function fileMap(files: { path: string; content: string }[]): Record<string, string> {
  return Object.fromEntries(files.map((f) => [f.path, f.content]))
}

/** 中断规则新增代码不在共享 ConflictCode 联合内，测试按运行时字符串比较。 */
function hasCode(conflicts: Conflict[], code: string): boolean {
  return conflicts.some((c) => (c.code as string) === code)
}

describe('renderIrq：irq.rs 内容', () => {
  it('启用中断生成 enable + set_priority，按 IRQ 号排序', () => {
    const file = renderIrq(
      baseConfig({
        interrupts: [
          { irq: 'USART1', enabled: true, priority: 2 },
          { irq: 'EXTI7_0', enabled: true, priority: 5 },
        ],
      }),
      v003,
    )
    expect(file).not.toBeNull()
    expect(file!.path).toBe('src/generated/irq.rs')
    const c = file!.content
    expect(c).toContain('use ch32_hal::interrupt::{Interrupt, InterruptExt, Priority};')
    expect(c).toContain('pub fn init() {')
    expect(c).toContain('unsafe { Interrupt::EXTI7_0.enable(); }')
    expect(c).toContain('Interrupt::EXTI7_0.set_priority(Priority::P5);')
    expect(c).toContain('unsafe { Interrupt::USART1.enable(); }')
    expect(c).toContain('Interrupt::USART1.set_priority(Priority::P2);')
    // IRQ 号升序：EXTI7_0 (20) 在 USART1 (32) 之前
    expect(c.indexOf('Interrupt::EXTI7_0.enable')).toBeLessThan(c.indexOf('Interrupt::USART1.enable'))
  })

  it('无启用中断 / 空配置 → 不生成 irq.rs', () => {
    expect(renderIrq(baseConfig(), v003)).toBeNull()
    expect(
      renderIrq(baseConfig({ interrupts: [{ irq: 'USART1', enabled: false, priority: 3 }] }), v003),
    ).toBeNull()
    const r = generateProject(
      baseConfig({ interrupts: [{ irq: 'USART1', enabled: false, priority: 3 }] }),
      v003,
    )
    expect(r.errors).toEqual([])
    expect(r.files.some((f) => f.path === 'src/generated/irq.rs')).toBe(false)
    expect(fileMap(r.files)['src/generated/mod.rs']).not.toContain('pub mod irq;')
  })

  it('过滤芯片中断表里不存在的 IRQ', () => {
    const items = enabledIrqs(
      baseConfig({
        interrupts: [
          { irq: 'NOT_AN_IRQ', enabled: true, priority: 1 },
          { irq: 'USART1', enabled: true, priority: 3 },
        ],
      }),
      v003,
    )
    expect(items).toHaveLength(1)
    expect(items[0].irq).toBe('USART1')
    expect(renderIrq(baseConfig({ interrupts: [{ irq: 'NOT_AN_IRQ', enabled: true, priority: 1 }] }), v003)).toBeNull()
  })

  it('优先级夹取 0..15；非整数取整', () => {
    expect(clampIrqPriority(-1)).toBe(0)
    expect(clampIrqPriority(20)).toBe(15)
    expect(clampIrqPriority(2.9)).toBe(2)
    expect(clampIrqPriority(Number.NaN)).toBe(0)
    const file = renderIrq(
      baseConfig({ interrupts: [{ irq: 'USART1', enabled: true, priority: 99 }] }),
      v003,
    )
    expect(file!.content).toContain('Interrupt::USART1.set_priority(Priority::P15);')
  })

  it('H417：数据层 WakeUP/Alarm 名映射为 PAC 全大写枚举名', () => {
    const file = renderIrq(
      baseConfig({
        chip: 'CH32H417QEU6',
        interrupts: [
          { irq: 'USBPDWakeUP', enabled: true, priority: 1 },
          { irq: 'RTCAlarm', enabled: true, priority: 15 },
        ],
      }),
      h417,
    )
    const c = file!.content
    expect(c).toContain('unsafe { Interrupt::USBPDWAKEUP.enable(); }')
    expect(c).toContain('Interrupt::USBPDWAKEUP.set_priority(Priority::P1);')
    expect(c).toContain('Interrupt::RTCALARM.set_priority(Priority::P15);')
    expect(c).not.toContain('Interrupt::USBPDWakeUP')
    expect(c).not.toContain('Interrupt::RTCAlarm')
  })

  it('双核 base 前缀：v3f/src/generated/irq.rs', () => {
    const file = renderIrq(
      baseConfig({ chip: 'CH32H417QEU6', interrupts: [{ irq: 'USART1', enabled: true, priority: 0 }] }),
      h417,
      'v3f/',
    )
    expect(file!.path).toBe('v3f/src/generated/irq.rs')
  })
})

describe('generateProject 接线：modules + Generated::init', () => {
  it('生成 mod 声明并在 init 中调用 irq::init()', () => {
    const r = generateProject(
      baseConfig({ interrupts: [{ irq: 'USART1', enabled: true, priority: 2 }] }),
      v003,
    )
    expect(r.errors).toEqual([])
    const m = fileMap(r.files)
    expect(m['src/generated/irq.rs']).toContain('Interrupt::USART1.enable();')
    const mod = m['src/generated/mod.rs']
    expect(mod).toContain('pub mod irq;')
    expect(mod).toContain('    irq::init();')
    const initBody = mod.slice(mod.indexOf('pub fn init'))
    expect(initBody.indexOf('irq::init();')).toBeLessThan(initBody.indexOf('\n    Generated {'))
  })

  it('与 embassy bind_interrupts 共存', () => {
    const r = generateProject(
      baseConfig({
        features: { embassy: true, debugPrint: false },
        peripherals: { USART1: { enabled: true, params: {} }, I2C1: { enabled: true, params: {} } },
        pins: [
          pin('PD5', 'AF', { function: 'USART1_TX', remap: 0 }),
          pin('PD6', 'AF', { function: 'USART1_RX', remap: 0 }),
          pin('PC2', 'AF', { function: 'I2C1_SCL', remap: 0 }),
          pin('PC1', 'AF', { function: 'I2C1_SDA', remap: 0 }),
        ],
        interrupts: [
          { irq: 'USART1', enabled: true, priority: 1 },
          { irq: 'I2C1_EV', enabled: true, priority: 2 },
          { irq: 'I2C1_ER', enabled: true, priority: 3 },
        ],
      }),
      v003,
    )
    expect(r.errors).toEqual([])
    const mod = fileMap(r.files)['src/generated/mod.rs']
    expect(mod).toContain('hal::bind_interrupts!')
    expect(mod).toContain('USART1 => hal::usart::InterruptHandler')
    expect(mod).toContain('irq::init();')
  })

  it('未知 IRQ 被冲突规则阻止导出', () => {
    const r = generateProject(
      baseConfig({ interrupts: [{ irq: 'BOGUS_IRQ', enabled: true, priority: 0 }] }),
      v003,
    )
    expect(r.files).toEqual([])
    expect(hasCode(r.errors, 'IRQ_UNKNOWN')).toBe(true)
    expect(r.errors.find((e) => (e.code as string) === 'IRQ_UNKNOWN')!.level).toBe('error')
  })
})

describe('中断冲突规则', () => {
  it('IRQ_UNKNOWN：不在芯片中断表 → error', () => {
    const out = checkConflicts(
      baseConfig({ interrupts: [{ irq: 'BOGUS_IRQ', enabled: true, priority: 0 }] }),
      v003,
    )
    const c = out.find((x) => (x.code as string) === 'IRQ_UNKNOWN')!
    expect(c.level).toBe('error')
    expect(c.message).toContain('BOGUS_IRQ')
    expect(c.message).toContain('CH32V003F4P6')
  })

  it('IRQ_PRIORITY_DUPLICATE：多条启用中断同优先级 → warning', () => {
    const out = checkConflicts(
      baseConfig({
        interrupts: [
          { irq: 'USART1', enabled: true, priority: 2 },
          { irq: 'SPI1', enabled: true, priority: 2 },
        ],
      }),
      v003,
    )
    const c = out.find((x) => (x.code as string) === 'IRQ_PRIORITY_DUPLICATE')!
    expect(c.level).toBe('warning')
    expect(c.message).toContain('USART1')
    expect(c.message).toContain('SPI1')
    expect(c.message).toContain('P2')
  })

  it('IRQ_PRIORITY_DUPLICATE：仅启用项参与，禁用项不告警', () => {
    const out = checkConflicts(
      baseConfig({
        interrupts: [
          { irq: 'USART1', enabled: true, priority: 2 },
          { irq: 'SPI1', enabled: false, priority: 2 },
        ],
      }),
      v003,
    )
    expect(hasCode(out, 'IRQ_PRIORITY_DUPLICATE')).toBe(false)
  })

  it('IRQ_EMBASSY_NOT_ENABLED：异步 USART 未启用 IRQ → warning', () => {
    const out = checkConflicts(
      baseConfig({
        features: { embassy: true, debugPrint: false },
        peripherals: { USART1: { enabled: true, params: {} } },
      }),
      v003,
    )
    const c = out.find((x) => (x.code as string) === 'IRQ_EMBASSY_NOT_ENABLED')!
    expect(c.level).toBe('warning')
    expect(c.message).toContain('USART1')
    expect(c.peripheral).toBe('USART1')
  })

  it('IRQ_EMBASSY_NOT_ENABLED：已启用 IRQ 或非 embassy 时不告警', () => {
    const enabled = checkConflicts(
      baseConfig({
        features: { embassy: true, debugPrint: false },
        peripherals: { USART1: { enabled: true, params: {} } },
        interrupts: [{ irq: 'USART1', enabled: true, priority: 1 }],
      }),
      v003,
    )
    expect(hasCode(enabled, 'IRQ_EMBASSY_NOT_ENABLED')).toBe(false)

    const blocking = checkConflicts(
      baseConfig({ peripherals: { USART1: { enabled: true, params: {} } } }),
      v003,
    )
    expect(hasCode(blocking, 'IRQ_EMBASSY_NOT_ENABLED')).toBe(false)
  })

  it('IRQ_EMBASSY_NOT_ENABLED：I2C 的 EV/ER 双中断分别提示', () => {
    const out = checkConflicts(
      baseConfig({
        features: { embassy: true, debugPrint: false },
        peripherals: { I2C1: { enabled: true, params: {} } },
        interrupts: [{ irq: 'I2C1_EV', enabled: true, priority: 1 }],
      }),
      v003,
    )
    const msgs = out.filter((x) => (x.code as string) === 'IRQ_EMBASSY_NOT_ENABLED').map((x) => x.message)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('I2C1_ER')
  })
})

describe('parseProjectFile interruptions 校验', () => {
  function parse(raw: Record<string, unknown>): ProjectConfig {
    const result = parseProjectFile(JSON.stringify({ version: 1, chip: 'CH32V003F4P6', ...raw }))
    if ('error' in result) throw new Error(result.error)
    return result.config
  }

  it('合法 interrupt 数组原样保留（irq 去首尾空格）', () => {
    const config = parse({
      interrupts: [
        { irq: 'USART1', enabled: true, priority: 2 },
        { irq: ' SPI1 ', enabled: false, priority: 15 },
      ],
    })
    expect(config.interrupts).toEqual([
      { irq: 'USART1', enabled: true, priority: 2 },
      { irq: 'SPI1', enabled: false, priority: 15 },
    ])
  })

  it('旧工程缺 interrupts 时不新增属性（向后兼容）', () => {
    expect(parse({}).interrupts).toBeUndefined()
  })

  it('非数组忽略；非法项逐条过滤', () => {
    expect(parse({ interrupts: 'USART1' }).interrupts).toBeUndefined()

    const config = parse({
      interrupts: [
        null,
        'USART1',
        { irq: 42, enabled: true, priority: 1 },
        { irq: '', enabled: true, priority: 1 },
        { irq: 'USART1', enabled: 'true', priority: 1 },
        { irq: 'USART1', enabled: true, priority: '1' },
        { irq: 'USART1', enabled: true, priority: 1.5 },
        { irq: 'USART1', enabled: true, priority: -1 },
        { irq: 'USART1', enabled: true, priority: 16 },
        { irq: 'USART1', enabled: true, priority: 1 },
      ],
    })
    expect(config.interrupts).toEqual([{ irq: 'USART1', enabled: true, priority: 1 }])
  })

  it('序列化往返保留 interrupts', () => {
    const config = baseConfig({
      interrupts: [
        { irq: 'USART1', enabled: true, priority: 2 },
        { irq: 'I2C1_EV', enabled: false, priority: 9 },
      ],
    })
    const parsed = parseProjectFile(serializeProjectFile(config))
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.config.interrupts).toEqual(config.interrupts)
  })
})