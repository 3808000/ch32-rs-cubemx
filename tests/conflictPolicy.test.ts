// M8 类别级冲突策略（对齐 CubeMX2 Automatic Conflict Handling Rules）测试：
// resolveGroupDefaults 三档映射、buildExportPlan 的 groupDefaults 生效、
// planFolderExecution 的「逐文件决议 > 策略默认 > 组默认」优先级与 user_code 硬保护、
// projectFile 对 conflictPolicy 的宽容校验（非法丢弃 / 合法保留 / 旧工程缺省）。
import { describe, expect, it } from 'vitest'
import type {
  ConflictPolicy,
  ExportPlanEntry,
  FileGroup,
  ProjectConfig,
} from '@/model/types'
import { MANIFEST_PATH } from '@/model/codegen'
import {
  buildExportPlan,
  resolveGroupDefaults,
  type ExportPlanInputEntry,
} from '@/services/exportPlan'
import { parseProjectFile, serializeProjectFile } from '@/services/projectFile'
import { planFolderExecution, type PreparedExport } from '@/services/projectExport'

/** 解析成功时取 config；失败直接抛错（与 projectFile.test.ts 一致）。 */
function expectConfig(text: string): ProjectConfig {
  const result = parseProjectFile(text)
  if ('error' in result) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.config
}

function entry(path: string, group: FileGroup, data: string): ExportPlanInputEntry {
  return { path, group, data }
}

/** 构造最小 PreparedExport（planFolderExecution 只读 files/vendorEntries/config）。 */
function preparedOf(files: { path: string; group: FileGroup; content: string }[], config: ProjectConfig): PreparedExport {
  return {
    files: files.map((f) => ({ path: f.path, group: f.group, content: f.content })),
    vendorEntries: [],
    snapshot: {},
    config,
  }
}

const CONFIG: ProjectConfig = {
  version: 1,
  chip: 'CH32V003F4P6',
  projectName: 'policy-demo',
  pins: [],
  naming: { prefix: '' },
  features: { embassy: false, debugPrint: true },
  hal: { rev: 'a0863eb' },
}

function conflictPlan(path: string, group: FileGroup): ExportPlanEntry[] {
  return [{ path, group, action: 'conflict', resolution: 'skip' }]
}

describe('resolveGroupDefaults 三档映射', () => {
  it('缺省策略（undefined）→ 空表，不含 user_code', () => {
    const defaults = resolveGroupDefaults()
    expect(defaults).toEqual({})
    expect(defaults.user_code).toBeUndefined()
  })

  it('safe → 空表（conflict 回退 skip = M1 安全网现状）', () => {
    expect(resolveGroupDefaults({ mode: 'safe' })).toEqual({})
  })

  it('update → generated/project_file/pack 均 overwrite，且不含 user_code', () => {
    const defaults = resolveGroupDefaults({ mode: 'update' })
    expect(defaults).toEqual({
      generated: 'overwrite',
      project_file: 'overwrite',
      pack: 'overwrite',
    })
    expect(defaults.user_code).toBeUndefined()
    expect(Object.keys(defaults)).not.toContain('user_code')
  })

  it('custom 只含显式指定的组（缺省组回退 safe，不出现在表里）', () => {
    const defaults = resolveGroupDefaults({
      mode: 'custom',
      groups: { generated: 'backup' },
    })
    expect(defaults).toEqual({ generated: 'backup' })
    expect(defaults.project_file).toBeUndefined()
    expect(defaults.pack).toBeUndefined()
  })

  it('custom 忽略 groups 里的 user_code（硬保护不参与策略）', () => {
    const defaults = resolveGroupDefaults({
      mode: 'custom',
      groups: { generated: 'skip', user_code: 'overwrite' },
    })
    expect(defaults).toEqual({ generated: 'skip' })
    expect(defaults.user_code).toBeUndefined()
  })

  it('custom 的 base-merge：project_file 保留，generated/pack 降级为 overwrite', () => {
    const defaults = resolveGroupDefaults({
      mode: 'custom',
      groups: { generated: 'base-merge', project_file: 'base-merge', pack: 'base-merge' },
    })
    expect(defaults).toEqual({
      generated: 'overwrite',
      project_file: 'base-merge',
      pack: 'overwrite',
    })
  })

  it('custom 的 skip/backup 原样保留', () => {
    const defaults = resolveGroupDefaults({
      mode: 'custom',
      groups: { generated: 'skip', project_file: 'skip', pack: 'backup' },
    })
    expect(defaults).toEqual({ generated: 'skip', project_file: 'skip', pack: 'backup' })
  })
})

describe('buildExportPlan 的 groupDefaults 生效', () => {
  it('不传 groupDefaults → conflict 默认 resolution=skip（回归）', async () => {
    const plan = await buildExportPlan(
      [entry('src/generated/pins.rs', 'generated', 'generated v2')],
      null,
      { 'src/generated/pins.rs': 'user edited' },
    )
    expect(plan).toEqual([
      { path: 'src/generated/pins.rs', group: 'generated', action: 'conflict', resolution: 'skip' },
    ])
  })

  it('groupDefaults.generated=overwrite → conflict 条目默认覆盖', async () => {
    const plan = await buildExportPlan(
      [entry('src/generated/pins.rs', 'generated', 'generated v2')],
      null,
      { 'src/generated/pins.rs': 'user edited' },
      { generated: 'overwrite' },
    )
    expect(plan[0].resolution).toBe('overwrite')
  })

  it('groupDefaults 只作用于对应组：pack 默认不影响 generated 冲突', async () => {
    const plan = await buildExportPlan(
      [entry('src/generated/pins.rs', 'generated', 'generated v2')],
      null,
      { 'src/generated/pins.rs': 'user edited' },
      { pack: 'overwrite', project_file: 'backup' },
    )
    expect(plan[0].resolution).toBe('skip')
  })

  it('create/update/unchanged 条目不因 groupDefaults 改变（无 resolution 字段）', async () => {
    const disk = { 'src/generated/new.rs': 'same' }
    const plan = await buildExportPlan(
      [
        entry('src/generated/brand-new.rs', 'generated', 'new'),
        entry('src/generated/new.rs', 'generated', 'same'),
      ],
      null,
      disk,
      { generated: 'overwrite' },
    )
    expect(plan.map((e) => e.action)).toEqual(['create', 'unchanged'])
    for (const item of plan) expect(item.resolution).toBeUndefined()
  })

  it('空表 groupDefaults 与不传完全等价', async () => {
    const input = [entry('src/generated/pins.rs', 'generated', 'generated v2')]
    const disk = { 'src/generated/pins.rs': 'user edited' }
    const withoutArg = await buildExportPlan(input, null, disk)
    const withEmpty = await buildExportPlan(input, null, disk, {})
    expect(withEmpty).toEqual(withoutArg)
  })
})

describe('planFolderExecution：逐文件决议 > 策略默认 > 组默认', () => {
  it('逐文件 resolutions 优先于 groupDefaults（generated conflict 选 skip 不写盘）', async () => {
    const prepared = preparedOf(
      [{ path: 'src/generated/pins.rs', group: 'generated', content: 'generated v2' }],
      CONFIG,
    )
    const execution = await planFolderExecution(
      prepared,
      conflictPlan('src/generated/pins.rs', 'generated'),
      { 'src/generated/pins.rs': 'user edited' },
      null,
      { 'src/generated/pins.rs': 'skip' },
      { generated: 'overwrite' },
    )
    expect(execution.written).toBe(0)
    expect(execution.skipped).toBe(1)
    expect(execution.writes.map((w) => w.path)).toEqual([MANIFEST_PATH])
  })

  it('update 档下 generated conflict 默认覆盖（无逐文件决议）', async () => {
    const prepared = preparedOf(
      [{ path: 'src/generated/pins.rs', group: 'generated', content: 'generated v2' }],
      CONFIG,
    )
    const execution = await planFolderExecution(
      prepared,
      conflictPlan('src/generated/pins.rs', 'generated'),
      { 'src/generated/pins.rs': 'user edited' },
      null,
      undefined,
      { generated: 'overwrite' },
    )
    expect(execution.written).toBe(1)
    expect(execution.writes.find((w) => w.path === 'src/generated/pins.rs')?.data).toBe('generated v2')
  })

  it('user_code 硬保护：即使显式 resolutions/groupDefaults 要求覆盖也 skip', async () => {
    const prepared = preparedOf([{ path: 'src/main.rs', group: 'user_code', content: 'generated main' }], CONFIG)
    const execution = await planFolderExecution(
      prepared,
      conflictPlan('src/main.rs', 'user_code'),
      { 'src/main.rs': 'user main' },
      null,
      { 'src/main.rs': 'overwrite' },
      { user_code: 'overwrite' },
    )
    expect(execution.written).toBe(0)
    expect(execution.skipped).toBe(1)
    expect(execution.writes.map((w) => w.path)).toEqual([MANIFEST_PATH])
  })

  it('不传 groupDefaults 时 Cargo.toml conflict 仍默认标记区合并（M1 等价）', async () => {
    const prepared = preparedOf([{ path: 'Cargo.toml', group: 'project_file', content: '[package]\nnew = 1' }], CONFIG)
    const execution = await planFolderExecution(
      prepared,
      conflictPlan('Cargo.toml', 'project_file'),
      { 'Cargo.toml': '[package]\nold = 1' },
      null,
      undefined,
      undefined,
    )
    // 无标记区时 mergeCargoToml 保守返回原文件 → 跳过
    expect(execution.written).toBe(0)
    expect(execution.skipped).toBe(1)
  })

  it('update 档下 Cargo.toml conflict 默认覆盖（策略优先于标记区合并）', async () => {
    const prepared = preparedOf([{ path: 'Cargo.toml', group: 'project_file', content: '[package]\nnew = 1' }], CONFIG)
    const execution = await planFolderExecution(
      prepared,
      conflictPlan('Cargo.toml', 'project_file'),
      { 'Cargo.toml': '[package]\nold = 1' },
      null,
      undefined,
      { project_file: 'overwrite' },
    )
    expect(execution.written).toBe(1)
    expect(execution.writes.find((w) => w.path === 'Cargo.toml')?.data).toBe('[package]\nnew = 1')
  })
})

describe('parseProjectFile 的 conflictPolicy 宽容校验', () => {
  it('合法策略原样保留（含合法 groups）', () => {
    const config = expectConfig(
      JSON.stringify({
        version: 1,
        chip: 'CH32V003F4P6',
        conflictPolicy: {
          mode: 'custom',
          groups: { generated: 'overwrite', project_file: 'base-merge', user_code: 'skip' },
        },
      }),
    )
    expect(config.conflictPolicy).toEqual({
      mode: 'custom',
      groups: { generated: 'overwrite', project_file: 'base-merge', user_code: 'skip' },
    })
  })

  it('mode 非法 → 丢弃整个字段（顶层未知字段仍保留）', () => {
    const config = expectConfig(
      JSON.stringify({
        version: 1,
        chip: 'CH32V003F4P6',
        conflictPolicy: { mode: 'aggressive', groups: { generated: 'overwrite' } },
        futureField: 'kept',
      }),
    )
    expect(config).not.toHaveProperty('conflictPolicy')
    expect((config as unknown as Record<string, unknown>).futureField).toBe('kept')
  })

  it('groups 只接受已知 FileGroup key 与已知 resolution value', () => {
    const config = expectConfig(
      JSON.stringify({
        version: 1,
        chip: 'CH32V003F4P6',
        conflictPolicy: {
          mode: 'custom',
          groups: {
            generated: 'overwrite',
            pack: 'nuke', // 非法 value
            mystery_group: 'skip', // 非法 key
            project_file: 'base-merge',
            42: 'skip', // 非法 key 类型
          },
        },
      }),
    )
    expect(config.conflictPolicy).toEqual({
      mode: 'custom',
      groups: { generated: 'overwrite', project_file: 'base-merge' },
    })
  })

  it('groups 全部非法时保留 mode、省略 groups', () => {
    const config = expectConfig(
      JSON.stringify({
        version: 1,
        chip: 'CH32V003F4P6',
        conflictPolicy: { mode: 'update', groups: { pack: 'bogus' } },
      }),
    )
    expect(config.conflictPolicy).toEqual({ mode: 'update' })
  })

  it('conflictPolicy 非对象 → 丢弃字段', () => {
    const config = expectConfig(
      JSON.stringify({ version: 1, chip: 'CH32V003F4P6', conflictPolicy: 'update' }),
    )
    expect(config).not.toHaveProperty('conflictPolicy')
  })

  it('旧工程无 conflictPolicy → 属性不存在（缺省 safe）', () => {
    const config = expectConfig(JSON.stringify({ version: 1, chip: 'CH32V003F4P6' }))
    expect(config).not.toHaveProperty('conflictPolicy')
  })

  it('合法策略经 serialize/parse 往返一致', () => {
    const config = expectConfig(
      JSON.stringify({
        version: 1,
        chip: 'CH32V003F4P6',
        conflictPolicy: { mode: 'update' },
      }),
    )
    const roundTrip = expectConfig(serializeProjectFile(config))
    expect(roundTrip.conflictPolicy).toEqual({ mode: 'update' })
  })
})

describe('ConflictPolicy 类型契约（编译期 + 运行期形状）', () => {
  it('safe/update 不带 groups 也是合法策略', () => {
    const policies: ConflictPolicy[] = [{ mode: 'safe' }, { mode: 'update' }]
    for (const p of policies) expect(resolveGroupDefaults(p)).toBeTypeOf('object')
  })
})
