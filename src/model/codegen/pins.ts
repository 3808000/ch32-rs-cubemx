// pins.rs 渲染：纯 GPIO（INPUT/OUTPUT 且非 EXTI）引脚初始化。
import type { DeviceData, GeneratedFile, ProjectConfig } from '@/model/types'
import { labelToIdent } from '@/model/conflicts'
import { plainGpioPins } from './derive'
import { render } from './render'
import { identWithPrefix, periType, pinIdent, pullVariant } from './util'
import * as T from './templates'

export function renderPins(config: ProjectConfig, data: DeviceData, base = ''): GeneratedFile {
  const models: {
    pin: string
    ident: string
    kind: 'Output' | 'Input' | 'OutputOpenDrain'
    comment: string
    expr: string
  }[] = []

  for (const a of plainGpioPins(config, data)) {
    const base = a.label ? labelToIdent(a.label) : pinIdent(a.pin)
    const ident = identWithPrefix(config, base)
    const openDrain = a.params?.outputType === 'OPEN_DRAIN'
    const speed = a.params?.speed ?? 'HIGH'
    // V003 家族仅 Low/Medium/High 三档；VERY_HIGH 无对应，映射 High
    const speedName = speed === 'LOW' ? 'Low' : speed === 'MEDIUM' ? 'Medium' : 'High'
    if (a.mode === 'OUTPUT') {
      const level = a.params?.level ?? 'LOW'
      const levelName = level === 'HIGH' ? 'High' : 'Low'
      models.push({
        pin: a.pin,
        ident,
        kind: openDrain ? 'OutputOpenDrain' : 'Output',
        comment: `输出${openDrain ? '，开漏' : '，推挽'}，初始 ${levelName}，速度 ${speedName}`,
        expr: `${openDrain ? 'OutputOpenDrain' : 'Output'}::new(${pinIdent(a.pin)}, Level::${levelName}, Speed::${speedName})`,
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
  const useOrder = ['Input', 'Level', 'Output', 'OutputOpenDrain', 'Pull', 'Speed']
  const useList = useOrder.filter((u) => useSet.has(u)).join(', ')

  const params = models.map((m) => `${pinIdent(m.pin)}: ${periType(m.pin)}`).join(', ')
  const content = render(T.PINS_TPL, { pins: models, useList, params })
  return { path: `${base}src/generated/pins.rs`, content }
}