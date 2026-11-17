// M10 文档模型（浏览器式标签栏）测试：
// - 初始 openViews=['home'] / activeView='home'
// - setView 追加 + 激活（不重复追加）
// - closeView 右邻 / 左邻 / null 三条激活路径
// - 空态 Home 不可关且非 Home 视图被门禁挡住；已打开工程 Home 可关
// - openPeripheral 空态守卫；closePeripheral 不影响 openViews
// - Ctrl+Tab 循环序列 = openViews（纯函数）
// vitest 环境为 node（无 DOM），不需要 localStorage：仅用 markProjectOpened 开工程。
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore, type ViewId } from '@/controllers/project'
import { HOME_ONLY_CYCLE_ORDER, nextViewId } from '@/components/common/useHotkeys'

beforeEach(() => {
  setActivePinia(createPinia())
})

/** 打开工程并追加若干视图标签（home 由初始状态提供）。 */
function openWithViews(views: ViewId[]) {
  const store = useProjectStore()
  store.markProjectOpened()
  for (const view of views) store.setView(view)
  return store
}

describe('文档模型初始状态', () => {
  it('初始只有 Home 标签且 Home 激活', () => {
    const store = useProjectStore()
    expect(store.projectOpened).toBe(false)
    expect(store.openViews).toEqual(['home'])
    expect(store.activeView).toBe('home')
  })
})

describe('setView 追加与激活', () => {
  it('打开视图时追加标签并激活', () => {
    const store = openWithViews(['pinout', 'clock'])
    expect(store.openViews).toEqual(['home', 'pinout', 'clock'])
    expect(store.activeView).toBe('clock')
  })

  it('重复打开同一视图不重复追加，只切换 active', () => {
    const store = openWithViews(['pinout', 'clock'])
    store.setView('pinout')
    expect(store.openViews).toEqual(['home', 'pinout', 'clock'])
    expect(store.activeView).toBe('pinout')
  })

  it('loadConfig 本身不改动 openViews，随后 setView 才追加（restore 路径）', () => {
    const store = useProjectStore()
    store.loadConfig({ projectName: 'restored' })
    expect(store.openViews).toEqual(['home'])
    store.setView('pinout')
    expect(store.openViews).toEqual(['home', 'pinout'])
  })
})

describe('closeView 激活邻居', () => {
  it('关闭 active 标签优先激活右邻', () => {
    const store = openWithViews(['pinout', 'clock'])
    store.setView('pinout')
    store.closeView('pinout')
    expect(store.openViews).toEqual(['home', 'clock'])
    expect(store.activeView).toBe('clock')
  })

  it('没有右邻时激活左邻', () => {
    const store = openWithViews(['pinout', 'clock'])
    store.setView('clock')
    store.closeView('clock')
    expect(store.openViews).toEqual(['home', 'pinout'])
    expect(store.activeView).toBe('pinout')
  })

  it('关闭唯一标签后 activeView=null', () => {
    const store = openWithViews([])
    store.closeView('home')
    expect(store.openViews).toEqual([])
    expect(store.activeView).toBeNull()
  })

  it('关闭非 active 标签不改变当前激活视图', () => {
    const store = openWithViews(['pinout', 'clock'])
    store.setView('clock')
    store.closeView('pinout')
    expect(store.openViews).toEqual(['home', 'clock'])
    expect(store.activeView).toBe('clock')
  })

  it('关闭不存在的标签是空操作', () => {
    const store = openWithViews(['pinout'])
    store.closeView('clock')
    expect(store.openViews).toEqual(['home', 'pinout'])
    expect(store.activeView).toBe('pinout')
  })
})

describe('空态门禁与 Home 可关闭性', () => {
  it('空态下 setView 非 Home 被挡住且不追加标签', () => {
    const store = useProjectStore()
    store.setView('pinout')
    store.setView('project-settings')
    expect(store.openViews).toEqual(['home'])
    expect(store.activeView).toBe('home')
  })

  it('空态下 Home 不可关闭', () => {
    const store = useProjectStore()
    store.closeView('home')
    expect(store.openViews).toEqual(['home'])
    expect(store.activeView).toBe('home')
  })

  it('已打开工程后 Home 可以关闭', () => {
    const store = openWithViews(['pinout'])
    store.setView('home')
    store.closeView('home')
    expect(store.openViews).toEqual(['pinout'])
    expect(store.activeView).toBe('pinout')
  })
})

describe('外设对象标签与 openViews 独立', () => {
  it('空态 openPeripheral 被守卫挡掉', () => {
    const store = useProjectStore()
    store.openPeripheral('usart1')
    expect(store.activePeripheralId).toBeNull()
    expect(store.openViews).toEqual(['home'])
    expect(store.activeView).toBe('home')
  })

  it('打开外设对象页会追加并激活 Peripherals 视图标签', () => {
    const store = openWithViews([])
    store.openPeripheral('usart1')
    expect(store.activePeripheralId).toBe('usart1')
    expect(store.openViews).toEqual(['home', 'peripherals'])
    expect(store.activeView).toBe('peripherals')
  })

  it('重复打开对象页不重复追加 Peripherals 标签', () => {
    const store = openWithViews([])
    store.openPeripheral('usart1')
    store.openPeripheral('usart2')
    expect(store.activePeripheralId).toBe('usart2')
    expect(store.openViews).toEqual(['home', 'peripherals'])
  })

  it('closePeripheral 只清对象页，不影响 openViews', () => {
    const store = openWithViews([])
    store.openPeripheral('usart1')
    store.closePeripheral()
    expect(store.activePeripheralId).toBeNull()
    expect(store.openViews).toEqual(['home', 'peripherals'])
    expect(store.activeView).toBe('peripherals')
  })
})

describe('Ctrl+Tab 循环序列（openViews 纯函数）', () => {
  it('按 openViews 顺序循环（含回绕）', () => {
    const order: ViewId[] = ['home', 'pinout', 'clock']
    expect(nextViewId('home', 1, order)).toBe('pinout')
    expect(nextViewId('clock', 1, order)).toBe('home')
    expect(nextViewId('home', -1, order)).toBe('clock')
  })

  it('current=null（标签全关）时从首项起算', () => {
    expect(nextViewId(null, 1, ['home', 'pinout'])).toBe('home')
    expect(nextViewId(null, -1, ['home', 'pinout'])).toBe('home')
  })

  it('空态序列 HOME_ONLY 只回到 Home', () => {
    expect(nextViewId('home', 1, HOME_ONLY_CYCLE_ORDER)).toBe('home')
    expect(nextViewId(null, 1, HOME_ONLY_CYCLE_ORDER)).toBe('home')
  })

  it('空序列回退 home', () => {
    expect(nextViewId(null, 1, [])).toBe('home')
  })
})
