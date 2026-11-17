// M10 桌面磁盘工程库纯函数测试：目录名 slug/穿越防护、索引校验/合并/排序、
// 最近工程筛选、索引路径推导，以及“浏览器路径不受磁盘纯函数影响”。
// 磁盘 IO 依赖 Tauri invoke（桌面运行期），此处只覆盖可离线验证的纯函数层。
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isDiskProjectEntry,
  joinFsPath,
  mergeProjectIndexEntry,
  normalizeProjectIndex,
  projectDirName,
  projectIndexPath,
  selectRecentEntries,
  sortProjectEntries,
  type DiskProjectEntry,
} from '@/services/recentProjects'

const T0 = new Date('2026-01-01T00:00:00Z').getTime()

function makeEntry(overrides: Partial<DiskProjectEntry> = {}): DiskProjectEntry {
  return {
    id: 'CH32V003F4P6:blink',
    name: 'blink',
    chip: 'CH32V003F4P6',
    dir: '/home/u/.config/ch32-rs-cubemx/projects/blink',
    updatedAt: T0,
    lastOpened: T0,
    ...overrides,
  }
}

/** 内存版 Storage：Node 测试环境没有 localStorage。 */
function installMemoryStorage(): Map<string, string> {
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
  return data
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('projectDirName：工程名 → 磁盘目录名', () => {
  it('常规名称转小写、空白/标点折叠为 -', () => {
    expect(projectDirName('My Project')).toBe('my-project')
    expect(projectDirName('  CH32 V203 / C8T6  ')).toBe('ch32-v203-c8t6')
    expect(projectDirName('led_blink.v2')).toBe('led_blink.v2')
  })

  it('路径分隔符与 .. 被折叠，无法穿越目录', () => {
    expect(projectDirName('../../etc/passwd')).toBe('etc-passwd')
    expect(projectDirName('..\\..\\Windows\\system32')).toBe('windows-system32')
    expect(projectDirName('/etc/shadow')).toBe('etc-shadow')
    expect(projectDirName('a/../../b')).toBe('a-b')
    // 结果永远不是 '.' / '..'，且不含分隔符
    for (const raw of ['..', '.', '../..', 'C:\\x']) {
      const name = projectDirName(raw)
      expect(name).not.toBe('.')
      expect(name).not.toBe('..')
      expect(/[\\/]/.test(name)).toBe(false)
    }
  })

  it('空/纯空白/全非法回退 project，首尾 -/.(含控制字符) 归一', () => {
    expect(projectDirName('')).toBe('project')
    expect(projectDirName('   ')).toBe('project')
    expect(projectDirName('///')).toBe('project')
    expect(projectDirName('\u0000\u0001')).toBe('project')
    expect(projectDirName('--name--')).toBe('name')
    expect(projectDirName('.hidden.')).toBe('hidden')
  })

  it('超长名称截断到 64 字符且不保留尾部 -', () => {
    const name = projectDirName('a'.repeat(80))
    expect(name).toHaveLength(64)
    expect(projectDirName(`${'a'.repeat(63)}-b`)).toHaveLength(63)
  })

  it('保留非 ASCII 名称中的合法字符（中文不被整体丢弃）', () => {
    expect(projectDirName('测试工程')).toBe('测试工程')
    expect(projectDirName('测试 工程/1')).toBe('测试-工程-1')
  })
})

describe('路径工具', () => {
  it('joinFsPath 处理相对子路径与尾部分隔符', () => {
    expect(joinFsPath('/a/b/', 'c')).toBe('/a/b/c')
    expect(joinFsPath('/a/b', '/cube.json')).toBe('/a/b/cube.json')
    expect(joinFsPath('/a/b', '')).toBe('/a/b')
    expect(joinFsPath('', 'a/b')).toBe('a/b')
    expect(joinFsPath('C:\\Users\\me\\', 'proj')).toBe('C:\\Users\\me\\proj')
  })

  it('projectIndexPath 取工程库根目录的父目录 + projects.json', () => {
    expect(projectIndexPath('/home/u/.config/ch32-rs-cubemx/projects')).toBe(
      '/home/u/.config/ch32-rs-cubemx/projects.json',
    )
    expect(projectIndexPath('/home/u/.config/ch32-rs-cubemx/projects/')).toBe(
      '/home/u/.config/ch32-rs-cubemx/projects.json',
    )
    expect(projectIndexPath('relative/projects')).toBe('relative/projects.json')
    expect(projectIndexPath('')).toBe('projects.json')
  })
})

describe('索引条目校验', () => {
  it('合法条目通过；缺失/非字符串/非数字字段被拒绝', () => {
    expect(isDiskProjectEntry(makeEntry())).toBe(true)
    expect(isDiskProjectEntry(makeEntry({ id: '' }))).toBe(false)
    expect(isDiskProjectEntry(makeEntry({ name: '   ' }))).toBe(false)
    expect(isDiskProjectEntry(makeEntry({ chip: '' }))).toBe(false)
    expect(isDiskProjectEntry(makeEntry({ dir: '' }))).toBe(false)
    expect(isDiskProjectEntry({ ...makeEntry(), updatedAt: 'now' })).toBe(false)
    expect(isDiskProjectEntry({ ...makeEntry(), updatedAt: Number.NaN })).toBe(false)
    expect(isDiskProjectEntry({ ...makeEntry(), lastOpened: 'x' })).toBe(false)
    expect(isDiskProjectEntry(null)).toBe(false)
    expect(isDiskProjectEntry(['x'])).toBe(false)
    expect(isDiskProjectEntry('x')).toBe(false)
  })
})

describe('normalizeProjectIndex：校验/合并/排序', () => {
  it('过滤非法项，容忍裸数组与 { entries } 两种形态', () => {
    const good = makeEntry()
    const raw = [
      good,
      { id: 'bad' },
      null,
      'x',
      {
        ...makeEntry({ id: 'CH32V003F4P6:beta', name: 'beta', dir: '/p/beta', updatedAt: T0 - 1000 }),
      },
    ]
    expect(normalizeProjectIndex(raw).map((e) => e.name)).toEqual(['blink', 'beta'])
    expect(normalizeProjectIndex({ version: 1, entries: [good] })).toHaveLength(1)
    expect(normalizeProjectIndex({ entries: 'nope' })).toEqual([])
    expect(normalizeProjectIndex(null)).toEqual([])
  })

  it('同 id 保留 updatedAt 最新的一条', () => {
    const older = makeEntry({ updatedAt: T0 })
    const newer = makeEntry({ updatedAt: T0 + 5000, dir: '/p/blink-v2' })
    const list = normalizeProjectIndex([older, newer])
    expect(list).toHaveLength(1)
    expect(list[0]?.updatedAt).toBe(T0 + 5000)
    expect(list[0]?.dir).toBe('/p/blink-v2')
  })

  it('不同 id 指向同一目录时只保留最新（重命名残留清理）', () => {
    const oldName = makeEntry({ id: 'CH32V003F4P6:old', name: 'old', updatedAt: T0 })
    const renamed = makeEntry({ id: 'CH32V003F4P6:new', name: 'new', updatedAt: T0 + 1000 })
    const list = normalizeProjectIndex([oldName, renamed])
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('new')
  })

  it('旧索引缺 lastOpened 时兼容为 0', () => {
    const legacy: Record<string, unknown> = { ...makeEntry() }
    delete legacy.lastOpened
    const list = normalizeProjectIndex([legacy])
    expect(list).toHaveLength(1)
    expect(list[0]?.lastOpened).toBe(0)
  })

  it('mergeProjectIndexEntry 按 id/目录 upsert 并保持倒序', () => {
    const alpha = makeEntry({ id: 'CH32V003F4P6:alpha', name: 'alpha', dir: '/p/alpha' })
    const beta = makeEntry({ id: 'CH32V003F4P6:beta', name: 'beta', dir: '/p/beta', updatedAt: T0 + 1000 })
    const merged = mergeProjectIndexEntry([alpha], beta)
    expect(merged.map((e) => e.name)).toEqual(['beta', 'alpha'])

    // 同名同目录覆盖：不产生重复
    const touched = { ...alpha, updatedAt: T0 + 2000 }
    const overwritten = mergeProjectIndexEntry(merged, touched)
    expect(overwritten).toHaveLength(2)
    expect(overwritten[0]?.name).toBe('alpha')
    expect(overwritten[0]?.updatedAt).toBe(T0 + 2000)

    // 同目录改名（id 变化）：旧条目被替换，目录唯一
    const renamed = { ...alpha, id: 'CH32V003F4P6:gamma', name: 'gamma', updatedAt: T0 + 3000 }
    const afterRename = mergeProjectIndexEntry(overwritten, renamed)
    expect(afterRename.filter((e) => e.dir === '/p/alpha')).toHaveLength(1)
    expect(afterRename.find((e) => e.dir === '/p/alpha')?.name).toBe('gamma')
  })

  it('sortProjectEntries 按 updatedAt 倒序且不改入参', () => {
    const a = makeEntry({ id: 'a', dir: '/p/a', updatedAt: T0 })
    const b = makeEntry({ id: 'b', dir: '/p/b', updatedAt: T0 + 100 })
    const input = [a, b]
    expect(sortProjectEntries(input).map((e) => e.id)).toEqual(['b', 'a'])
    expect(input.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('selectRecentEntries：最近工程筛选', () => {
  it('过滤 lastOpened=0，按最近打开倒序并限制 10 条', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      makeEntry({
        id: `chip:p${i}`,
        name: `p${i}`,
        dir: `/p/${i}`,
        updatedAt: T0 + i,
        lastOpened: T0 + i,
      }),
    )
    entries.push(makeEntry({ id: 'chip:never', dir: '/p/never', lastOpened: 0 }))
    const recent = selectRecentEntries(entries)
    expect(recent).toHaveLength(10)
    expect(recent[0]?.name).toBe('p11')
    expect(recent.some((e) => e.name === 'never')).toBe(false)
  })
})

describe('浏览器路径不受磁盘纯函数影响', () => {
  it('调用目录名/索引/排序纯函数不会写 localStorage', () => {
    const data = installMemoryStorage()
    projectDirName('../../x')
    joinFsPath('/a', 'b')
    projectIndexPath('/a/projects')
    normalizeProjectIndex([makeEntry()])
    mergeProjectIndexEntry([], makeEntry())
    sortProjectEntries([makeEntry()])
    selectRecentEntries([makeEntry()])
    expect(data.size).toBe(0)
  })
})
