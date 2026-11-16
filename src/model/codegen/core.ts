// 单核生成区：src/generated/**（clock/pins/exti/usart/spi/i2c/adc/irq + mod.rs 聚合）。
// base 为目录前缀（单核 ''，双核 'v3f/'）；单核输出与历史逐字节一致。
import type { CodegenSelection, DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import type { PeripheralUsage } from '@/model/peripherals'
import { gpioArgs, gpioCount } from './derive'
import type { IrqBinding, ModField, PeriModule } from './derive'
import { render } from './render'
import { renderClock } from './clock'
import { renderPins } from './pins'
import { renderExti } from './exti'
import { renderUsart } from './usart'
import { renderSpi } from './spi'
import { renderI2c } from './i2c'
import { renderAdc } from './adc'
import { renderIrq } from './irq'
import * as T from './templates'

/**
 * 生成一个核的 src/generated/**（clock/pins/exti/usart/spi/i2c/adc/irq + mod.rs）。
 * base 为目录前缀（单核 ''，双核 'v3f/'）。单核输出与历史逐字节一致。
 */
export function renderCoreGenerated(
  config: ProjectConfig,
  data: DeviceData,
  sel: CodegenSelection,
  usages: PeripheralUsage[],
  embassy: boolean,
  base = '',
): GeneratedFile[] {
  const files: GeneratedFile[] = []
  const modules: string[] = []
  const fields: ModField[] = []
  const irqs: IrqBinding[] = []

  if (sel.clock) {
    files.push(renderClock(config, data, base))
    modules.push('clock')
  }
  let pinsFile: GeneratedFile | null = null
  if (sel.pins) {
    pinsFile = renderPins(config, data, base)
    files.push(pinsFile)
    modules.push('pins')
  }
  let extiMod: { file: GeneratedFile; fields: ModField[] } | null = null
  if (sel.exti) {
    extiMod = renderExti(config, data, base)
    if (extiMod) {
      files.push(extiMod.file)
      modules.push('exti')
    }
  }
  const addPeri = (m: PeriModule | null) => {
    if (!m) return
    files.push(m.file)
    modules.push(m.module)
    fields.push(...m.fields)
    irqs.push(...m.irqs)
  }
  if (sel.usart) addPeri(renderUsart(config, usages, embassy, data, base))
  if (sel.spi) addPeri(renderSpi(config, usages, embassy, data, base))
  if (sel.i2c) addPeri(renderI2c(config, usages, embassy, data, base))
  if (sel.adc) addPeri(renderAdc(usages, data, base))

  // NVIC/PFIC：有启用中断时才生成 irq.rs，并在 mod.rs 的 init 中调用
  const irqFile = renderIrq(config, data, base)
  const initCalls: string[] = []
  if (irqFile) {
    files.push(irqFile)
    modules.push('irq')
    initCalls.push('irq::init()')
  }

  // mod.rs 聚合
  const hasGpio = pinsFile !== null && gpioCount(config, data) > 0
  const modFields: { name: string; type: string }[] = []
  const modInits: { field: string; call: string }[] = []
  if (sel.pins) {
    modFields.push({ name: 'pins', type: hasGpio ? "pins::Pins<'static>" : 'pins::Pins' })
    modInits.push({ field: 'pins', call: `pins::init(${gpioArgs(config, data)})` })
  }
  if (extiMod) {
    modFields.push({ name: 'exti', type: 'exti::Exti' })
    modInits.push({ field: 'exti', call: extiMod.fields[0].call })
  }
  for (const f of fields) {
    modFields.push({ name: f.name, type: f.type })
    modInits.push({ field: f.name, call: f.call })
  }
  files.push({
    path: `${base}src/generated/mod.rs`,
    content: render(T.MOD_TPL, {
      modules,
      irqs,
      fields: modFields,
      inits: modInits,
      calls: initCalls,
    }),
  })
  return files
}