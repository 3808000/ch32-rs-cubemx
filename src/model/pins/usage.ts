// 外设使用归并：引脚 → 驱动占用汇总（供 PeripheralUsagePanel）。
import type { DeviceData, ProjectConfig } from '@/model/types'
import { derivePeripheralUsage } from '@/model/peripherals'
import { peripheralOfSignal } from '@/model/device'

export interface PinUsage {
  pin: string
  drivers: string[] // 占用该引脚的外设/功能描述
}

export function pinUsageSummary(config: ProjectConfig, data: DeviceData): PinUsage[] {
  const map = new Map<string, string[]>()
  const add = (pin: string, driver: string) => {
    const arr = map.get(pin) ?? []
    if (!arr.includes(driver)) arr.push(driver)
    map.set(pin, arr)
  }
  for (const a of config.pins ?? []) {
    if (a.mode === 'AF' && a.function) add(a.pin, peripheralOfSignal(a.function) ?? a.function)
    else if (a.mode === 'ANALOG' && a.function) add(a.pin, `ADC (${a.function})`)
    else if (a.mode === 'INPUT' || a.mode === 'OUTPUT') add(a.pin, `GPIO ${a.mode}`)
    if (a.params.exti?.enabled) add(a.pin, 'EXTI')
  }
  for (const u of derivePeripheralUsage(config, data)) {
    if (!u.enabled) continue
    for (const p of u.pins) add(p.pin, u.id)
  }
  return [...map.entries()].map(([pin, drivers]) => ({ pin, drivers })).sort((a, b) => a.pin.localeCompare(b.pin))
}