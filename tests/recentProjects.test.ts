// 最近工程注册表测试（ROADMAP M2.9）：去重、倒序、容量上限、按 id 读取/移除、脏数据容错。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectConfig } from '@/model/types'
import { HAL_REV } from '@/model/codegen/halRev'
import { getRecent, listRecent, removeRecent, touchRecent } from '@/services/recentProjects'

const STORAGE_KEY = 'ch32-rs-cubemx:recent'
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
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('recentProjects', () => {
  it('空存储返回空列表', () => {
    expect(listRecent()).toEqual([])
  })

  it('touchRecent 记录完整 config，并可按 id 取回', () => {
    const config = makeConfig('blink')
    const id = touchRecent(config)

    expect(id).toBe('CH32V003F4P6:blink')
    const entry = getRecent(id)
    expect(entry).toMatchObject({
      id,
      projectName: 'blink',
      chip: 'CH32V003F4P6',
      updatedAt: T0,
    })
    expect(entry?.config).toEqual(config)
  })

  it('同 chip+projectName 去重、更新时间并置顶', () => {
    touchRecent(makeConfig('alpha'))
    vi.setSystemTime(T0 + 1000)
    touchRecent(makeConfig('beta'))
    vi.setSystemTime(T0 + 2000)
    touchRecent(makeConfig('alpha'))

    const list = listRecent()
    expect(list.map((r) => r.projectName)).toEqual(['alpha', 'beta'])
    expect(list[0]?.updatedAt).toBe(T0 + 2000)
    expect(list).toHaveLength(2)
  })

  it('不同芯片的同名工程视为不同条目', () => {
    touchRecent(makeConfig('alpha', 'CH32V003F4P6'))
    touchRecent(makeConfig('alpha', 'CH32V203C8T6'))

    expect(listRecent()).toHaveLength(2)
    expect(getRecent('CH32V003F4P6:alpha')?.chip).toBe('CH32V003F4P6')
    expect(getRecent('CH32V203C8T6:alpha')?.chip).toBe('CH32V203C8T6')
  })

  it('最多保留 10 条并淘汰最旧记录', () => {
    for (let i = 0; i < 12; i++) {
      vi.setSystemTime(T0 + i * 1000)
      touchRecent(makeConfig(`p${i}`))
    }

    const list = listRecent()
    expect(list).toHaveLength(10)
    expect(list.map((r) => r.projectName)).toEqual([
      'p11',
      'p10',
      'p9',
      'p8',
      'p7',
      'p6',
      'p5',
      'p4',
      'p3',
      'p2',
    ])
    expect(getRecent('CH32V003F4P6:p0')).toBeNull()
    expect(getRecent('CH32V003F4P6:p1')).toBeNull()
  })

  it('removeRecent 只移除指定条目', () => {
    const alpha = touchRecent(makeConfig('alpha'))
    touchRecent(makeConfig('beta'))

    removeRecent(alpha)

    expect(getRecent(alpha)).toBeNull()
    expect(listRecent().map((r) => r.projectName)).toEqual(['beta'])
  })

  it('损坏的 JSON 或非数组数据按空列表处理', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(listRecent()).toEqual([])

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectName: 'x' }))
    expect(listRecent()).toEqual([])
  })
})