// 引脚分组：单归属约束（一个引脚只能属于一个组）。
import type { PinGroup } from '@/model/types'

export const GROUP_COLORS = ['#2A62B7', '#1D8136', '#B26A00', '#C00000', '#7B4FBF', '#0E7C86']

/** 把引脚加入组；若已在其它组则先移出（单归属）。返回新数组。 */
export function addToGroup(groups: PinGroup[], name: string, pin: string): PinGroup[] {
  return groups.map((g) => {
    const pins = g.pins.filter((p) => p !== pin)
    if (g.name === name) pins.push(pin)
    return { ...g, pins }
  })
}

export function removeFromGroup(groups: PinGroup[], pin: string): PinGroup[] {
  return groups.map((g) => ({ ...g, pins: g.pins.filter((p) => p !== pin) }))
}

export function groupOfPin(groups: PinGroup[], pin: string): PinGroup | null {
  return groups.find((g) => g.pins.includes(pin)) ?? null
}

export function createGroup(groups: PinGroup[], name: string): PinGroup[] {
  if (groups.some((g) => g.name === name)) return groups
  return [...groups, { name, pins: [], color: GROUP_COLORS[groups.length % GROUP_COLORS.length] }]
}