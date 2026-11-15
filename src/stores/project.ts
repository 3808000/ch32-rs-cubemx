// 项目状态（Pinia）。配置模型见 types.ts；所有芯片差异来自数据层。
import { defineStore } from 'pinia'
import type {
  ClockConfig,
  Conflict,
  PeripheralState,
  PinAssignment,
  PinGroup,
  PinMode,
  PinParams,
  ProjectConfig,
} from '../types'
import { getDeviceData } from '../data/device'
import { mergeClockConfig } from '../lib/clock'
import { checkConflicts } from '../lib/conflicts'
import { HAL_REV } from '../lib/codegen/halRev'

const STORAGE_KEY = 'ch32-rs-cubemx:project'

export type ViewId = 'home' | 'pinout' | 'clock' | 'peripherals'

interface ProjectState {
  chip: string
  projectName: string
  assignments: PinAssignment[]
  groups: PinGroup[]
  prefix: string
  clock: ClockConfig | null // null = 芯片默认档
  peripherals: Record<string, PeripheralState>
  features: { embassy: boolean; debugPrint: boolean }
  halRev: string
  selectedPin: string | null
  unlocked: string[] // 显式解锁的特殊引脚（NRST/SWD/OSC）
  activeView: ViewId
  dirty: boolean
  lastSavedAt: number | null
  lastExportSnapshot: Record<string, string> | null
  notifications: { id: number; text: string; level: 'info' | 'warning' | 'error' }[]
}

export const useProjectStore = defineStore('project', {
  state: (): ProjectState => ({
    chip: 'CH32V003F4P6',
    projectName: 'ch32-project',
    assignments: [],
    groups: [],
    prefix: '',
    clock: null,
    peripherals: {},
    features: { embassy: false, debugPrint: true },
    halRev: HAL_REV,
    selectedPin: null,
    unlocked: [],
    activeView: 'pinout',
    dirty: false,
    lastSavedAt: null,
    lastExportSnapshot: null,
    notifications: [],
  }),

  getters: {
    deviceData: (s) => getDeviceData(s.chip),
    clockConfig(): ClockConfig {
      return mergeClockConfig(this.deviceData.clock, this.clock ?? undefined)
    },
    config(): ProjectConfig {
      return {
        version: 1,
        chip: this.chip,
        projectName: this.projectName,
        pins: this.assignments,
        groups: this.groups,
        naming: { prefix: this.prefix },
        clock: this.clockConfig,
        peripherals: this.peripherals,
        features: this.features,
        hal: { rev: this.halRev },
      }
    },
    conflicts(): Conflict[] {
      return checkConflicts(this.config, this.deviceData, this.unlocked)
    },
    errorCount(): number {
      return this.conflicts.filter((c) => c.level === 'error').length
    },
    warningCount(): number {
      return this.conflicts.filter((c) => c.level === 'warning').length
    },
    assignmentOf(): (pin: string) => PinAssignment | undefined {
      return (pin: string) => this.assignments.find((a) => a.pin === pin)
    },
  },

  actions: {
    markDirty() {
      this.dirty = true
    },

    notify(text: string, level: 'info' | 'warning' | 'error' = 'info') {
      const id = Date.now() + Math.random()
      this.notifications.push({ id, text, level })
      if (this.notifications.length > 50) this.notifications.shift()
    },

    selectPin(pin: string | null) {
      this.selectedPin = pin
    },

    setView(view: ViewId) {
      this.activeView = view
    },

    /** 配置引脚（覆盖已有配置）。调用方负责走 usePinOverwrite 确认。 */
    setPinAssignment(pin: string, mode: PinMode, opts: { label?: string; function?: string; remap?: number; params?: PinParams } = {}) {
      const existing = this.assignments.find((a) => a.pin === pin)
      const next: PinAssignment = {
        pin,
        mode,
        label: opts.label ?? existing?.label,
        function: opts.function,
        remap: opts.remap,
        params: opts.params ?? {},
      }
      if (existing) Object.assign(existing, next)
      else this.assignments.push(next)
      this.markDirty()
    },

    updatePinParams(pin: string, params: Partial<PinParams>) {
      const a = this.assignments.find((x) => x.pin === pin)
      if (!a) return
      a.params = { ...a.params, ...params }
      this.markDirty()
    },

    setPinLabel(pin: string, label: string) {
      const a = this.assignments.find((x) => x.pin === pin)
      if (!a) return
      a.label = label || undefined
      this.markDirty()
    },

    clearPin(pin: string) {
      const i = this.assignments.findIndex((a) => a.pin === pin)
      if (i >= 0) this.assignments.splice(i, 1)
      for (const g of this.groups) {
        const j = g.pins.indexOf(pin)
        if (j >= 0) g.pins.splice(j, 1)
      }
      if (this.selectedPin === pin) this.selectedPin = null
      this.markDirty()
    },

    resetPinout() {
      this.assignments = []
      this.groups = []
      this.peripherals = {}
      this.unlocked = []
      this.selectedPin = null
      this.markDirty()
    },

    unlockSpecial(pin: string) {
      if (!this.unlocked.includes(pin)) this.unlocked.push(pin)
      this.markDirty()
    },

    setClock(cfg: ClockConfig) {
      this.clock = cfg
      this.markDirty()
    },

    resetClock() {
      this.clock = null
      this.markDirty()
    },

    setPeripheral(id: string, state: PeripheralState) {
      this.peripherals[id] = state
      this.markDirty()
    },

    setPeripheralEnabled(id: string, enabled: boolean) {
      const cur = this.peripherals[id] ?? { enabled: false, params: {} }
      this.peripherals[id] = { ...cur, enabled }
      this.markDirty()
    },

    setFeatures(f: Partial<{ embassy: boolean; debugPrint: boolean }>) {
      this.features = { ...this.features, ...f }
      this.markDirty()
    },

    setProjectName(name: string) {
      this.projectName = name
      this.markDirty()
    },

    setPrefix(prefix: string) {
      this.prefix = prefix
      this.markDirty()
    },

    addGroup(group: PinGroup) {
      this.groups.push(group)
      this.markDirty()
    },

    removeGroup(name: string) {
      const i = this.groups.findIndex((g) => g.name === name)
      if (i >= 0) this.groups.splice(i, 1)
      this.markDirty()
    },

    /** 导入工程配置（兼容缺省字段）。 */
    loadConfig(cfg: Partial<ProjectConfig>) {
      if (cfg.chip) this.chip = cfg.chip
      if (cfg.projectName) this.projectName = cfg.projectName
      this.assignments = (cfg.pins ?? []).map((p) => ({ ...p, params: p.params ?? {} }))
      this.groups = cfg.groups ?? []
      this.prefix = cfg.naming?.prefix ?? ''
      this.clock = cfg.clock ?? null
      this.peripherals = cfg.peripherals ?? {}
      this.features = { embassy: false, debugPrint: true, ...(cfg.features ?? {}) }
      this.halRev = cfg.hal?.rev ?? HAL_REV
      this.unlocked = []
      this.selectedPin = null
      this.dirty = false
      this.lastSavedAt = Date.now()
    },

    switchDevice(chip: string) {
      if (chip === this.chip) return
      this.chip = chip
      this.assignments = []
      this.groups = []
      this.peripherals = {}
      this.clock = null
      this.unlocked = []
      this.selectedPin = null
      this.markDirty()
    },

    /** 保存到 localStorage。 */
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config))
        this.dirty = false
        this.lastSavedAt = Date.now()
      } catch (e) {
        this.notify(`保存失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    },

    /** 从 localStorage 恢复。返回是否恢复成功。 */
    restore(): boolean {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return false
        this.loadConfig(JSON.parse(raw))
        return true
      } catch {
        return false
      }
    },

    setExportSnapshot(files: Record<string, string>) {
      this.lastExportSnapshot = files
    },
  },
})