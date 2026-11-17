// VSCode 配置（D9，M12）：ch58x 生成 settings.json + tasks.json + launch.json。
// 调试/烧录走 MRS 随附的 WCH fork OpenOCD（`openocd-wch`），ch32rv/wlink/probe-rs 均不支持 CH58x。
// 工程只引用 PATH 上的 `openocd-wch` 与环境变量 ${env:MRS_OPENOCD_CFG}：
//   ln -s ~/mrs-openocd/bin/openocd ~/.local/bin/openocd-wch
//   export MRS_OPENOCD_CFG=~/mrs-openocd/bin/wch-riscv.cfg
// 前提：芯片侧两线调试（CFG_DEBUG_EN）需先开启（ISP/BOOT），否则 attach 报
// "WCH-Link failed to connect with riscv chip"（2026-11-18 实测，无写操作）。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { render } from '../render'
import { sanitizePackageName } from '../util'
import {
  CH58X_BUILD_TASK_LABEL,
  CH58X_DEBUG_BUILD_TASK_LABEL,
  CH58X_DEBUG_CONFIG_NAME,
  CH58X_GDB_DEBUGGER_PATH,
  CH58X_GDB_SERVER_ADDRESS,
  CH58X_GDB_SERVER_TASK_LABEL,
  CH58X_MRS_FLASH_TASK_LABEL,
  CH58X_MRS_OPENOCD_CFG_ARGS,
  CH58X_MRS_OPENOCD_CMD,
  CH58X_VSCODE_SETTINGS_TPL,
  CH58X_WCHISP_FLASH_TASK_LABEL,
} from './templates/ideConfig'

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

/** 调试 ELF：Cargo 产物无 .elf 后缀；release-debug（debug=2/strip=false）才能给 GDB 提供行号。 */
function debugProgramPath(packageName: string, target: string): string {
  return `\${workspaceFolder}/target/${target}/release-debug/${packageName}`
}

/**
 * launch.json：cppdbg attach 到 MRS OpenOCD 的 gdb 端口。
 * 不写 postRemoteConnectCommands / monitor reset halt / load：
 * - wch OpenOCD 支持 monitor，但 attach 语义保持最小（停机/复位由 OpenOCD cfg 的 init 流程决定）；
 * - 烧录是独立任务（写 flash 仅用户发起），launch 只做 attach + 符号加载。
 */
function vscodeLaunchJson(packageName: string, target: string): string {
  const configuration: LaunchConfiguration = {
    type: 'cppdbg',
    request: 'attach',
    name: CH58X_DEBUG_CONFIG_NAME,
    cwd: '${workspaceFolder}',
    program: debugProgramPath(packageName, target),
    MIMode: 'gdb',
    miDebuggerPath: CH58X_GDB_DEBUGGER_PATH,
    miDebuggerServerAddress: CH58X_GDB_SERVER_ADDRESS,
    runToEntryPoint: 'main',
    preLaunchTask: CH58X_DEBUG_BUILD_TASK_LABEL,
    setupCommands: [{ description: 'Enable pretty-printing', text: '-enable-pretty-printing', ignoreFailures: true }],
  }
  return `${JSON.stringify({ version: '0.2.0', configurations: [configuration] }, null, 2)}\n`
}

export function renderIdeConfigFiles(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
): GeneratedFile[] {
  if (sel.ideConfig !== 'vscode') return []
  const packageName = sanitizePackageName(config.projectName)
  const target = data.chip.target

  const tasks: TaskDef[] = [
    {
      label: CH58X_BUILD_TASK_LABEL,
      type: 'shell',
      command: 'cargo',
      args: ['build', '--release'],
      problemMatcher: ['$rustc'],
      group: { kind: 'build', isDefault: true },
    },
    {
      // launch.json 的 preLaunchTask：release-debug 档（debug=2、strip=false）供 GDB 读符号。
      // ch58x 的 .cargo/config.toml 没有 build-debug 别名（ch32 有），故显式 --profile。
      label: CH58X_DEBUG_BUILD_TASK_LABEL,
      type: 'shell',
      command: 'cargo',
      args: ['build', '--profile', 'release-debug'],
      problemMatcher: ['$rustc'],
    },
    {
      // 常驻 GDB 服务器：MRS OpenOCD（wlinke + sdi + wch_riscv），wch-riscv.cfg 监听 3333。
      label: CH58X_GDB_SERVER_TASK_LABEL,
      type: 'shell',
      command: CH58X_MRS_OPENOCD_CMD,
      args: [...CH58X_MRS_OPENOCD_CFG_ARGS],
      problemMatcher: [],
      isBackground: true,
      presentation: { reveal: 'always', panel: 'dedicated' },
    },
    {
      // 写操作仅用户发起：program → verify → reset → exit（不常驻）。
      label: CH58X_MRS_FLASH_TASK_LABEL,
      type: 'shell',
      command: CH58X_MRS_OPENOCD_CMD,
      args: [
        ...CH58X_MRS_OPENOCD_CFG_ARGS,
        '-c',
        `program target/${target}/release-debug/${packageName} verify reset exit`,
      ],
      problemMatcher: [],
    },
    {
      // wchisp 0.3.0 备用路径：CH58x 走 USB ISP；与 M11 一致（release 产物）。
      label: CH58X_WCHISP_FLASH_TASK_LABEL,
      type: 'shell',
      command: 'wchisp',
      args: ['flash', `target/${target}/release/${packageName}`],
      problemMatcher: [],
    },
  ]

  return [
    {
      path: '.vscode/settings.json',
      content: render(CH58X_VSCODE_SETTINGS_TPL, { target }),
    },
    {
      path: '.vscode/tasks.json',
      content: `${JSON.stringify({ version: '2.0.0', tasks }, null, 2)}\n`,
    },
    { path: '.vscode/launch.json', content: vscodeLaunchJson(packageName, target) },
  ]
}
