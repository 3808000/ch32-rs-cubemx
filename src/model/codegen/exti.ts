// exti.rs 渲染：EXTI 输入（引脚 + 通道 + 边沿等待方法）。
import type { DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { extiItems } from './derive'
import type { ModField } from './derive'
import { render } from './render'
import { periType } from './util'
import * as T from './templates'

export function renderExti(config: ProjectConfig, data: DeviceData, base = ''): { file: GeneratedFile; fields: ModField[] } | null {
  const items = extiItems(config, data)
  if (items.length === 0) return null

  const params = items
    .flatMap((e) => [
      `${e.pinParam}: ${periType(e.pin)}`,
      `${e.chParam}: hal::Peri<'static, hal::peripherals::EXTI${e.channel}>`,
    ])
    .join(', ')
  const content = render(T.EXTI_TPL, { items, params })
  const callArgs = items.map((e) => `p.${e.pin}, p.EXTI${e.channel}`).join(', ')
  return {
    file: { path: `${base}src/generated/exti.rs`, content },
    fields: [{ name: 'exti', type: 'exti::Exti', call: `exti::init(${callArgs})` }],
  }
}