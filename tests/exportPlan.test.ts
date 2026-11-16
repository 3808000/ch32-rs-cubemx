// 目录导出计划纯函数测试：覆盖 create/update/unchanged/delete/conflict 五种动作，
// 以及「只删 generated 组」「用户手改 generated 触发 conflict」等再生成安全网规则。
import { describe, expect, it } from 'vitest'
import type { ExportManifest, FileGroup } from '@/model/types'
import { hashContent } from '@/model/codegen'
import {
  buildExportPlan,
  normalizeRelPath,
  summarizeExportPlan,
  type ExportPlanInputEntry,
} from '@/services/exportPlan'

const GENERATOR = { name: 'ch32-rs-CubeMX-test', version: '0.1.0' }

function entry(path: string, group: FileGroup, data: string | Uint8Array): ExportPlanInputEntry {
  return { path, group, data }
}

/** 构造与给定文件内容一致的 manifest（哈希真实计算）。 */
async function manifestOf(
  entries: { path: string; group: FileGroup; data: string | Uint8Array }[],
): Promise<ExportManifest> {
  return {
    version: 1,
    generator: GENERATOR,
    timestamp: '2026-11-16T00:00:00.000Z',
    configHash: 'test-config-hash',
    files: await Promise.all(
      entries.map(async (e) => ({ path: e.path, group: e.group, sha256: await hashContent(e.data) })),
    ),
  }
}

describe('buildExportPlan', () => {
  it('磁盘无文件 → create', async () => {
    const plan = await buildExportPlan(
      [entry('src/generated/pins.rs', 'generated', 'new pins')],
      null,
      {},
    )
    expect(plan).toEqual([{ path: 'src/generated/pins.rs', group: 'generated', action: 'create' }])
    expect(summarizeExportPlan(plan).create).toBe(1)
  })

  it('磁盘内容与新内容相同 → unchanged（文本）', async () => {
    const data = 'pub fn pins() {}\n'
    const plan = await buildExportPlan(
      [entry('src/generated/pins.rs', 'generated', data)],
      null,
      { 'src/generated/pins.rs': data },
    )
    expect(plan[0].action).toBe('unchanged')
  })

  it('磁盘二进制内容相同 → unchanged（Uint8Array）', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255])
    const plan = await buildExportPlan(
      [entry('vendor/ch32-hal/lib.rs', 'pack', bytes)],
      null,
      { 'vendor/ch32-hal/lib.rs': new Uint8Array([0, 1, 2, 255]) },
    )
    expect(plan[0].action).toBe('unchanged')
  })

  it('manifest 哈希 == 磁盘哈希（用户没改过）→ update', async () => {
    const diskContent = 'old generated'
    const manifest = await manifestOf([
      { path: 'src/generated/clock.rs', group: 'generated', data: diskContent },
    ])
    const plan = await buildExportPlan(
      [entry('src/generated/clock.rs', 'generated', 'new generated')],
      manifest,
      { 'src/generated/clock.rs': diskContent },
    )
    expect(plan).toEqual([{ path: 'src/generated/clock.rs', group: 'generated', action: 'update' }])
  })

  it('用户手改 generated（磁盘哈希 ≠ manifest 哈希）→ conflict，默认 skip', async () => {
    const manifest = await manifestOf([
      { path: 'src/generated/pins.rs', group: 'generated', data: 'generated v1' },
    ])
    const plan = await buildExportPlan(
      [entry('src/generated/pins.rs', 'generated', 'generated v2')],
      manifest,
      { 'src/generated/pins.rs': 'user edited v1' },
    )
    expect(plan).toEqual([
      {
        path: 'src/generated/pins.rs',
        group: 'generated',
        action: 'conflict',
        resolution: 'skip',
      },
    ])
  })

  it('无 manifest 但磁盘已有不同内容 → conflict', async () => {
    const plan = await buildExportPlan(
      [entry('src/generated/usart.rs', 'generated', 'generated')],
      null,
      { 'src/generated/usart.rs': 'existing user file' },
    )
    expect(plan[0].action).toBe('conflict')
    expect(plan[0].resolution).toBe('skip')
  })

  it('manifest 有、本次没有的 generated 文件 → delete', async () => {
    const manifest = await manifestOf([
      { path: 'src/generated/spi.rs', group: 'generated', data: 'spi v1' },
    ])
    const plan = await buildExportPlan(
      [entry('src/generated/pins.rs', 'generated', 'pins')],
      manifest,
      { 'src/generated/spi.rs': 'spi v1', 'src/generated/pins.rs': 'pins' },
    )
    expect(plan).toContainEqual({
      path: 'src/generated/spi.rs',
      group: 'generated',
      action: 'delete',
    })
  })

  it('只删除 generated 组：project_file/user_code/pack 的旧条目保留', async () => {
    const manifest = await manifestOf([
      { path: 'Cargo.toml', group: 'project_file', data: '[package]' },
      { path: 'src/main.rs', group: 'user_code', data: 'fn main() {}' },
      { path: 'vendor/ch32-hal/src/lib.rs', group: 'pack', data: 'hal v1' },
      { path: 'src/generated/dropped.rs', group: 'generated', data: 'generated old' },
    ])
    const plan = await buildExportPlan(
      [entry('src/generated/keep.rs', 'generated', 'keep')],
      manifest,
      {
        'Cargo.toml': '[package]',
        'src/main.rs': 'fn main() {}',
        'vendor/ch32-hal/src/lib.rs': 'hal v1',
        'src/generated/dropped.rs': 'generated old',
      },
    )
    const deletes = plan.filter((e) => e.action === 'delete')
    expect(deletes.map((e) => e.path)).toEqual(['src/generated/dropped.rs'])
    expect(plan.find((e) => e.path === 'Cargo.toml')).toBeUndefined()
    expect(plan.find((e) => e.path === 'src/main.rs')).toBeUndefined()
    expect(plan.find((e) => e.path === 'vendor/ch32-hal/src/lib.rs')).toBeUndefined()
  })

  it('manifest 中存在且本次仍生成的文件不会被 delete', async () => {
    const content = 'same'
    const manifest = await manifestOf([
      { path: 'src/generated/pins.rs', group: 'generated', data: content },
    ])
    const plan = await buildExportPlan(
      [entry('src/generated/pins.rs', 'generated', content)],
      manifest,
      { 'src/generated/pins.rs': content },
    )
    expect(plan).toEqual([
      { path: 'src/generated/pins.rs', group: 'generated', action: 'unchanged' },
    ])
  })

  it('混合场景：summary 正确统计五种动作', async () => {
    const manifest = await manifestOf([
      { path: 'src/generated/update.rs', group: 'generated', data: 'v1' },
      { path: 'src/generated/delete.rs', group: 'generated', data: 'gone' },
      { path: 'README.md', group: 'project_file', data: '# readme' },
    ])
    const plan = await buildExportPlan(
      [
        entry('src/generated/create.rs', 'generated', 'brand new'),
        entry('src/generated/update.rs', 'generated', 'v2'),
        entry('src/generated/same.rs', 'generated', 'same'),
        entry('src/generated/conflict.rs', 'generated', 'generated v2'),
      ],
      manifest,
      {
        'src/generated/update.rs': 'v1',
        'src/generated/same.rs': 'same',
        'src/generated/conflict.rs': 'user content',
        'src/generated/delete.rs': 'gone',
        'README.md': '# readme',
      },
    )
    expect(summarizeExportPlan(plan)).toEqual({
      create: 1,
      update: 1,
      unchanged: 1,
      delete: 1,
      conflict: 1,
    })
  })

  it('路径统一为正斜杠并忽略 ./ 前缀（磁盘与 manifest 两侧都规范化）', async () => {
    const diskContent = 'old'
    const manifest = await manifestOf([
      { path: './src/generated\\clock.rs', group: 'generated', data: diskContent },
    ])
    const plan = await buildExportPlan(
      [entry('.\\src\\generated\\clock.rs', 'generated', 'new')],
      manifest,
      { 'src/generated\\clock.rs': diskContent },
    )
    expect(plan).toEqual([{ path: 'src/generated/clock.rs', group: 'generated', action: 'update' }])
  })

  it('normalizeRelPath 处理反斜杠、./ 与前导 /', () => {
    expect(normalizeRelPath('./src\\generated\\pins.rs')).toBe('src/generated/pins.rs')
    expect(normalizeRelPath('/Cargo.toml')).toBe('Cargo.toml')
  })
})