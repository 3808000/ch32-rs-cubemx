// M10：VSCode 调试配置（launch.json + gdbserver 任务）生成与实机核实常量一致性。
// 后端：ch32rv 0.31.3 `ch32rv gdb`（localhost:3333）；wlink 0.1.3 无 gdbserver（源码/CLI 核实）。
import { describe, expect, it } from 'vitest'
import type { CodegenSelection, ProjectConfig } from '@/model/types'
import { DEFAULT_SELECTION } from '@/model/types'
import { getDeviceData } from '@/model/device'
import { generateProject } from '@/model/codegen'
import { renderIdeConfigFiles } from '@/model/codegen/ideConfig'
import { renderIdeConfigFiles as renderCh58xIdeConfigFiles } from '@/model/codegen/ch58x/ide'
import {
  CH32RV_DEBUG_CONFIG_NAME,
  CH32RV_GDB_DEBUGGER_PATH,
  CH32RV_GDB_SERVER_ADDRESS,
  CH32RV_GDB_TASK_ARGS,
  CH32RV_GDB_TASK_LABEL,
  CH32RV_FLASH_TASK_LABEL,
  DUAL_CORE_DEBUG_TASK_LABEL,
  SINGLE_CORE_DEBUG_TASK_LABEL,
  VSCODE_DEBUG_NOTE,
} from '@/model/codegen/templates/ideConfig'
import {
  CH58X_BUILD_TASK_LABEL,
  CH58X_DEBUG_BUILD_TASK_LABEL,
  CH58X_DEBUG_CONFIG_NAME,
  CH58X_GDB_DEBUGGER_PATH,
  CH58X_GDB_SERVER_ADDRESS,
  CH58X_GDB_SERVER_TASK_LABEL,
  CH58X_MRS_FLASH_TASK_LABEL,
  CH58X_MRS_OPENOCD_CFG_ENV,
  CH58X_MRS_OPENOCD_CMD,
  CH58X_WCHISP_FLASH_TASK_LABEL,
} from '@/model/codegen/ch58x/templates/ideConfig'

const v003 = getDeviceData('CH32V003F4P6')
const v203 = getDeviceData('CH32V203C8T6')
const h417 = getDeviceData('CH32H417QEU6')
const ch582 = getDeviceData('CH582M')

interface TaskFile {
  version: string
  tasks: {
    label: string
    type?: string
    command?: string
    args?: string[]
    isBackground?: boolean
    group?: { kind: string; isDefault?: boolean }
  }[]
}

interface LaunchFile {
  version: string
  configurations: Record<string, unknown>[]
}

function config(chip: string, projectName: string): ProjectConfig {
  return {
    version: 1,
    chip,
    projectName,
    pins: [],
    naming: { prefix: '' },
    features: { embassy: false, debugPrint: false },
    hal: { rev: 'a0863ebcc1082f64e508b73d3b944f119b0db77b' },
  }
}

function ideFiles(
  chipData: typeof v003,
  projectName: string,
  selection: Partial<CodegenSelection> = {},
): Record<string, string> {
  const files = renderIdeConfigFiles(config(chipData.chip.chip, projectName), chipData, {
    ...DEFAULT_SELECTION,
    ideConfig: 'vscode',
    ...selection,
  })
  return Object.fromEntries(files.map((f) => [f.path, f.content]))
}

function launchOf(files: Record<string, string>): LaunchFile {
  const raw = files['.vscode/launch.json']
  expect(raw, '缺少 .vscode/launch.json').toBeDefined()
  return JSON.parse(raw) as LaunchFile
}

function tasksOf(files: Record<string, string>): TaskFile {
  return JSON.parse(files['.vscode/tasks.json']) as TaskFile
}

describe('IDE 配置档位', () => {
  it('ideConfig=none / 未设置时不生成任何 .vscode 文件', () => {
    expect(renderIdeConfigFiles(config('CH32V003F4P6', 'none-demo'), v003, DEFAULT_SELECTION)).toEqual([])
    expect(
      renderIdeConfigFiles(config('CH32V003F4P6', 'none-demo'), v003, { ...DEFAULT_SELECTION, ideConfig: 'none' }),
    ).toEqual([])
  })

  it('vscode 档生成 settings/tasks/launch 三件套', () => {
    const files = ideFiles(v003, 'v003-ide')
    expect(Object.keys(files).sort()).toEqual([
      '.vscode/launch.json',
      '.vscode/settings.json',
      '.vscode/tasks.json',
    ])
    expect(files['.vscode/settings.json']).toContain('"rust-analyzer.cargo.target": "riscv32ec-unknown-none-elf.json"')
  })
})

describe('launch.json（cppdbg + ch32rv gdbserver）', () => {
  it('version/configurations 结构合法，仅一条配置', () => {
    const launch = launchOf(ideFiles(v003, 'v003-ide'))
    expect(launch.version).toBe('0.2.0')
    expect(launch.configurations).toHaveLength(1)
  })

  it('type=cppdbg / request=attach / 配置名与常量一致', () => {
    const cfg = launchOf(ideFiles(v003, 'v003-ide')).configurations[0]
    expect(cfg.type).toBe('cppdbg')
    expect(cfg.request).toBe('attach')
    expect(cfg.name).toBe(CH32RV_DEBUG_CONFIG_NAME)
    expect(cfg.name).toBe('Debug (ch32rv gdbserver)')
  })

  it('miDebuggerServerAddress 与实机核实端口一致（localhost:3333）', () => {
    const cfg = launchOf(ideFiles(v003, 'v003-ide')).configurations[0]
    expect(cfg.miDebuggerServerAddress).toBe(CH32RV_GDB_SERVER_ADDRESS)
    expect(cfg.miDebuggerServerAddress).toBe('localhost:3333')
  })

  it('GDB 路径 / MIMode / cwd / runToEntryPoint 为标准值', () => {
    const cfg = launchOf(ideFiles(v003, 'v003-ide')).configurations[0]
    expect(cfg.miDebuggerPath).toBe(CH32RV_GDB_DEBUGGER_PATH)
    expect(cfg.miDebuggerPath).toBe('riscv-none-elf-gdb')
    expect(cfg.MIMode).toBe('gdb')
    expect(cfg.cwd).toBe('${workspaceFolder}')
    expect(cfg.runToEntryPoint).toBe('main')
  })

  it('单核 V003 program 指向 target/<target>/release-debug/<package>（Cargo 无 .elf 后缀）', () => {
    const cfg = launchOf(ideFiles(v003, 'V003-IDE')).configurations[0]
    expect(cfg.program).toBe('${workspaceFolder}/target/riscv32ec-unknown-none-elf/release-debug/v003-ide')
  })

  it('单核 V203 program 使用该芯片 target（riscv32imac）', () => {
    const cfg = launchOf(ideFiles(v203, 'v203-ide')).configurations[0]
    expect(cfg.program).toBe('${workspaceFolder}/target/riscv32imac-unknown-none-elf/release-debug/v203-ide')
  })

  it('单核 preLaunchTask = 「构建 (release-debug)」且该任务确实存在于 tasks.json', () => {
    const files = ideFiles(v003, 'v003-ide')
    const cfg = launchOf(files).configurations[0]
    expect(cfg.preLaunchTask).toBe(SINGLE_CORE_DEBUG_TASK_LABEL)
    expect(tasksOf(files).tasks.map((t) => t.label)).toContain(SINGLE_CORE_DEBUG_TASK_LABEL)
  })

  it('双核 H417：program 指向主核 crate 的 release 产物，preLaunchTask = xtask: 构建', () => {
    const files = ideFiles(h417, 'h417-ide')
    const cfg = launchOf(files).configurations[0]
    expect(cfg.program).toBe('${workspaceFolder}/target/riscv32imafc-unknown-none-elf/release/h417-ide-v3f')
    expect(cfg.preLaunchTask).toBe(DUAL_CORE_DEBUG_TASK_LABEL)
    expect(tasksOf(files).tasks.map((t) => t.label)).toContain(DUAL_CORE_DEBUG_TASK_LABEL)
  })

  it('不写 postRemoteConnectCommands / monitor / load（ch32rv 无 vFlash 与 monitor）', () => {
    const launch = launchOf(ideFiles(v003, 'v003-ide'))
    const cfg = launch.configurations[0]
    expect(cfg).not.toHaveProperty('postRemoteConnectCommands')
    const raw = JSON.stringify(launch)
    expect(raw).not.toContain('monitor reset halt')
    expect(raw).not.toContain('"load"')
  })

  it('生成结果确定性：同输入两次逐字节一致', () => {
    const a = renderIdeConfigFiles(config('CH32V003F4P6', 'v003-ide'), v003, {
      ...DEFAULT_SELECTION,
      ideConfig: 'vscode',
    })
    const b = renderIdeConfigFiles(config('CH32V003F4P6', 'v003-ide'), v003, {
      ...DEFAULT_SELECTION,
      ideConfig: 'vscode',
    })
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('JSON 可解析（settings/tasks/launch 均为严格 JSON）', () => {
    const files = ideFiles(v003, 'v003-ide')
    for (const path of ['.vscode/settings.json', '.vscode/tasks.json', '.vscode/launch.json']) {
      expect(() => JSON.parse(files[path])).not.toThrow()
    }
  })
})

describe('tasks.json gdbserver / ch32rv 烧录任务', () => {
  it('单核与双核均追加 gdbserver (ch32rv) 常驻任务', () => {
    for (const [data, name] of [
      [v003, 'v003-ide'],
      [h417, 'h417-ide'],
    ] as const) {
      const tasks = tasksOf(ideFiles(data, name)).tasks
      const gdb = tasks.find((t) => t.label === CH32RV_GDB_TASK_LABEL)
      expect(gdb, '缺少 gdbserver 任务').toBeDefined()
      expect(gdb?.command).toBe('ch32rv')
      expect(gdb?.args).toEqual(CH32RV_GDB_TASK_ARGS)
      expect(gdb?.args).toEqual(['gdb', '--reset-halt'])
      expect(gdb?.isBackground).toBe(true)
    }
  })

  it('单核追加 ch32rv flash 任务，参数指向 release-debug 产物', () => {
    const tasks = tasksOf(ideFiles(v003, 'v003-ide')).tasks
    const flash = tasks.find((t) => t.label === CH32RV_FLASH_TASK_LABEL)
    expect(flash, '缺少 ch32rv 烧录任务').toBeDefined()
    expect(flash?.command).toBe('ch32rv')
    expect(flash?.args).toEqual(['flash', 'target/riscv32ec-unknown-none-elf/release-debug/v003-ide'])
  })

  it('任务 label 唯一（同一 task 不会被重复插入）', () => {
    const tasks = tasksOf(ideFiles(h417, 'h417-ide')).tasks
    const labels = tasks.map((t) => t.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('README 调试说明', () => {
  it('vscode 档 README 写明 ch32rv 三步调试流与 launch.json，不再标注「待核实」', () => {
    const result = generateProject(config('CH32V003F4P6', 'readme-ide'), v003, {
      ...DEFAULT_SELECTION,
      ideConfig: 'vscode',
    })
    expect(result.errors).toEqual([])
    const readme = result.files.find((f) => f.path === 'README.md')!.content
    expect(readme).toContain('.vscode/launch.json')
    expect(readme).toContain('ch32rv')
    expect(readme).toContain('localhost:3333')
    expect(readme).toContain('烧录 (ch32rv)')
    expect(readme).not.toContain('调试配置待核实')
    expect(VSCODE_DEBUG_NOTE).toContain('不支持 vFlash')
  })
})

// ---------------------------------------------------------------------------
// M12：ch58x IDE 配置（MRS OpenOCD 调试链，契约 D9）。
// 工具链事实（2026-11-18 实测）：ch32rv 0.31.4 / wlink 0.1.3 / probe-rs 均不支持 CH58x；
// WCH MRS V3.0.0 随附的 WCH fork OpenOCD（wlinke + sdi + wch_riscv）是唯一可用 GDB 服务器。
// 生成的工程只引用 PATH 上的 `openocd-wch` 与 ${env:MRS_OPENOCD_CFG}，可移植。
// ---------------------------------------------------------------------------
describe('ch58x IDE 配置（MRS OpenOCD，契约 D9）', () => {
  // ch58x 独立管线（src/model/codegen/ch58x/ide.ts），同名函数需显式区分
  function ch58xIdeFiles(projectName: string, selection: Partial<CodegenSelection> = {}): Record<string, string> {
    const files = renderCh58xIdeConfigFiles(config('CH582M', projectName), ch582, {
      ...DEFAULT_SELECTION,
      ideConfig: 'vscode',
      ...selection,
    })
    return Object.fromEntries(files.map((f) => [f.path, f.content]))
  }

  it('ideConfig=none 时 ch58x 也不生成 .vscode 文件', () => {
    expect(
      renderCh58xIdeConfigFiles(config('CH582M', 'ch582-none'), ch582, { ...DEFAULT_SELECTION, ideConfig: 'none' }),
    ).toEqual([])
  })

  it('vscode 档生成 settings/tasks/launch 三件套，settings 指向 imc target', () => {
    const files = ch58xIdeFiles('ch582-ide')
    expect(Object.keys(files).sort()).toEqual([
      '.vscode/launch.json',
      '.vscode/settings.json',
      '.vscode/tasks.json',
    ])
    expect(files['.vscode/settings.json']).toContain('"rust-analyzer.cargo.target": "riscv32imc-unknown-none-elf"')
  })

  it('tasks.json 含四项 D9 任务 + release-debug 构建前置（label 唯一）', () => {
    const tasks = tasksOf(ch58xIdeFiles('ch582-ide')).tasks
    expect(tasks.map((t) => t.label)).toEqual([
      CH58X_BUILD_TASK_LABEL,
      CH58X_DEBUG_BUILD_TASK_LABEL,
      CH58X_GDB_SERVER_TASK_LABEL,
      CH58X_MRS_FLASH_TASK_LABEL,
      CH58X_WCHISP_FLASH_TASK_LABEL,
    ])
    expect(CH58X_BUILD_TASK_LABEL).toBe('构建')
    expect(CH58X_GDB_SERVER_TASK_LABEL).toBe('gdbserver (MRS OpenOCD)')
    expect(CH58X_MRS_FLASH_TASK_LABEL).toBe('烧录 (MRS OpenOCD)')
    expect(CH58X_WCHISP_FLASH_TASK_LABEL).toBe('烧录 (wchisp)')
    expect(new Set(tasks.map((t) => t.label)).size).toBe(tasks.length)
  })

  it('构建任务 = cargo build --release（M11 原样，默认构建组）', () => {
    const tasks = tasksOf(ch58xIdeFiles('ch582-ide')).tasks
    const build = tasks.find((t) => t.label === CH58X_BUILD_TASK_LABEL)
    expect(build?.command).toBe('cargo')
    expect(build?.args).toEqual(['build', '--release'])
    expect(build?.group).toEqual({ kind: 'build', isDefault: true })
  })

  it('release-debug 构建前置 = cargo build --profile release-debug', () => {
    const tasks = tasksOf(ch58xIdeFiles('ch582-ide')).tasks
    const debugBuild = tasks.find((t) => t.label === CH58X_DEBUG_BUILD_TASK_LABEL)
    expect(debugBuild?.command).toBe('cargo')
    expect(debugBuild?.args).toEqual(['build', '--profile', 'release-debug'])
  })

  it('gdbserver (MRS OpenOCD) = openocd-wch -f ${env:MRS_OPENOCD_CFG}，isBackground', () => {
    const tasks = tasksOf(ch58xIdeFiles('ch582-ide')).tasks
    const gdb = tasks.find((t) => t.label === CH58X_GDB_SERVER_TASK_LABEL)
    expect(gdb?.command).toBe(CH58X_MRS_OPENOCD_CMD)
    expect(gdb?.command).toBe('openocd-wch')
    expect(gdb?.args).toEqual(['-f', CH58X_MRS_OPENOCD_CFG_ENV])
    expect(gdb?.args).toEqual(['-f', '${env:MRS_OPENOCD_CFG}'])
    expect(gdb?.isBackground).toBe(true)
  })

  it('烧录 (MRS OpenOCD) 写 release-debug 产物：program … verify reset exit', () => {
    const tasks = tasksOf(ch58xIdeFiles('ch582-ide')).tasks
    const flash = tasks.find((t) => t.label === CH58X_MRS_FLASH_TASK_LABEL)
    expect(flash?.command).toBe('openocd-wch')
    expect(flash?.args).toEqual([
      '-f',
      '${env:MRS_OPENOCD_CFG}',
      '-c',
      'program target/riscv32imc-unknown-none-elf/release-debug/ch582-ide verify reset exit',
    ])
  })

  it('烧录 (wchisp) 保留 M11 备用路径（USB ISP，release 产物）', () => {
    const tasks = tasksOf(ch58xIdeFiles('ch582-ide')).tasks
    const wchisp = tasks.find((t) => t.label === CH58X_WCHISP_FLASH_TASK_LABEL)
    expect(wchisp?.command).toBe('wchisp')
    expect(wchisp?.args).toEqual(['flash', 'target/riscv32imc-unknown-none-elf/release/ch582-ide'])
  })

  it('launch.json：cppdbg attach localhost:3333，riscv-none-elf-gdb', () => {
    const launch = launchOf(ch58xIdeFiles('ch582-ide'))
    expect(launch.version).toBe('0.2.0')
    expect(launch.configurations).toHaveLength(1)
    const cfg = launch.configurations[0]
    expect(cfg.type).toBe('cppdbg')
    expect(cfg.request).toBe('attach')
    expect(cfg.name).toBe(CH58X_DEBUG_CONFIG_NAME)
    expect(cfg.name).toBe('Debug (MRS OpenOCD)')
    expect(cfg.MIMode).toBe('gdb')
    expect(cfg.miDebuggerPath).toBe(CH58X_GDB_DEBUGGER_PATH)
    expect(cfg.miDebuggerPath).toBe('riscv-none-elf-gdb')
    expect(cfg.miDebuggerServerAddress).toBe(CH58X_GDB_SERVER_ADDRESS)
    expect(cfg.miDebuggerServerAddress).toBe('localhost:3333')
    expect(cfg.cwd).toBe('${workspaceFolder}')
    expect(cfg.runToEntryPoint).toBe('main')
  })

  it('program 指向 release-debug ELF（Cargo 无 .elf 后缀）', () => {
    const cfg = launchOf(ch58xIdeFiles('ch582-ide')).configurations[0]
    expect(cfg.program).toBe('${workspaceFolder}/target/riscv32imc-unknown-none-elf/release-debug/ch582-ide')
  })

  it('preLaunchTask = 「构建 (release-debug)」且该任务存在于 tasks.json', () => {
    const files = ch58xIdeFiles('ch582-ide')
    const cfg = launchOf(files).configurations[0]
    expect(cfg.preLaunchTask).toBe(CH58X_DEBUG_BUILD_TASK_LABEL)
    expect(cfg.preLaunchTask).toBe('构建 (release-debug)')
    expect(tasksOf(files).tasks.map((t) => t.label)).toContain(CH58X_DEBUG_BUILD_TASK_LABEL)
  })

  it('无 postRemoteConnectCommands / monitor reset halt / load（attach 语义最小）', () => {
    const launch = launchOf(ch58xIdeFiles('ch582-ide'))
    const cfg = launch.configurations[0]
    expect(cfg).not.toHaveProperty('postRemoteConnectCommands')
    const raw = JSON.stringify(launch)
    expect(raw).not.toContain('monitor reset halt')
    expect(raw).not.toContain('"load"')
  })

  it('生成结果确定性与严格 JSON（settings/tasks/launch）', () => {
    const a = renderCh58xIdeConfigFiles(config('CH582M', 'ch582-ide'), ch582, {
      ...DEFAULT_SELECTION,
      ideConfig: 'vscode',
    })
    const b = renderCh58xIdeConfigFiles(config('CH582M', 'ch582-ide'), ch582, {
      ...DEFAULT_SELECTION,
      ideConfig: 'vscode',
    })
    expect(a).toEqual(b)
    const files = Object.fromEntries(a.map((f) => [f.path, f.content]))
    for (const path of ['.vscode/settings.json', '.vscode/tasks.json', '.vscode/launch.json']) {
      expect(() => JSON.parse(files[path])).not.toThrow()
    }
  })
})
