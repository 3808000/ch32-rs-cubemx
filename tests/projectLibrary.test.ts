// M4.1 浏览器兼容版：多工程库 + 自动保存单测。
// 覆盖：保存/覆盖/打开/删除/重命名、列表排序与脏数据容错、自动保存防抖/去重/取消/失败回调。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ProjectConfig } from '@/model/types'
import { HAL_REV } from '@/model/codegen/halRev'
import { useProjectStore } from '@/controllers/project'
import {
  getLibrary,
  libraryProjectId,
  LibraryConflictError,
  listLibrary,
  listRecent,
  removeLibrary,
  renameLibrary,
  saveToLibrary,
} from '@/services/recentProjects'
import {
  AUTOSAVE_DEBOUNCE_MS,
  currentAutosave,
  loadProject,
  saveProject,
  startAutosave,
  stopAutosave,
} from '@/services/projectStorage'

const LIBRARY_KEY = 'ch32-rs-cubemx:library'
const PROJECT_KEY = 'ch32-rs-cubemx:project'
const T0 = new Date('2026-01-01T00:00:00Z').getTime()

/** 内存版 Storage：Node 测试环境没有 localStorage。 */
function installMemoryStorage(): void {
  const data = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key: string) {
      return data.get(key) ?? null
    },
    key(index: number) {
      return [...data.keys()][index] ?? null
    },
    removeItem(key: string) {
      data.delete(key)
    },
    setItem(key: string, value: string) {
      data.set(key, String(value))
    },
  }
  vi.stubGlobal('localStorage', storage)
}

function makeConfig(projectName: string, chip = 'CH32V003F4P6'): ProjectConfig {
  return {
    version: 1,
    chip,
    projectName,
    pins: [],
    groups: [],
    naming: { prefix: '' },
    clock: { source: 'HSI', ahb: 1, apb1: 1, apb2: 1 },
    peripherals: {},
    features: { embassy: false, debugPrint: true },
    hal: { rev: HAL_REV },
    unlockedPins: [],
  }
}

beforeEach(() => {
  installMemoryStorage()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  // 重置 projectStorage 的“最近写入快照”：空存储时 loadProject 会清空缓存
  loadProject()
})

afterEach(() => {
  stopAutosave()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('工程库', () => {
  it('保存完整配置与元数据，并同步进入最近工程', () => {
    const config = makeConfig('blink')
    const entry = saveToLibrary(config)

    expect(entry).toMatchObject({
      id: libraryProjectId('CH32V003F4P6', 'blink'),
      projectName: 'blink',
      chip: 'CH32V003F4P6',
      updatedAt: T0,
      createdAt: T0,
    })
    expect(entry.config).toEqual(config)
    expect(getLibrary(entry.id)?.config).toEqual(config)
    expect(listLibrary()).toHaveLength(1)
    // 显式保存同时刷新最近工程（保留 M2.9 MRU 语义）
    expect(listRecent().map((r) => r.projectName)).toEqual(['blink'])
  })

  it('名称空白回退 ch32-project，并写回 config.projectName', () => {
    const entry = saveToLibrary(makeConfig('   '))
    expect(entry.projectName).toBe('ch32-project')
    expect(entry.config.projectName).toBe('ch32-project')
  })

  it('同名工程未授权覆盖时抛 LibraryConflictError', () => {
    saveToLibrary(makeConfig('alpha'))
    expect(() => saveToLibrary(makeConfig('alpha'))).toThrow(LibraryConflictError)
    expect(listLibrary()).toHaveLength(1)
  })

  it('覆盖保存保留 createdAt、更新 config/updatedAt 且不产生重复条目', () => {
    saveToLibrary(makeConfig('alpha'))
    vi.setSystemTime(T0 + 5000)
    const changed = makeConfig('alpha')
    changed.naming.prefix = 'led_'
    const entry = saveToLibrary(changed, { overwrite: true })

    expect(entry.createdAt).toBe(T0)
    expect(entry.updatedAt).toBe(T0 + 5000)
    expect(entry.config.naming.prefix).toBe('led_')
    expect(listLibrary()).toHaveLength(1)
    expect(getLibrary(entry.id)?.config.naming.prefix).toBe('led_')
  })

  it('不同芯片的同名工程独立保存', () => {
    saveToLibrary(makeConfig('alpha', 'CH32V003F4P6'))
    saveToLibrary(makeConfig('alpha', 'CH32V203C8T6'))

    expect(listLibrary()).toHaveLength(2)
    expect(getLibrary(libraryProjectId('CH32V003F4P6', 'alpha'))?.chip).toBe('CH32V003F4P6')
    expect(getLibrary(libraryProjectId('CH32V203C8T6', 'alpha'))?.chip).toBe('CH32V203C8T6')
  })

  it('列表按 updatedAt 倒序', () => {
    saveToLibrary(makeConfig('alpha'))
    vi.setSystemTime(T0 + 1000)
    saveToLibrary(makeConfig('beta'))
    vi.setSystemTime(T0 + 2000)
    saveToLibrary(makeConfig('alpha'), { overwrite: true })

    expect(listLibrary().map((p) => p.projectName)).toEqual(['alpha', 'beta'])
  })

  it('重命名同步 id/config 与最近工程，并保留其它条目', () => {
    const alpha = saveToLibrary(makeConfig('alpha'))
    saveToLibrary(makeConfig('beta'))
    vi.setSystemTime(T0 + 3000)

    const updated = renameLibrary(alpha.id, 'gamma')

    expect(updated.id).toBe(libraryProjectId('CH32V003F4P6', 'gamma'))
    expect(updated.projectName).toBe('gamma')
    expect(updated.config.projectName).toBe('gamma')
    expect(updated.updatedAt).toBe(T0 + 3000)
    expect(getLibrary(alpha.id)).toBeNull()
    expect(getLibrary(updated.id)?.projectName).toBe('gamma')
    expect(listLibrary().map((p) => p.projectName)).toEqual(['gamma', 'beta'])
    // 旧 MRU 记录被新名称替换，不会同时出现 alpha/gamma
    expect(listRecent().map((r) => r.projectName)).toEqual(['gamma', 'beta'])
  })

  it('重命名为其它条目已用名称时抛 LibraryConflictError', () => {
    const alpha = saveToLibrary(makeConfig('alpha'))
    saveToLibrary(makeConfig('beta'))

    expect(() => renameLibrary(alpha.id, 'beta')).toThrow(LibraryConflictError)
    expect(getLibrary(libraryProjectId('CH32V003F4P6', 'alpha'))).not.toBeNull()
  })

  it('空名称或不存在条目重命名时报错', () => {
    const alpha = saveToLibrary(makeConfig('alpha'))
    expect(() => renameLibrary(alpha.id, '   ')).toThrow('工程名称不能为空')
    expect(() => renameLibrary('CH32V003F4P6:missing', 'x')).toThrow('工程不存在')
  })

  it('删除只移除工程库条目，不影响最近工程', () => {
    const alpha = saveToLibrary(makeConfig('alpha'))
    vi.setSystemTime(T0 + 1000)
    saveToLibrary(makeConfig('beta'))

    removeLibrary(alpha.id)

    expect(listLibrary().map((p) => p.projectName)).toEqual(['beta'])
    expect(getLibrary(alpha.id)).toBeNull()
    expect(listRecent().map((r) => r.projectName)).toEqual(['beta', 'alpha'])
  })

  it('损坏 JSON 与非数组/非法条目按空或过滤处理', () => {
    localStorage.setItem(LIBRARY_KEY, '{not json')
    expect(listLibrary()).toEqual([])

    localStorage.setItem(LIBRARY_KEY, JSON.stringify({ projectName: 'x' }))
    expect(listLibrary()).toEqual([])

    localStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify([
        { id: 'ok', projectName: 'ok', chip: 'CH32V003F4P6', updatedAt: T0, config: makeConfig('ok') },
        { id: 'bad', projectName: 'bad' },
      ]),
    )
    const list = listLibrary()
    expect(list).toHaveLength(1)
    // 旧数据缺 createdAt 时用 updatedAt 补齐
    expect(list[0]?.createdAt).toBe(T0)
  })
})

describe('自动保存（projectStorage）', () => {
  it('dirty 后按默认防抖 2s 写入 localStorage 并回调 onSaved', () => {
    const config = ref(makeConfig('autosave'))
    const dirty = ref(false)
    const onSaved = vi.fn()
    startAutosave(() => config.value, () => dirty.value, { onSaved })

    dirty.value = true
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1)
    expect(localStorage.getItem(PROJECT_KEY)).toBeNull()
    expect(onSaved).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(JSON.parse(localStorage.getItem(PROJECT_KEY) ?? '{}')).toMatchObject({
      projectName: 'autosave',
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith(T0 + AUTOSAVE_DEBOUNCE_MS)
    expect(currentAutosave()?.lastSavedAt).toBe(T0 + AUTOSAVE_DEBOUNCE_MS)
  })

  it('dirty 保持 true 时连续编辑会重新计时（最终只写最后状态）', () => {
    const config = ref(makeConfig('v1'))
    const dirty = ref(false)
    startAutosave(() => config.value, () => dirty.value, { debounceMs: 1000 })

    dirty.value = true
    vi.advanceTimersByTime(600)
    config.value = makeConfig('v2')
    vi.advanceTimersByTime(600)
    // 距首次变脏已 1200ms，但距最后一次编辑仅 600ms：尚未写入
    expect(localStorage.getItem(PROJECT_KEY)).toBeNull()

    vi.advanceTimersByTime(400)
    expect(JSON.parse(localStorage.getItem(PROJECT_KEY) ?? '{}').projectName).toBe('v2')
  })

  it('dirty 变回 false（手动保存/openConfig）会取消待执行保存', () => {
    const config = ref(makeConfig('manual'))
    const dirty = ref(false)
    const onSaved = vi.fn()
    startAutosave(() => config.value, () => dirty.value, { debounceMs: 1000, onSaved })

    dirty.value = true
    vi.advanceTimersByTime(500)
    dirty.value = false // 模拟 controller.save()/loadConfig()
    vi.advanceTimersByTime(5000)

    expect(onSaved).not.toHaveBeenCalled()
    expect(localStorage.getItem(PROJECT_KEY)).toBeNull()
  })

  it('与手动 saveProject 内容一致时不重复写盘', () => {
    const config = ref(makeConfig('same'))
    const dirty = ref(false)
    const onSaved = vi.fn()
    startAutosave(() => config.value, () => dirty.value, { debounceMs: 1000, onSaved })

    saveProject(config.value) // 模拟 Ctrl+S 已写入
    dirty.value = true
    vi.advanceTimersByTime(1000)

    expect(onSaved).not.toHaveBeenCalled()
  })

  it('flush 立即保存未写入的 dirty 配置', () => {
    const config = ref(makeConfig('flush'))
    const dirty = ref(false)
    startAutosave(() => config.value, () => dirty.value, { debounceMs: 5000 })

    dirty.value = true
    currentAutosave()?.flush()

    expect(JSON.parse(localStorage.getItem(PROJECT_KEY) ?? '{}').projectName).toBe('flush')
  })

  it('stop 取消待执行保存并允许重新启动', () => {
    const config = ref(makeConfig('stop'))
    const dirty = ref(false)
    const handle = startAutosave(() => config.value, () => dirty.value, { debounceMs: 1000 })

    dirty.value = true
    handle.stop()
    vi.advanceTimersByTime(5000)
    expect(localStorage.getItem(PROJECT_KEY)).toBeNull()
    expect(handle.active).toBe(false)
    expect(currentAutosave()).toBeNull()

    // 重新启动（reset 快照避免沿用上一轮）
    loadProject()
    const second = startAutosave(() => config.value, () => dirty.value, { debounceMs: 1000 })
    second.flush()
    expect(JSON.parse(localStorage.getItem(PROJECT_KEY) ?? '{}').projectName).toBe('stop')
  })

  it('重复 startAutosave 幂等，返回同一句柄', () => {
    const config = ref(makeConfig('idempotent'))
    const dirty = ref(false)
    const first = startAutosave(() => config.value, () => dirty.value)
    const second = startAutosave(() => config.value, () => dirty.value)
    expect(second).toBe(first)
  })

  it('localStorage 写入失败时调用 onError 且不抛出', () => {
    const config = ref(makeConfig('quota'))
    const dirty = ref(false)
    const onError = vi.fn()
    const failing: Storage = {
      get length() {
        return 0
      },
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    vi.stubGlobal('localStorage', failing)
    startAutosave(() => config.value, () => dirty.value, { debounceMs: 1000, onError })

    dirty.value = true
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('QuotaExceededError')
  })

  it('真实 store 集成：配置变更后自动落盘并回填 dirty/lastSavedAt', () => {
    setActivePinia(createPinia())
    const store = useProjectStore()
    const onSaved = vi.fn((at: number) => {
      // 与 HomeView 的接线一致：保存成功后清除 dirty 并记录时间
      store.$patch({ dirty: false, lastSavedAt: at })
    })
    startAutosave(() => store.config, () => store.dirty, { debounceMs: 1000, onSaved })

    store.setProjectName('store-auto')
    expect(store.dirty).toBe(true)
    vi.advanceTimersByTime(1000)

    expect(JSON.parse(localStorage.getItem(PROJECT_KEY) ?? '{}').projectName).toBe('store-auto')
    expect(store.dirty).toBe(false)
    expect(store.lastSavedAt).toBe(T0 + 1000)
    expect(onSaved).toHaveBeenCalledTimes(1)
  })
})