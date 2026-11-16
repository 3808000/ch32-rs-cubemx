// M1 基座锁定测试：文件组分类 + 导出清单（纯模型层，无 IO）。
import { describe, it, expect } from 'vitest'
import { classifyFileGroup, withFileGroups } from '@/model/codegen/fileGroup'
import {
  MANIFEST_PATH,
  hashContent,
  configHash,
  buildManifest,
  serializeManifest,
  parseManifest,
} from '@/model/codegen/manifest'
import type { ProjectConfig } from '@/model/types'

const cfg: ProjectConfig = {
  version: 1,
  chip: 'CH32V003F4P6',
  projectName: 'demo',
  pins: [],
  naming: { prefix: '' },
  features: { embassy: false, debugPrint: true },
  hal: { rev: 'a0863eb' },
}

describe('classifyFileGroup（按路径归组）', () => {
  it('vendor 前缀 → pack', () => {
    expect(classifyFileGroup('vendor/ch32-hal/src/lib.rs')).toBe('pack')
    expect(classifyFileGroup('vendor/ch32-hal/Cargo.toml')).toBe('pack')
  })
  it('main.rs（单核/双核）→ user_code', () => {
    expect(classifyFileGroup('src/main.rs')).toBe('user_code')
    expect(classifyFileGroup('v3f/src/main.rs')).toBe('user_code')
    expect(classifyFileGroup('core1/src/main.rs')).toBe('user_code')
  })
  it('src/generated → generated', () => {
    expect(classifyFileGroup('src/generated/pins.rs')).toBe('generated')
    expect(classifyFileGroup('v5f/src/generated/mod.rs')).toBe('generated')
  })
  it('骨架/配置/构建文件 → project_file', () => {
    for (const p of [
      'Cargo.toml',
      '.cargo/config.toml',
      'rust-toolchain.toml',
      'build.rs',
      '.gitignore',
      'README.md',
      'cube.json',
      'riscv32ec-unknown-none-elf.json',
      'xtask/src/main.rs', // xtask 是生成的构建工具，归 project_file（非用户代码）
      'memory.x',
      'link.x',
      'v3f/Cargo.toml',
    ]) {
      expect(classifyFileGroup(p)).toBe('project_file')
    }
  })
  it('反斜杠路径归一化', () => {
    expect(classifyFileGroup('src\\generated\\pins.rs')).toBe('generated')
    expect(classifyFileGroup('vendor\\ch32-hal\\lib.rs')).toBe('pack')
  })
  it('withFileGroups 补齐缺省 group、保留已有 group', () => {
    const files = [
      { path: 'src/generated/pins.rs', content: 'x' },
      { path: 'Cargo.toml', content: 'y', group: 'project_file' as const },
      { path: 'src/main.rs', content: 'z' },
    ]
    const out = withFileGroups(files)
    expect(out[0].group).toBe('generated')
    expect(out[1].group).toBe('project_file')
    expect(out[2].group).toBe('user_code')
  })
})

describe('导出清单（manifest）', () => {
  it('MANIFEST_PATH 固定', () => {
    expect(MANIFEST_PATH).toBe('.ch32cube/export-manifest.json')
  })
  it('hashContent 稳定且区分内容', async () => {
    const a = await hashContent('hello')
    const b = await hashContent('hello')
    const c = await hashContent('world')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
  it('hashContent 文本与等价字节一致', async () => {
    const t = await hashContent('abc')
    const u = await hashContent(new TextEncoder().encode('abc'))
    expect(t).toBe(u)
  })
  it('configHash 对同一配置稳定', async () => {
    expect(await configHash(cfg)).toBe(await configHash({ ...cfg }))
  })
  it('buildManifest 组装 + 排序 + 往返', async () => {
    const entries = [
      { path: 'src/generated/pins.rs', group: 'generated' as const, data: 'pins' },
      { path: 'Cargo.toml', group: 'project_file' as const, data: 'cargo' },
      { path: 'vendor/ch32-hal/lib.rs', group: 'pack' as const, data: new Uint8Array([1, 2, 3]) },
    ]
    const m = await buildManifest(entries, cfg, { name: 'ch32-rs-CubeMX', version: '0.1.0' })
    expect(m.version).toBe(1)
    expect(m.generator.name).toBe('ch32-rs-CubeMX')
    expect(m.files.map((f) => f.path)).toEqual([
      'Cargo.toml',
      'src/generated/pins.rs',
      'vendor/ch32-hal/lib.rs',
    ])
    expect(m.configHash).toMatch(/^[0-9a-f]{64}$/)
    const round = parseManifest(serializeManifest(m))
    expect(round).toEqual(m)
  })
  it('parseManifest 对损坏/版本不符返回 null', () => {
    expect(parseManifest('not json')).toBeNull()
    expect(parseManifest(JSON.stringify({ version: 2, files: [] }))).toBeNull()
    expect(parseManifest(JSON.stringify({ version: 1 }))).toBeNull()
  })
})
