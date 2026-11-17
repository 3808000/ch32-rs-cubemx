// pins.rs 渲染：纯 GPIO（INPUT/OUTPUT）引脚初始化。
// ch58x-hal：Output::new(pin, Level, OutputDrive) / Input::new(pin, Pull)；
// HAL 无 Speed 枚举 —— UI 速度档按约定映射驱动电流（HIGH → _20mA，其余 → _5mA）。
import type { DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { fieldIdent, gpioPins, pinType } from './derive'
import { render } from '../render'
import { pinIdent, pullVariant } from '../util'
import * as T from './templates'

export function renderPins(config: ProjectConfig, data: DeviceData): GeneratedFile {
  const models: {
    pin: string
    ident: string
    kind: 'Output' | 'Input'
    comment: string
    expr: string
  }[] = []

  for (const a of gpioPins(config, data)) {
    const ident = fieldIdent(config, a)
    if (a.mode === 'OUTPUT') {
      const level = a.params?.level ?? 'LOW'
      const levelName = level === 'HIGH' ? 'High' : 'Low'
      const speed = a.params?.speed ?? 'HIGH'
      // HAL 只有 OutputDrive::_5mA/_20mA；HIGH 映射 20mA，其余 5mA（UI 约定，非 HAL 语义）
      const drive = speed === 'HIGH' ? '_20mA' : '_5mA'
      const speedText = speed === 'HIGH' ? '高速档 → 20mA' : `${speed} 档 → 5mA`
      models.push({
        pin: a.pin,
        ident,
        kind: 'Output',
        comment: `输出，推挽，初始 ${levelName}（${speedText}；HAL 无 Speed 枚举，按约定映射）`,
        expr: `Output::new(${pinIdent(a.pin)}, Level::${levelName}, OutputDrive::${drive})`,
      })
    } else {
      const pull = a.params?.pull ?? 'NONE'
      models.push({
        pin: a.pin,
        ident,
        kind: 'Input',
        comment: `输入，${pull === 'UP' ? '上拉' : pull === 'DOWN' ? '下拉' : '浮空'}`,
        expr: `Input::new(${pinIdent(a.pin)}, Pull::${pullVariant(pull)})`,
      })
    }
  }

  // use 语句按需收集（无 GPIO 时不引入任何 use，避免未使用告警）
  const useSet = new Set<string>()
  for (const m of models) {
    useSet.add(m.kind)
    if (m.kind === 'Input') useSet.add('Pull')
    else {
      useSet.add('Level')
      useSet.add('OutputDrive')
    }
  }
  const useOrder = ['Input', 'Level', 'Output', 'OutputDrive', 'Pull']
  const useList = useOrder.filter((u) => useSet.has(u)).join(', ')

  const params = models.map((m) => `${pinIdent(m.pin)}: ${pinType(m.pin)}`).join(', ')
  const content = render(T.PINS_RS_TPL, { pins: models, useList, params })
  return { path: 'src/generated/pins.rs', content }
}
