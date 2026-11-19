// pins.rs 渲染：纯 GPIO（INPUT/OUTPUT）引脚初始化。
// ch5xx-hal：Output::new(pin, Level, Speed) / Input::new(pin, Pull)；
// Speed 是驱动电流档（Low=5mA / High=20mA），不是 ch32 的速度档。ANALOG 引脚不生成 Input/Output。
import type { DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { fieldIdent, gpioPins, pinPeriType } from './derive'
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
      // HAL 的 Speed 只有 Low(5mA)/High(20mA)：HIGH/VERY_HIGH → High，其余 → Low
      const speedName = speed === 'HIGH' || speed === 'VERY_HIGH' ? 'High' : 'Low'
      const speedText = speedName === 'High' ? '高速档 → 20mA' : `${speed} 档 → 5mA`
      models.push({
        pin: a.pin,
        ident,
        kind: 'Output',
        comment: `输出，推挽，初始 ${levelName}（${speedText}；ch5xx Speed=驱动电流档）`,
        expr: `Output::new(${pinIdent(a.pin)}, Level::${levelName}, Speed::${speedName})`,
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
      useSet.add('Speed')
    }
  }
  const useOrder = ['Input', 'Level', 'Output', 'Pull', 'Speed']
  const useList = useOrder.filter((u) => useSet.has(u)).join(', ')

  const params = models.map((m) => `${pinIdent(m.pin)}: ${pinPeriType(m.pin)}`).join(', ')
  const content = render(T.PINS_RS_TPL, { pins: models, useList, params })
  return { path: 'src/generated/pins.rs', content }
}