// 生成区聚合：src/generated/mod.rs（模块声明 + Generated 字段 + init）。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import type { ModField, PeriModule } from './derive'
import { gpioCount, gpioPins } from './derive'
import { render } from '../render'
import * as T from './templates'

export function renderCoreGenerated(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  modules: string[],
  peripherals: PeriModule[],
): GeneratedFile {
  const fields: ModField[] = []

  if (sel.pins) {
    const hasGpio = gpioCount(config, data) > 0
    const args = gpioPins(config, data)
      .map((a) => `p.${a.pin}`)
      .join(', ')
    fields.push({
      name: 'pins',
      type: hasGpio ? "pins::Pins<'static>" : 'pins::Pins',
      init: `pins::init(${args})`,
    })
  }
  for (const m of peripherals) fields.push(...m.fields)

  return {
    path: 'src/generated/mod.rs',
    content: render(T.MOD_RS_TPL, { modules, fields }),
  }
}