// 项目状态（Pinia）。配置模型见 types.ts；所有芯片差异来自数据层。
import { defineStore } from 'pinia'
import type {
  ClockConfig,
  Conflict,
  ConflictPolicy,
  DmaConfig,
  InterruptConfig,
  PeripheralState,
  PinAssignment,
  PinGroup,
  PinMode,
  PinParams,
  ProjectConfig,
} from '@/model/types'
import { getDeviceData } from '@/model/device'
import { mergeClockConfig } from '@/model/clock'
import { checkConflicts } from '@/model/conflicts'
import { HAL_REV } from '@/model/codegen/halRev'
import { loadProject, saveProject } from '@/services/projectStorage'

export type ViewId = 'home' | 'pinout' | 'clock' | 'peripherals' | 'project-settings'

interface ProjectState {
  chip: string
  projectName: string
  assignments: PinAssignment[]
  groups: PinGroup[]
  prefix: string
  clock: ClockConfig | null // null = 芯片默认档
  peripherals: Record<string, PeripheralState>
  interrupts: InterruptConfig[] // M3 NVIC/PFIC
  dma: DmaConfig[] // M3 DMA 通道分配
  conflictPolicy: ConflictPolicy // M8 类别级冲突策略（缺省 safe 安全网）
  features: { embassy: boolean; debugPrint: boolean }
  halRev: string
  selectedPin: string | null
  unlocked: string[] // 显式解锁的特殊引脚（NRST/SWD/OSC）
  activeView: ViewId
  /** 当前打开的外设对象页（null = Peripherals 概览/列表）。M2 对象标签页。 */
  activePeripheralId: string | null
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
    interrupts: [],
    dma: [],
    conflictPolicy: { mode: 'safe' },
    features: { embassy: false, debugPrint: true },
    halRev: HAL_REV,
    selectedPin: null,
    unlocked: [],
    activeView: 'pinout',
    activePeripheralId: null,
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
        interrupts: this.interrupts,
        dma: this.dma,
        // safe 为缺省语义：不写入 cube.json，保持旧工程产物逐字节不变
        ...(this.conflictPolicy.mode !== 'safe' ? { conflictPolicy: this.conflictPolicy } : {}),
        features: this.features,
        hal: { rev: this.halRev },
        unlockedPins: [...this.unlocked],
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

    /** 打开外设对象页（M2）：切到 Peripherals 视图并聚焦该实例。 */
    openPeripheral(id: string) {
      this.activePeripheralId = id
      this.activeView = 'peripherals'
    },

    /** 关闭外设对象页，回到 Peripherals 概览/列表。 */
    closePeripheral() {
      this.activePeripheralId = null
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
      this.interrupts = []
      this.dma = []
      this.unlocked = []
      this.selectedPin = null
      this.activePeripheralId = null
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

    /** 设置/更新一条中断配置（M3 NVIC）。priority 夹取 0..15。 */
    setInterrupt(irq: string, cfg: Partial<Omit<InterruptConfig, 'irq'>>) {
      const i = this.interrupts.findIndex((x) => x.irq === irq)
      const priority = Math.max(0, Math.min(15, cfg.priority ?? (i >= 0 ? this.interrupts[i].priority : 0)))
      const next: InterruptConfig = {
        irq,
        enabled: cfg.enabled ?? (i >= 0 ? this.interrupts[i].enabled : true),
        priority,
      }
      if (i >= 0) this.interrupts[i] = next
      else this.interrupts.push(next)
      this.markDirty()
    },

    removeInterrupt(irq: string) {
      const i = this.interrupts.findIndex((x) => x.irq === irq)
      if (i >= 0) this.interrupts.splice(i, 1)
      this.markDirty()
    },

    /** 设置/更新一条 DMA 分配（M3）。 */
    setDma(entry: DmaConfig) {
      const i = this.dma.findIndex((x) => x.peripheral === entry.peripheral)
      if (i >= 0) this.dma[i] = entry
      else this.dma.push(entry)
      this.markDirty()
    },

    removeDma(peripheral: string) {
      const i = this.dma.findIndex((x) => x.peripheral === peripheral)
      if (i >= 0) this.dma.splice(i, 1)
      this.markDirty()
    },

    /** 类别级冲突策略（M8，对齐 CubeMX2 Automatic Conflict Handling Rules）。 */
    setConflictPolicy(policy: ConflictPolicy) {
      this.conflictPolicy = policy
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

    /** 导入已解析的工程配置：切芯片 → 载入 → 跳到 Pinout（文件导入/拖拽共用）。 */
    openConfig(cfg: ProjectConfig) {
      // 先 switchDevice 清理旧芯片状态，再 loadConfig 写入文件内容
      this.switchDevice(cfg.chip)
      this.loadConfig(cfg)
      this.setView('pinout')
      this.notify(`已导入 ${cfg.projectName}（${cfg.chip}）`, 'info')
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
      this.interrupts = Array.isArray(cfg.interrupts) ? cfg.interrupts : []
      this.dma = Array.isArray(cfg.dma) ? cfg.dma : []
      this.conflictPolicy = cfg.conflictPolicy ?? { mode: 'safe' }
      this.features = { embassy: false, debugPrint: true, ...(cfg.features ?? {}) }
      this.halRev = cfg.hal?.rev ?? HAL_REV
      // 旧工程缺 unlockedPins 时置空；运行时数据可能被手改，过滤掉非字符串
      this.unlocked = Array.isArray(cfg.unlockedPins)
        ? cfg.unlockedPins.filter((p): p is string => typeof p === 'string')
        : []
      this.selectedPin = null
      this.activePeripheralId = null
      this.dirty = false
      this.lastSavedAt = Date.now()
    },

    switchDevice(chip: string) {
      if (chip === this.chip) return
      this.chip = chip
      this.assignments = []
      this.groups = []
      this.peripherals = {}
      this.interrupts = []
      this.dma = []
      this.conflictPolicy = { mode: 'safe' }
      this.clock = null
      this.unlocked = []
      this.selectedPin = null
      this.activePeripheralId = null
      this.markDirty()
    },

    /** 保存到 localStorage（IO 经 projectStorage 服务）。 */
    save() {
      try {
        saveProject(this.config)
        this.dirty = false
        this.lastSavedAt = Date.now()
      } catch (e) {
        this.notify(`保存失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    },

    /** 从 localStorage 恢复。返回是否恢复成功。 */
    restore(): boolean {
      const cfg = loadProject()
      if (!cfg) return false
      this.loadConfig(cfg)
      return true
    },

    setExportSnapshot(files: Record<string, string>) {
      this.lastExportSnapshot = files
    },
  },
})