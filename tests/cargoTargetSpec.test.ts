// M14 D7：自定义 target JSON（chip.targetSpec）的骨架生成。
// 覆盖：V307 风格 targetSpec → <target>.json + .cargo/config.toml（build target 带 .json、表名不带）+ unstable；
//       V003 旧路径（无 targetSpec）输出逐字节不变。
import { describe, expect, it } from 'vitest'
import type { DeviceData, ProjectConfig } from '@/model/types'
import { DEFAULT_SELECTION } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { renderSkeletonFiles } from '@/model/codegen/cargo'
import { TARGET_RISCV32EC_TPL } from '@/model/codegen/templates'

const HAL_REV = 'a0863ebcc1082f64e508b73d3b944f119b0db77b'
const V307_TARGET = 'riscv32imfc-unknown-none-elf'

/** 逐字取自 ch32-hal examples/ch32v307/riscv32imfc-unknown-none-elf.json（R1 §3.2）。 */
const V307_TARGET_SPEC: Record<string, unknown> = {
  abi: 'ilp32f',
  arch: 'riscv32',
  'atomic-cas': false,
  cpu: 'generic-rv32',
  'crt-objects-fallback': 'false',
  'data-layout': 'e-m:e-p:32:32-i64:64-n32-S128',
  'eh-frame-header': false,
  'emit-debug-gdb-scripts': false,
  features: '+m,+f,+c,+forced-atomics,+xwchc',
  linker: 'rust-lld',
  'linker-flavor': 'gnu-lld',
  'llvm-abiname': 'ilp32f',
  'llvm-target': 'riscv32',
  'max-atomic-width': 32,
  'panic-strategy': 'abort',
  'relocation-model': 'static',
  'target-pointer-width': 32,
}

function config(): ProjectConfig {
  return {
    version: 1,
    chip: 'CH32V307VCT6',
    projectName: 'target-spec-demo',
    pins: [],
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: false },
    hal: { rev: HAL_REV },
  }
}

/** 以 V003 数据为底，替换 target/nightly/targetSpec（不依赖新芯片数据是否就绪）。 */
function chipWithTargetSpec(spec: Record<string, unknown> | undefined, nightly = true): DeviceData {
  const data = structuredClone(getDeviceData('CH32V003F4P6')) as DeviceData
  data.chip.chip = 'CH32V307VCT6'
  data.chip.target = spec ? V307_TARGET : 'riscv32ec-unknown-none-elf'
  data.chip.nightly = nightly
  if (spec) data.chip.targetSpec = spec
  else delete data.chip.targetSpec
  return data
}

function fileMap(data: DeviceData): Record<string, string> {
  const files = renderSkeletonFiles(config(), data, DEFAULT_SELECTION, false)
  return Object.fromEntries(files.map((f) => [f.path, f.content]))
}

describe('chip.targetSpec：自定义 target JSON（M14 / V307）', () => {
  const files = fileMap(chipWithTargetSpec(V307_TARGET_SPEC))

  it('输出 <target>.json，内容 = 数据 spec（JSON.stringify 2 空格 + 末尾换行）', () => {
    expect(files[`${V307_TARGET}.json`]).toBe(`${JSON.stringify(V307_TARGET_SPEC, null, 2)}\n`)
    expect(files['riscv32ec-unknown-none-elf.json']).toBeUndefined()
  })

  it('解析后的 JSON 与 spec 完全一致（含 ilp32f / +xwchc / atomic-cas=false）', () => {
    const parsed = JSON.parse(files[`${V307_TARGET}.json`]) as Record<string, unknown>
    expect(parsed).toEqual(V307_TARGET_SPEC)
    expect(parsed.abi).toBe('ilp32f')
    expect(parsed.features).toBe('+m,+f,+c,+forced-atomics,+xwchc')
    expect(parsed['atomic-cas']).toBe(false)
  })

  it('.cargo/config.toml：[build] target 带 .json，[target.X] 表名不带 .json', () => {
    const cfg = files['.cargo/config.toml']
    expect(cfg).toContain(`target = "${V307_TARGET}.json"`)
    expect(cfg).toContain(`[target."${V307_TARGET}"]`)
    expect(cfg).not.toContain(`[target."${V307_TARGET}.json"]`)
    expect(cfg).not.toContain('riscv32ec')
  })

  it('.cargo/config.toml 含 HAL example 同款 unstable 段', () => {
    const cfg = files['.cargo/config.toml']
    expect(cfg).toContain('[unstable]')
    expect(cfg).toContain('build-std = ["core"]')
    expect(cfg).toContain('json-target-spec = true')
  })

  it('rust-toolchain.toml：nightly + rust-src（不写 targets 列表）', () => {
    const tc = files['rust-toolchain.toml']
    expect(tc).toContain('channel = "nightly"')
    expect(tc).toContain('components = ["rust-src"]')
    expect(tc).not.toContain('targets =')
  })

  it('nightly=false：targetSpec 不触发 jsonTarget（stable 内建 target）', () => {
    const stable = fileMap(chipWithTargetSpec(V307_TARGET_SPEC, false))
    expect(stable[`${V307_TARGET}.json`]).toBeUndefined()
    expect(stable['.cargo/config.toml']).toContain(`target = "${V307_TARGET}"`)
    expect(stable['.cargo/config.toml']).not.toContain('[unstable]')
    expect(stable['rust-toolchain.toml']).toContain('channel = "stable"')
  })
})

describe('V003 旧路径回归（无 targetSpec，输出逐字节不变）', () => {
  const files = fileMap(getDeviceData('CH32V003F4P6'))

  it('仍输出 riscv32ec-unknown-none-elf.json，内容 = 内置模板', () => {
    expect(files['riscv32ec-unknown-none-elf.json']).toBe(TARGET_RISCV32EC_TPL)
  })

  it('.cargo/config.toml 与旧行为一致', () => {
    const cfg = files['.cargo/config.toml']
    expect(cfg).toContain('target = "riscv32ec-unknown-none-elf.json"')
    expect(cfg).toContain('[target."riscv32ec-unknown-none-elf"]')
    expect(cfg).toContain('build-std = ["core"]')
    expect(cfg).toContain('json-target-spec = true')
  })

  it('rust-toolchain.toml 仍为 nightly + rust-src', () => {
    const tc = files['rust-toolchain.toml']
    expect(tc).toContain('channel = "nightly"')
    expect(tc).toContain('components = ["rust-src"]')
  })
})
