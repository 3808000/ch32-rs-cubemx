// 时钟模型的统一入口。域内模块直接引用所需职责，避免经过入口互相依赖。
export {
  applyClockPreset,
  defaultClock,
  isClockNodeLockable,
  isClockNodeLocked,
  matchPreset,
  mergeClockConfig,
  nearestPreset,
  presetToConfig,
} from './config'
export type { MatchPresetOptions } from './config'
export { computeClock, pllOutMhz, sourceFreqMhz, sysclkSourceDivider } from './frequency'
export { clockExportIssue, validateClock } from './validation'
export { pllCandidateConfig, resolveClockIssues, solvePll } from './solver'
export type { ClockFixResult, PllCandidate, SolvePllOptions } from './solver'
export { computePeripheralClocks, validatePeripheralClocks, peripheralClockCategories } from './peripheral'
