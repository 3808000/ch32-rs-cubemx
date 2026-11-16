// UI 偏好持久化服务测试（ROADMAP M5）：默认值、读写、容错、数组防污染、订阅与重置。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PIN_TABLE_COLUMNS,
  UI_PREF_DEFAULTS,
  UI_PREF_STORAGE_KEY,
  getPreference,
  getPreferences,
  resetPreferences,
  setPreference,
  subscribe,
  subscribePreference,
} from '@/services/uiPreferences'

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

function readRaw(): Record<string, unknown> {
  const raw = localStorage.getItem(UI_PREF_STORAGE_KEY)
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

beforeEach(() => {
  installMemoryStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uiPreferences', () => {
  it('空存储返回默认偏好', () => {
    expect(getPreference('pinout.detailVisible')).toBe(true)
    expect(getPreference('pinout.detailWidth')).toBe(360)
    expect(getPreference('clock.codeWidth')).toBe(480)
    expect(getPreference('pinout.table.pageSize')).toBe(25)
    expect(getPreference('pinout.table.visibleColumns')).toEqual([...PIN_TABLE_COLUMNS])
    expect(getPreference('inbox.tab')).toBe('problems')
    expect(getPreference('tabs.healthBadges')).toBe(true)
    expect(getPreference('notifications.lastReadId')).toBeNull()
    expect(getPreferences()).toEqual(UI_PREF_DEFAULTS)
  })

  it('setPreference 写入 localStorage 并可读回', () => {
    setPreference('pinout.detailWidth', 420)
    expect(getPreference('pinout.detailWidth')).toBe(420)
    expect(readRaw()['pinout.detailWidth']).toBe(420)
  })

  it('多次写入按 key 合并，未知 key 原样保留', () => {
    localStorage.setItem(UI_PREF_STORAGE_KEY, JSON.stringify({ 'future.key': { nested: true } }))
    setPreference('pinout.codeWidth', 640)
    setPreference('clock.detailVisible', false)

    expect(getPreference('pinout.codeWidth')).toBe(640)
    expect(getPreference('clock.detailVisible')).toBe(false)
    expect(readRaw()).toEqual({
      'future.key': { nested: true },
      'pinout.codeWidth': 640,
      'clock.detailVisible': false,
    })
  })

  it('损坏 JSON / 非对象数据回退默认值', () => {
    localStorage.setItem(UI_PREF_STORAGE_KEY, '{not json')
    expect(getPreference('pinout.detailVisible')).toBe(true)
    expect(getPreferences()).toEqual(UI_PREF_DEFAULTS)

    localStorage.setItem(UI_PREF_STORAGE_KEY, '[]')
    expect(getPreference('pinout.detailWidth')).toBe(360)

    localStorage.setItem(UI_PREF_STORAGE_KEY, 'null')
    expect(getPreference('inbox.tab')).toBe('problems')
  })

  it('存储中的非法值按 key 回退默认值', () => {
    localStorage.setItem(
      UI_PREF_STORAGE_KEY,
      JSON.stringify({
        'pinout.detailVisible': 'yes',
        'pinout.detailWidth': -1,
        'pinout.table.pageSize': 1.5,
        'pinout.table.visibleColumns': ['name', 'unknown-column'],
        'inbox.tab': 'elsewhere',
        'notifications.lastReadId': 'latest',
      }),
    )

    expect(getPreference('pinout.detailVisible')).toBe(true)
    expect(getPreference('pinout.detailWidth')).toBe(360)
    expect(getPreference('pinout.table.pageSize')).toBe(25)
    expect(getPreference('pinout.table.visibleColumns')).toEqual([...PIN_TABLE_COLUMNS])
    expect(getPreference('inbox.tab')).toBe('problems')
    expect(getPreference('notifications.lastReadId')).toBeNull()
  })

  it('列可见性允许合法子集，但拒绝空数组与重复列', () => {
    setPreference('pinout.table.visibleColumns', ['name', 'state', 'function'])
    expect(getPreference('pinout.table.visibleColumns')).toEqual(['name', 'state', 'function'])

    localStorage.setItem(UI_PREF_STORAGE_KEY, JSON.stringify({ 'pinout.table.visibleColumns': [] }))
    expect(getPreference('pinout.table.visibleColumns')).toEqual([...PIN_TABLE_COLUMNS])

    localStorage.setItem(
      UI_PREF_STORAGE_KEY,
      JSON.stringify({ 'pinout.table.visibleColumns': ['name', 'name'] }),
    )
    expect(getPreference('pinout.table.visibleColumns')).toEqual([...PIN_TABLE_COLUMNS])
  })

  it('数组返回值是副本，修改不会污染默认偏好', () => {
    const columns = getPreference('pinout.table.visibleColumns')
    columns.push('hacked')
    expect(getPreference('pinout.table.visibleColumns')).toEqual([...PIN_TABLE_COLUMNS])
  })

  it('setPreference 拒绝非法值并保持存储不变', () => {
    expect(() => setPreference('pinout.detailWidth', Number.NaN)).toThrow(TypeError)
    expect(() => setPreference('pinout.table.pageSize', 0)).toThrow(TypeError)
    expect(() => setPreference('pinout.table.pageSize', 30)).toThrow(TypeError)
    expect(() => setPreference('pinout.table.usedOnly', 'true' as unknown as boolean)).toThrow(TypeError)
    expect(localStorage.getItem(UI_PREF_STORAGE_KEY)).toBeNull()
  })

  it('subscribe 收到变更 key、新值和完整偏好快照', () => {
    const seen: { key: string; value: unknown; prefs: Record<string, unknown> }[] = []
    const unsubscribe = subscribe((key, value, preferences) => {
      seen.push({ key, value, prefs: preferences as unknown as Record<string, unknown> })
    })

    setPreference('pinout.detailWidth', 520)
    setPreference('tabs.healthBadges', false)

    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({ key: 'pinout.detailWidth', value: 520 })
    expect(seen[1]).toMatchObject({ key: 'tabs.healthBadges', value: false })
    expect(seen[1]?.prefs['pinout.detailWidth']).toBe(520)

    unsubscribe()
    setPreference('pinout.detailWidth', 560)
    expect(seen).toHaveLength(2)
  })

  it('subscribePreference 只响应指定 key', () => {
    const widths: number[] = []
    const unsubscribe = subscribePreference('pinout.codeWidth', (value) => widths.push(value))

    setPreference('pinout.detailWidth', 400)
    setPreference('pinout.codeWidth', 680)
    setPreference('pinout.codeWidth', 700)
    expect(widths).toEqual([680, 700])

    unsubscribe()
    setPreference('pinout.codeWidth', 720)
    expect(widths).toEqual([680, 700])
  })

  it('resetPreferences 删除存储并通知全部 key 恢复默认值', () => {
    setPreference('pinout.codeVisible', true)
    setPreference('inbox.tab', 'notifications')

    const changed: string[] = []
    const unsubscribe = subscribe((key, value) => {
      changed.push(`${key}=${String(value)}`)
    })
    resetPreferences()
    unsubscribe()

    expect(localStorage.getItem(UI_PREF_STORAGE_KEY)).toBeNull()
    expect(getPreferences()).toEqual(UI_PREF_DEFAULTS)
    expect(changed).toHaveLength(Object.keys(UI_PREF_DEFAULTS).length)
    expect(changed).toContain('pinout.codeVisible=false')
    expect(changed).toContain('inbox.tab=problems')
  })

  it('localStorage 不可用时降级为默认值，写入仍通知订阅者', () => {
    vi.stubGlobal('localStorage', undefined)

    expect(getPreference('clock.detailVisible')).toBe(true)
    expect(() => setPreference('clock.detailVisible', false)).not.toThrow()

    const seen: boolean[] = []
    const unsubscribe = subscribePreference('clock.detailVisible', (value) => seen.push(value))
    setPreference('clock.detailVisible', true)
    unsubscribe()
    expect(seen).toEqual([true])
  })
})