// IDE 配置产物（M4.5）：按 selection.ideConfig 生成 .vscode/settings.json + tasks.json。
// 调试配置：wlink 的 gdbserver 能力尚未核实，故不生成 launch.json（README 会标注「调试配置待核实」）。
import type { BuildProfile, CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { render } from './render'
import { sanitizePackageName } from './util'
import { VSCODE_SETTINGS_TPL } from './templates/ideConfig'

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
}

/** 单核工程任务：build/flash（另有 size/speed/debug 三个档位）。 */
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
  )
  return tasks
}

/** 双核 workspace 任务：统一走 xtask（根目录 cargo build 不会套用各核 target）。 */
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
  ]
}

/**
 * 生成 VSCode 配置（仅 selection.ideConfig === 'vscode'）。
 * 不生成 launch.json：调试后端（wlink gdbserver）未核实。
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
  ]
}