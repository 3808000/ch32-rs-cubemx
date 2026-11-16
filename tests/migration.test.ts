// cube.json 迁移基础设施（M4.6）：未知字段保留 / generator 往返 / 未来版本拒绝 / 缺字段宽容。
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '@/model/types'
import {
  CONFIG_VERSION,
  MIGRATIONS,
  migrateConfig,
  parseProjectFile,
  serializeProjectFile,
  type ConfigMigration,
} from '@/services/projectFile'
import { HAL_REV } from '@/model/codegen/halRev'

function expectConfig(text: string): ProjectConfig {
  const result = parseProjectFile(text)
  if ('error' in result) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.config
}

function expectError(text: string): string {
  const result = parseProjectFile(text)
  if ('config' in result) throw new Error('期望解析失败，实际成功')
  return result.error
}

describe('未知字段保留', () => {
  it('顶层未知字段在解析后仍存在', () => {
    const config = expectConfig(
      JSON.stringify({
        version: 1,
        chip: 'CH32V003F4P6',
        futureFeature: { mode: 'turbo', levels: [1, 2, 3] },
        experimental: 'keep-me',
      }),
    ) as ProjectConfig & Record<string, unknown>
    expect(config.futureFeature).toEqual({ mode: 'turbo', levels: [1, 2, 3] })
    expect(config.experimental).toBe('keep-me')
  })

  it('引脚对象内的未知字段也保留（未来引脚参数不丢）', () => {
    const config = expectConfig(
      JSON.stringify({
        version: 1,
        chip: 'CH32V003F4P6',
        pins: [{ pin: 'PD6', mode: 'OUTPUT', params: {}, futureParam: { drive: 'strong' } }],
      }),
    )
    expect((config.pins[0] as unknown as Record<string, unknown>).futureParam).toEqual({ drive: 'strong' })
    expect(config.pins[0].params).toEqual({})
  })

  it('未知 DMA 字段（parse 未显式处理）通过展开保留', () => {
    const dma = [{ peripheral: 'USART1', channel: 4, request: 3, futureField: true }]
    const config = expectConfig(JSON.stringify({ version: 1, chip: 'CH32V003F4P6', dma }))
    expect(config.dma).toEqual(dma)
  })

  it('非法 interrupts 不因展开而泄漏（保持宽容过滤）', () => {
    const config = expectConfig(
      JSON.stringify({ version: 1, chip: 'CH32V003F4P6', interrupts: 'not-an-array' }),
    )
    expect(config.interrupts).toBeUndefined()
  })
})

describe('generator 字段', () => {
  it('serializeProjectFile 写入 generator', () => {
    const config: ProjectConfig = {
      version: 1,
      chip: 'CH32V003F4P6',
      projectName: 'gen-demo',
      pins: [],
      naming: { prefix: '' },
      features: { embassy: false, debugPrint: true },
      hal: { rev: HAL_REV },
      generator: { name: 'ch32-rs-CubeMX', version: '0.1.0' },
    }
    const text = serializeProjectFile(config)
    expect(text).toContain('"generator"')
    expect(text).toContain('"name": "ch32-rs-CubeMX"')
    expect(text).toContain('"version": "0.1.0"')
  })

  it('解析 generator 并在往返后保持一致', () => {
    const text = JSON.stringify({
      version: 1,
      chip: 'CH32V003F4P6',
      generator: { name: 'ch32-rs-CubeMX', version: '9.9.9' },
    })
    const config = expectConfig(text)
    expect(config.generator).toEqual({ name: 'ch32-rs-CubeMX', version: '9.9.9' })
    expect(expectConfig(serializeProjectFile(config))).toEqual(config)
  })

  it('generator 缺 name/version 时忽略（不让坏值进入强类型字段）', () => {
    const config = expectConfig(
      JSON.stringify({ version: 1, chip: 'CH32V003F4P6', generator: { name: 'x' } }),
    )
    expect(config.generator).toBeUndefined()
  })
})

describe('版本迁移链', () => {
  it('当前版本无迁移，migrateConfig 原样通过（返回副本）', () => {
    const raw = { version: CONFIG_VERSION, chip: 'CH32V003F4P6', extra: 1 }
    const result = migrateConfig(raw)
    expect('raw' in result).toBe(true)
    if (!('raw' in result)) return
    expect(result.raw).toEqual(raw)
    expect(result.raw).not.toBe(raw)
  })

  it('逐级调用 MIGRATIONS（用自定义链验证 1→2→3 通路）', () => {
    const migrations: Record<number, ConfigMigration> = {
      1: (raw) => ({ ...raw, step1: true }),
      2: (raw) => ({ ...raw, step2: true }),
    }
    const result = migrateConfig({ version: 1, chip: 'CH32V003F4P6' }, migrations, 3)
    expect('raw' in result).toBe(true)
    if (!('raw' in result)) return
    expect(result.raw.version).toBe(3)
    expect(result.raw.step1).toBe(true)
    expect(result.raw.step2).toBe(true)
  })

  it('迁移链缺失时明确报错', () => {
    const result = migrateConfig({ version: 1 }, {}, 2)
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toContain('迁移链缺失')
  })

  it('MIGRATIONS 已导出且当前为空（升版前先建通路）', () => {
    expect(MIGRATIONS).toEqual({})
  })
})

describe('未来版本与缺字段', () => {
  it('version > 当前 → 拒绝且提示原文件未修改', () => {
    const error = expectError(JSON.stringify({ version: 2, chip: 'CH32V003F4P6', future: true }))
    expect(error).toContain('不支持的工程配置版本：2')
    expect(error).toContain('原文件未修改')
  })

  it('version 缺失/非法 → 明确拒绝', () => {
    expect(expectError(JSON.stringify({ chip: 'CH32V003F4P6' }))).toContain('缺少 version')
    expect(expectError(JSON.stringify({ version: 0, chip: 'CH32V003F4P6' }))).toContain('version 必须为正整数')
    expect(expectError(JSON.stringify({ version: '1', chip: 'CH32V003F4P6' }))).toContain('version 必须为正整数')
  })

  it('缺字段旧工程仍按默认值宽容导入（迁移通路上不回归）', () => {
    const config = expectConfig(JSON.stringify({ version: 1, chip: 'CH32V003F4P6' }))
    expect(config.projectName).toBe('ch32-project')
    expect(config.pins).toEqual([])
    expect(config.groups).toEqual([])
    expect(config.naming).toEqual({ prefix: '' })
    expect(config.peripherals).toEqual({})
    expect(config.features).toEqual({ embassy: false, debugPrint: true })
    expect(config.hal.rev).toBe(HAL_REV)
    expect(config.generator).toBeUndefined()
  })
})