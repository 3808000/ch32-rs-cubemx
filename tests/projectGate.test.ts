// M10 未开工程空态门禁测试：
// - 空态初始 projectOpened=false / activeView='home'
// - setView 守卫：工程打开前只允许 Home
// - markProjectOpened / loadConfig / openConfig / restore 正确置位
// - switchDevice 不改 projectOpened
// - Ctrl+Tab 循环序列在空态只含 Home（useHotkeys 纯函数）
// vitest 环境为 node（无 DOM）：localStorage 用内存版 Storage 打桩。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore, type ViewId } from '@/controllers/project'
import type { ProjectConfig } from '@/model/types'
import {
  HOME_ONLY_CYCLE_ORDER,
  VIEW_CYCLE_ORDER,
  cycleOrder,
  nextViewId,
} from '@/components/common/useHotkeys'

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

beforeEach(() => {
  installMemoryStorage()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 未开工程时被门禁挡住的固定视图。 */
const LOCKED_VIEWS: ViewId[] = ['pinout', 'clock', 'peripherals', 'project-settings']

describe('空态初始状态与 setView 守卫', () => {
  it('初始 projectOpened=false、activeView=home', () => {
    const store = useProjectStore()
    expect(store.projectOpened).toBe(false)
    expect(store.activeView).toBe('home')
  })

  it('空态下 setView 对非 Home 视图全部被守卫挡掉', () => {
    const store = useProjectStore()
    for (const view of LOCKED_VIEWS) {
      store.setView(view)
      expect(store.activeView).toBe('home')
    }
  })

  it('空态下 setView(home) 允许（保持 Home）', () => {
    const store = useProjectStore()
    store.setView('home')
    expect(store.activeView).toBe('home')
  })

  it('markProjectOpened 只置位门禁，不改当前视图；之后 setView 生效', () => {
    const store = useProjectStore()
    store.markProjectOpened()
    expect(store.projectOpened).toBe(true)
    expect(store.activeView).toBe('home')

    store.setView('pinout')
    expect(store.activeView).toBe('pinout')
    store.setView('clock')
    expect(store.activeView).toBe('clock')
    store.setView('project-settings')
    expect(store.activeView).toBe('project-settings')
  })
})

describe('loadConfig / switchDevice 与门禁', () => {
  it('loadConfig 置 projectOpened=true，随后可切视图', () => {
    const store = useProjectStore()
    store.loadConfig({ projectName: 'imported' })
    expect(store.projectOpened).toBe(true)
    expect(store.projectName).toBe('imported')

    store.setView('peripherals')
    expect(store.activeView).toBe('peripherals')
  })

  it('switchDevice 不置 projectOpened（空态保持关闭）', () => {
    const store = useProjectStore()
    store.switchDevice('CH32V203C8T6')
    expect(store.chip).toBe('CH32V203C8T6')
    expect(store.projectOpened).toBe(false)

    // 守卫仍然有效
    store.setView('pinout')
    expect(store.activeView).toBe('home')
  })

  it('工程已打开后 switchDevice 仍保持已打开', () => {
    const store = useProjectStore()
    store.markProjectOpened()
    store.switchDevice('CH32V203C8T6')
    expect(store.projectOpened).toBe(true)
  })

  it('openConfig 打开工程并跳到 Pinout', () => {
    const store = useProjectStore()
    const cfg: ProjectConfig = {
      version: 1,
      chip: 'CH32V203C8T6',
      projectName: 'from-file',
      pins: [],
      groups: [],
      naming: { prefix: '' },
      peripherals: {},
      features: { embassy: false, debugPrint: true },
      hal: { rev: store.halRev },
      unlockedPins: [],
    }
    store.openConfig(cfg)
    expect(store.projectOpened).toBe(true)
    expect(store.activeView).toBe('pinout')
  })
})

describe('restore 与空态', () => {
  it('无存档时 restore 返回 false 且不开工程（保持 Home 空态）', () => {
    const store = useProjectStore()
    expect(store.restore()).toBe(false)
    expect(store.projectOpened).toBe(false)
    expect(store.activeView).toBe('home')

    store.setView('pinout')
    expect(store.activeView).toBe('home')
  })

  it('有存档时 restore 返回 true 并置 projectOpened，随后 setView(pinout) 生效', () => {
    const first = useProjectStore()
    first.markProjectOpened()
    first.setProjectName('saved-project')
    first.save()

    // 新 Pinia 实例模拟应用重启
    setActivePinia(createPinia())
    const store = useProjectStore()
    expect(store.restore()).toBe(true)
    expect(store.projectOpened).toBe(true)
    expect(store.projectName).toBe('saved-project')

    store.setView('pinout')
    expect(store.activeView).toBe('pinout')
  })
})

describe('Ctrl+Tab 循环序列（空态只有 Home）', () => {
  it('cycleOrder 按门禁状态切换序列', () => {
    expect(cycleOrder(false)).toBe(HOME_ONLY_CYCLE_ORDER)
    expect(cycleOrder(true)).toBe(VIEW_CYCLE_ORDER)
  })

  it('空态下前进/后退都回到 Home（不会卡在不可达视图）', () => {
    expect(nextViewId('home', 1, HOME_ONLY_CYCLE_ORDER)).toBe('home')
    expect(nextViewId('home', -1, HOME_ONLY_CYCLE_ORDER)).toBe('home')
    // 异常残留的当前视图也能收敛回 Home
    expect(nextViewId('clock', 1, HOME_ONLY_CYCLE_ORDER)).toBe('home')
    expect(nextViewId('project-settings', -1, HOME_ONLY_CYCLE_ORDER)).toBe('home')
  })

  it('已打开工程保持五标签循环（含回绕）', () => {
    expect(nextViewId('home', 1)).toBe('pinout')
    expect(nextViewId('project-settings', 1)).toBe('home')
    expect(nextViewId('home', -1)).toBe('project-settings')
    expect(nextViewId('clock', 1)).toBe('peripherals')
  })
})
