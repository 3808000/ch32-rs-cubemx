// 拖拽移动信号的候选计算（M6）：纯函数，无 UI 依赖。
// AF/ANALOG 配置（有 function）：候选 = 承载同一信号的其他引脚（remap 数据驱动），排除已占用脚；
// 纯 GPIO 配置（无 function）：候选 = 所有未占用的 IO 脚。结果按引脚物理位号排序，确定性输出。
import type { DeviceData, PinAssignment } from '@/model/types'
import { pinsOfSignal, remapValuesFor } from '@/model/device'

/** 单个候选目标：remap 仅 AF 信号搬移时有值（目标脚承载该信号的档位） */
export interface MoveCandidate {
  pin: string
  remap?: number
}

/** 计算 fromPin 的配置可搬移到的全部候选引脚。
 *  - fromPin 无配置 → []；
 *  - 有 function（AF/ANALOG）：pinsOfSignal 找同信号全部引脚，排除 fromPin 与已有任何 assignment 的脚；
 *    remap 取目标脚承载此信号的档位（remapValuesFor），优先保留原 remap，否则取第一个；
 *  - 无 function（纯 GPIO）：所有未占用的 IO 脚（type==='IO'），remap 为 undefined。
 *  结果按引脚位号（chip.pins.number）升序排序，保证确定性。 */
export function moveCandidates(data: DeviceData, assignments: PinAssignment[], fromPin: string): MoveCandidate[] {
  const from = assignments.find((a) => a.pin === fromPin)
  if (!from) return []
  // 位号查找表：排序用（数据一致时候选脚必然在 chip.pins 中）
  const numberOf = new Map(data.chip.pins.map((p) => [p.name, p.number]))
  // 防御：配置引用了芯片上不存在的引脚时无候选
  if (!numberOf.has(fromPin)) return []
  const occupied = new Set(assignments.map((a) => a.pin))
  const byNumber = (a: MoveCandidate, b: MoveCandidate): number => {
    const na = numberOf.get(a.pin) ?? Number.MAX_SAFE_INTEGER
    const nb = numberOf.get(b.pin) ?? Number.MAX_SAFE_INTEGER
    return na !== nb ? na - nb : a.pin.localeCompare(b.pin)
  }

  if (from.function) {
    // AF/ANALOG：同信号候选（remap 数据驱动）
    const signalPins = new Set(pinsOfSignal(data, from.function).map((e) => e.pin))
    const out: MoveCandidate[] = []
    for (const pin of signalPins) {
      if (pin === fromPin || occupied.has(pin)) continue
      const values = remapValuesFor(data, pin, from.function)
      if (values.length === 0) continue
      // 优先保留原 remap（目标脚支持该档位时），否则取第一个可用档位
      const remap = from.remap !== undefined && values.includes(from.remap) ? from.remap : values[0]
      out.push({ pin, remap })
    }
    return out.sort(byNumber)
  }

  // 纯 GPIO：所有未占用的 IO 脚（含特殊 IO，如 OSC/SWD，占用判断只看 assignment）
  return data.chip.pins
    .filter((p) => p.type === 'IO' && !occupied.has(p.name))
    .map((p) => ({ pin: p.name }))
    .sort(byNumber)
}

/** 命中判断辅助：toPin 是 fromPin 的合法搬移目标时返回对应候选（含 remap），否则 null。
 *  供画布 mouseup 落点校验（目标未占用且可承载同一信号 / GPIO 空闲脚）。 */
export function canMoveTo(data: DeviceData, assignments: PinAssignment[], fromPin: string, toPin: string): MoveCandidate | null {
  if (toPin === fromPin) return null
  return moveCandidates(data, assignments, fromPin).find((c) => c.pin === toPin) ?? null
}