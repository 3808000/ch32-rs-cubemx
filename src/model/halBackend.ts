import type { DeviceData, ProjectConfig } from '@/model/types'

/** 显式选择优先。旧工程沿用兼容后端，其余按芯片默认值解析。 */
export function resolveHalBackend(config: Pick<ProjectConfig, 'halBackend'>, data: Pick<DeviceData, 'chip'>): string {
  if (typeof config.halBackend === 'string' && config.halBackend !== '') return config.halBackend
  if (data.chip.legacyHalBackend) return data.chip.legacyHalBackend
  return data.chip.halBackend ?? 'ch32-hal'
}
