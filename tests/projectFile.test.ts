// 工程配置回读测试：parseProjectFile / serializeProjectFile。
// 覆盖：合法配置、序列化往返、非法 JSON、缺 version、未知芯片、缺字段旧工程。
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '@/model/types'
import { parseProjectFile, serializeProjectFile } from '@/services/projectFile'
import { HAL_REV } from '@/model/codegen/halRev'

/** 解析成功时取 config，失败时让测试直接报错 */
function expectConfig(text: string): ProjectConfig {
  const result = parseProjectFile(text)
  if ('error' in result) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.config
}

/** 解析失败时取 error，成功时让测试直接报错 */
function expectError(text: string): string {
  const result = parseProjectFile(text)
  if ('config' in result) throw new Error('期望解析失败，实际成功')
  return result.error
}

function validConfig(): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'blink-demo',
    pins: [
      {
        pin: 'PD6',
        label: 'LED_RUN',
        mode: 'OUTPUT',
        params: { level: 'LOW', speed: 'MEDIUM', outputType: 'PUSH_PULL' },
      },
      {
        pin: 'PC4',
        label: 'KEY0',
        mode: 'INPUT',
        params: { pull: 'UP' },
      },
    ],
    groups: [{ name: 'LED', pins: ['PD6'], color: '#ffd100' }],
    naming: { prefix: 'app' },
    clock: { source: 'HSI', ahb: 1, apb1: 1, apb2: 1 },
    peripherals: { USART1: { enabled: false, params: { baudrate: 115200 } } },
    features: { embassy: false, debugPrint: true },
    hal: { rev: HAL_REV },
    unlockedPins: ['PD7', 'PD1'],
  }
}

describe('parseProjectFile 合法配置', () => {
  it('解析完整 cube.json 并保留全部字段', () => {
    const config = validConfig()
    expect(expectConfig(JSON.stringify(config))).toEqual(config)
  })

  it('允许参数中带空格与中文工程名', () => {
    const config = validConfig()
    config.projectName = '闪灯 工程'
    expect(expectConfig(JSON.stringify(config)).projectName).toBe('闪灯 工程')
  })

  it('serializeProjectFile 往返一致', () => {
    const config = validConfig()
    const text = serializeProjectFile(config)
    expect(text).toContain('\n  "version": 1')
    expect(expectConfig(text)).toEqual(config)
  })
})

describe('parseProjectFile 容错与错误', () => {
  it('非法 JSON 返回中文错误', () => {
    expect(expectError('{not json')).toContain('JSON')
  })

  it('顶层不是对象', () => {
    expect(expectError('[]')).toContain('JSON 对象')
  })

  it('缺少 version', () => {
    expect(expectError(JSON.stringify({ chip: 'CH32V003F4P6' }))).toContain('version')
  })

  it('不支持的 version', () => {
    expect(expectError(JSON.stringify({ version: 2, chip: 'CH32V003F4P6' }))).toContain('不支持的工程配置版本：2')
  })

  it('缺少 chip', () => {
    expect(expectError(JSON.stringify({ version: 1 }))).toContain('chip')
  })

  it('未知芯片：错误信息包含芯片名', () => {
    const error = expectError(JSON.stringify({ version: 1, chip: 'CH32V999X' }))
    expect(error).toContain('未知芯片')
    expect(error).toContain('CH32V999X')
  })

  it('旧工程缺字段：按 store.loadConfig 的默认值补全', () => {
    const config = expectConfig(JSON.stringify({ version: 1, chip: 'CH32V003F4P6' }))
    expect(config.projectName).toBe('ch32-project')
    expect(config.pins).toEqual([])
    expect(config.groups).toEqual([])
    expect(config.naming).toEqual({ prefix: '' })
    expect(config.clock).toBeUndefined()
    expect(config.peripherals).toEqual({})
    expect(config.features).toEqual({ embassy: false, debugPrint: true })
    expect(config.hal.rev).toBe(HAL_REV)
  })

  it('旧工程 pins 缺 params 时补空对象', () => {
    const config = expectConfig(
      JSON.stringify({
        version: 1,
        chip: 'CH32V203C8T6',
        pins: [{ pin: 'PA0', mode: 'OUTPUT' }],
      }),
    )
    expect(config.pins[0].params).toEqual({})
  })
})

describe('parseProjectFile unlockedPins 校验', () => {
  it('合法字符串数组原样保留', () => {
    const config = expectConfig(
      JSON.stringify({ version: 1, chip: 'CH32V003F4P6', unlockedPins: ['PD7', 'PD1', 'PA1'] }),
    )
    expect(config.unlockedPins).toEqual(['PD7', 'PD1', 'PA1'])
  })

  it('旧工程缺 unlockedPins 时为空数组', () => {
    const config = expectConfig(JSON.stringify({ version: 1, chip: 'CH32V003F4P6' }))
    expect(config.unlockedPins).toEqual([])
  })

  it('非数组值忽略为空数组', () => {
    const config = expectConfig(
      JSON.stringify({ version: 1, chip: 'CH32V003F4P6', unlockedPins: 'PD7' }),
    )
    expect(config.unlockedPins).toEqual([])
  })

  it('数组中的非字符串项被过滤', () => {
    const config = expectConfig(
      JSON.stringify({
        version: 1,
        chip: 'CH32V003F4P6',
        unlockedPins: ['PD7', 42, null, { pin: 'PD1' }, 'PA1'],
      }),
    )
    expect(config.unlockedPins).toEqual(['PD7', 'PA1'])
  })
})