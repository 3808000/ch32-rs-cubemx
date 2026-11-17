// IDE 配置产物（M4.5 / M10）：按 selection.ideConfig 生成 .vscode/settings.json + tasks.json + launch.json。
// 调试后端：wlink 0.1.3 无 gdbserver（源码 + `wlink --help` 核实），改用 ch32rv 0.31.3 的 `ch32rv gdb`
// （默认 localhost:3333，attach 不改写 flash；但无 vFlash/load，烧录仍走 `ch32rv flash`）。
import type { BuildProfile, ChipCore, CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { render } from './render'
import { sanitizePackageName } from './util'
import {
  CH32RV_DEBUG_CONFIG_NAME,
  CH32RV_GDB_DEBUGGER_PATH,
  CH32RV_GDB_SERVER_ADDRESS,
  CH32RV_GDB_TASK_ARGS,
  CH32RV_GDB_TASK_COMMAND,
  CH32RV_GDB_TASK_LABEL,
  CH32RV_FLASH_TASK_LABEL,
  DUAL_CORE_DEBUG_TASK_LABEL,
  SINGLE_CORE_DEBUG_TASK_LABEL,
  VSCODE_SETTINGS_TPL,
} from './templates/ideConfig'

const PROFILE_SUFFIX: Record<BuildProfile, string> = {
  'release-size': 'size',
  'release-speed': 'speed',
  'release-debug': 'debug',
}

interface TaskDef {
  label: string
  type: 'shell'
  command: string
  args: string[]
  problemMatcher?: string[]
  group?: { kind: 'build'; isDefault: boolean }
  /** 常驻任务（GDB 服务器）：VSCode 不等待其退出；手动运行于专用终端。 */
  isBackground?: boolean
  presentation?: { reveal: 'always' | 'silent' | 'never'; panel: 'shared' | 'dedicated' | 'new' }
}

/** ch32rv GDB 服务器任务（单核/双核共用）：手动启动后保持常驻，供 launch.json 连接。 */
const CH32RV_GDB_SERVER_TASK: TaskDef = {
  label: CH32RV_GDB_TASK_LABEL,
  type: 'shell',
  command: CH32RV_GDB_TASK_COMMAND,
  args: [...CH32RV_GDB_TASK_ARGS],
  problemMatcher: [],
  isBackground: true,
  presentation: { reveal: 'always', panel: 'dedicated' },
}

/** 单核工程任务：build/flash（另有 size/speed/debug 三个档位）+ gdbserver。 */
function singleCoreTasks(packageName: string, target: string, profile: BuildProfile): TaskDef[] {
  const tasks: TaskDef[] = [
    {
      label: '构建 (release)',
      type: 'shell',
      command: 'cargo',
      args: ['build', '--release'],
      problemMatcher: ['$rustc'],
    },
  ]
  for (const p of Object.keys(PROFILE_SUFFIX) as BuildProfile[]) {
    tasks.push({
      label: `构建 (${p})`,
      type: 'shell',
      command: 'cargo',
      args: [`build-${PROFILE_SUFFIX[p]}`],
      problemMatcher: ['$rustc'],
      // 选中的档位作为默认构建任务；其余档位仍可从任务列表选择
      ...(p === profile ? { group: { kind: 'build' as const, isDefault: true } } : {}),
    })
  }
  tasks.push(
    {
      label: '烧录 (cargo run)',
      type: 'shell',
      command: 'cargo',
      args: ['run', '--release'],
      problemMatcher: [],
    },
    {
      label: '烧录 (wlink 直调)',
      type: 'shell',
      command: 'wlink',
      args: ['-v', 'flash', '--enable-sdi-print', '--watch-serial', `target/${target}/release/${packageName}`],
      problemMatcher: [],
    },
    {
      // ch32rv GDB 服务器无 vFlash，烧录必须单独执行；该任务会写 flash（用户主动运行）
      label: CH32RV_FLASH_TASK_LABEL,
      type: 'shell',
      command: 'ch32rv',
      args: ['flash', `target/${target}/release-debug/${packageName}`],
      problemMatcher: [],
    },
    CH32RV_GDB_SERVER_TASK,
  )
  return tasks
}

/** 双核 workspace 任务：统一走 xtask（根目录 cargo build 不会套用各核 target）+ gdbserver。 */
function dualCoreTasks(): TaskDef[] {
  return [
    {
      label: 'xtask: 构建',
      type: 'shell',
      command: 'cargo',
      args: ['xtask', 'build'],
      problemMatcher: ['$rustc'],
      group: { kind: 'build', isDefault: true },
    },
    { label: 'xtask: 烧录', type: 'shell', command: 'cargo', args: ['xtask', 'flash'], problemMatcher: [] },
    { label: 'xtask: 合并镜像', type: 'shell', command: 'cargo', args: ['xtask', 'merge'], problemMatcher: [] },
    CH32RV_GDB_SERVER_TASK,
  ]
}

interface LaunchConfiguration {
  type: 'cppdbg'
  request: 'attach'
  name: string
  cwd: string
  program: string
  MIMode: 'gdb'
  miDebuggerPath: string
  miDebuggerServerAddress: string
  runToEntryPoint: string
  preLaunchTask: string
  setupCommands: { description: string; text: string; ignoreFailures: boolean }[]
}

/**
 * 调试 ELF 路径：
 * - 单核：Cargo 产物无 `.elf` 后缀（与 README 的 `target/<target>/release/<name>` 一致），
 *   档位取 `release-debug`（debug=2、strip=false，可供 GDB 读符号）；
 * - 双核：xtask 只构建 release，主核 bin 名为 `<package>-<core.id>`。
 */
function debugProgramPath(
  packageName: string,
  data: DeviceData,
  dual: boolean,
  mainCore: ChipCore | undefined,
): string {
  if (dual && mainCore) {
    return `\${workspaceFolder}/target/${mainCore.target}/release/${packageName}-${mainCore.id}`
  }
  return `\${workspaceFolder}/target/${data.chip.target}/release-debug/${packageName}`
}

/** launch.json（cppdbg attach + ch32rv gdbserver）。不写 monitor/load：ch32rv 不实现 monitor 与 vFlash。 */
function vscodeLaunchJson(packageName: string, data: DeviceData, dual: boolean): string {
  const cores = data.chip.cores ?? []
  const mainCore = cores.find((c) => c.mainCore === true) ?? cores[0]
  const configuration: LaunchConfiguration = {
    type: 'cppdbg',
    request: 'attach',
    name: CH32RV_DEBUG_CONFIG_NAME,
    cwd: '${workspaceFolder}',
    program: debugProgramPath(packageName, data, dual, mainCore),
    MIMode: 'gdb',
    miDebuggerPath: CH32RV_GDB_DEBUGGER_PATH,
    miDebuggerServerAddress: CH32RV_GDB_SERVER_ADDRESS,
    runToEntryPoint: 'main',
    preLaunchTask: dual ? DUAL_CORE_DEBUG_TASK_LABEL : SINGLE_CORE_DEBUG_TASK_LABEL,
    setupCommands: [{ description: 'Enable pretty-printing', text: '-enable-pretty-printing', ignoreFailures: true }],
  }
  return `${JSON.stringify({ version: '0.2.0', configurations: [configuration] }, null, 2)}\n`
}

/**
 * 生成 VSCode 配置（仅 selection.ideConfig === 'vscode'）。
 * 产物：settings.json（rust-analyzer）、tasks.json（构建/烧录/gdbserver）、launch.json（ch32rv 调试）。
 */
export function renderIdeConfigFiles(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
): GeneratedFile[] {
  if (sel.ideConfig !== 'vscode') return []

  const packageName = sanitizePackageName(config.projectName)
  const cores = data.chip.cores ?? []
  const dual = cores.length > 0
  const mainCore = cores.find((c) => c.mainCore === true) ?? cores[0]
  // tier-3 rv32ec 使用工程根目录的 target json；rust-analyzer 的 target 直接指向该文件
  const jsonTarget = !dual && data.chip.nightly && data.chip.target === 'riscv32ec-unknown-none-elf'
  const raTarget = dual
    ? `${mainCore.id}/${mainCore.target}.json`
    : jsonTarget
      ? `${data.chip.target}.json`
      : data.chip.target
  // 双核 workspace 固定 nightly（见 rust-toolchain.toml）；单核以芯片数据为准
  const nightly = dual || data.chip.nightly

  const settings = render(VSCODE_SETTINGS_TPL, { target: raTarget, nightly })
  const tasks = dual
    ? dualCoreTasks()
    : singleCoreTasks(packageName, data.chip.target, sel.profile ?? 'release-size')

  return [
    { path: '.vscode/settings.json', content: settings },
    { path: '.vscode/tasks.json', content: `${JSON.stringify({ version: '2.0.0', tasks }, null, 2)}\n` },
    { path: '.vscode/launch.json', content: vscodeLaunchJson(packageName, data, dual) },
  ]
}
