// VSCode 配置（D11）：ch58x 只生成 settings.json + tasks.json（构建 + wchisp 烧录）。
// 不生成 launch.json / gdbserver：ch32rv 0.31.3 与 wlink 0.1.3 均不支持 CH58x 目标（HAL_API_NOTES §12.6）。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { render } from '../render'
import { sanitizePackageName } from '../util'
import * as T from './templates'

interface TaskDef {
  label: string
  type: 'shell'
  command: string
  args: string[]
  problemMatcher?: string[]
  group?: { kind: 'build'; isDefault: boolean }
}

export function renderIdeConfigFiles(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
): GeneratedFile[] {
  if (sel.ideConfig !== 'vscode') return []
  const packageName = sanitizePackageName(config.projectName)

  const tasks: TaskDef[] = [
    {
      label: '构建',
      type: 'shell',
      command: 'cargo',
      args: ['build', '--release'],
      problemMatcher: ['$rustc'],
      group: { kind: 'build', isDefault: true },
    },
    {
      // wchisp 0.3.0：CH58x 走 USB ISP；WCH-Link/wlink/ch32rv 不支持 CH58x
      label: '烧录 (wchisp)',
      type: 'shell',
      command: 'wchisp',
      args: ['flash', `target/${data.chip.target}/release/${packageName}`],
      problemMatcher: [],
    },
  ]

  return [
    {
      path: '.vscode/settings.json',
      content: render(T.CH58X_VSCODE_SETTINGS_TPL, { target: data.chip.target }),
    },
    {
      path: '.vscode/tasks.json',
      content: `${JSON.stringify({ version: '2.0.0', tasks }, null, 2)}\n`,
    },
  ]
}
