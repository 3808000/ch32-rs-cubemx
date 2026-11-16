// 工具链档位（M4.4）：Cargo.toml profile / .cargo/config.toml alias / IDE 默认档位。
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '@/model/types'
import { DEFAULT_SELECTION } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { generateProject } from '@/model/codegen'
import { GENERATED_END_MARKER, GENERATED_START_MARKER } from '@/services/tomlMerge'

const data = getDeviceData('CH32V003F4P6')

function config(over: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V003F4P6',
    projectName: 'profile-demo',
    pins: [],
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: false },
    hal: { rev: 'a0863ebcc1082f64e508b73d3b944f119b0db77b' },
    ...over,
  }
}

function fileOf(path: string, selection: Parameters<typeof generateProject>[2] = {}): string {
  const r = generateProject(config(), data, selection)
  expect(r.errors).toEqual([])
  const file = r.files.find((f) => f.path === path)
  if (!file) throw new Error(`缺少生成文件：${path}`)
  return file.content
}

describe('Cargo.toml 构建档位', () => {
  it('三个自定义 profile 均生成且位于标记区内', () => {
    const cargo = fileOf('Cargo.toml')
    const start = cargo.indexOf(GENERATED_START_MARKER)
    const end = cargo.indexOf(GENERATED_END_MARKER)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    for (const section of ['[profile.release-size]', '[profile.release-speed]', '[profile.release-debug]']) {
      const idx = cargo.indexOf(section)
      expect(idx).toBeGreaterThan(start)
      expect(idx).toBeLessThan(end)
    }
  })

  it('release-size：opt-level=z + lto=fat + strip=symbols', () => {
    const cargo = fileOf('Cargo.toml')
    const size = cargo.slice(cargo.indexOf('[profile.release-size]'), cargo.indexOf('[profile.release-speed]'))
    // cargo 强制自定义 profile 提供 inherits
    expect(size).toContain("inherits = 'release'")
    expect(size).toContain("opt-level = 'z'")
    expect(size).toContain("lto = 'fat'")
    expect(size).toContain("strip = 'symbols'")
  })

  it('release-speed = opt-level 3；release-debug = debug 2 + opt-level s', () => {
    const cargo = fileOf('Cargo.toml')
    const speed = cargo.slice(cargo.indexOf('[profile.release-speed]'), cargo.indexOf('[profile.release-debug]'))
    expect(speed).toContain("inherits = 'release'")
    expect(speed).toContain('opt-level = 3')
    const debug = cargo.slice(cargo.indexOf('[profile.release-debug]'))
    expect(debug).toContain("inherits = 'release'")
    expect(debug).toContain('debug = 2')
    expect(debug).toContain("opt-level = 's'")
  })

  it('默认 [profile.release] 保持原行为（opt-level=s / lto=fat / strip=false）', () => {
    const cargo = fileOf('Cargo.toml')
    const release = cargo.slice(cargo.indexOf('[profile.release]'), cargo.indexOf('[profile.release-size]'))
    expect(release).toContain("opt-level = 's'")
    expect(release).toContain("lto = 'fat'")
    expect(release).toContain('strip = false')
    expect(release).toContain('debug = 2')
  })
})

describe('.cargo/config.toml 档位别名', () => {
  it('生成 build-size / build-speed / build-debug 三个 alias', () => {
    const cargoConfig = fileOf('.cargo/config.toml')
    expect(cargoConfig).toContain('[alias]')
    expect(cargoConfig).toContain('build-size = "build --profile release-size"')
    expect(cargoConfig).toContain('build-speed = "build --profile release-speed"')
    expect(cargoConfig).toContain('build-debug = "build --profile release-debug"')
  })
})

describe('CodegenSelection 档位默认值', () => {
  it('默认 profile=release-size / ideConfig=none（保持既有生成结果）', () => {
    expect(DEFAULT_SELECTION.profile).toBe('release-size')
    expect(DEFAULT_SELECTION.ideConfig).toBe('none')
  })

  it('IDE tasks.json 默认构建任务跟随 selection.profile', () => {
    const tasksRaw = fileOf('.vscode/tasks.json', { ideConfig: 'vscode', profile: 'release-speed' })
    const tasks = (JSON.parse(tasksRaw) as { tasks: { label: string; args: string[]; group?: { isDefault: boolean } }[] })
      .tasks
    const defaultTask = tasks.find((t) => t.group?.isDefault)
    expect(defaultTask?.label).toBe('构建 (release-speed)')
    expect(defaultTask?.args).toEqual(['build-speed'])
    // 其余档位仍可从任务列表选择
    expect(tasks.map((t) => t.label)).toContain('构建 (release-size)')
    expect(tasks.map((t) => t.label)).toContain('构建 (release-debug)')
  })
})