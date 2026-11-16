// unlockedPins 往返持久化测试（ROADMAP M1.5）：
// 解锁特殊引脚 → config 快照 → serialize → parse → loadConfig 全链路一致；
// 兼容旧工程（缺字段）与手改数据（非字符串项）。
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ProjectConfig } from '@/model/types'
import { useProjectStore } from '@/controllers/project'
import { parseProjectFile, serializeProjectFile } from '@/services/projectFile'

/** 每个用例使用独立的 Pinia 实例，避免 store 状态串扰 */
function freshStore() {
  setActivePinia(createPinia())
  return useProjectStore()
}

function parseOk(text: string): ProjectConfig {
  const result = parseProjectFile(text)
  if ('error' in result) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.config
}

describe('unlockedPins 往返持久化', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('解锁 → serialize → parse → loadConfig 往返一致', () => {
    const store = useProjectStore()
    store.unlockSpecial('PD7')
    store.unlockSpecial('PD1')
    store.unlockSpecial('PA1')

    const text = serializeProjectFile(store.config)
    expect(JSON.parse(text).unlockedPins).toEqual(['PD7', 'PD1', 'PA1'])

    const cfg = parseOk(text)
    const restored = freshStore()
    restored.loadConfig(cfg)

    expect(restored.unlocked).toEqual(['PD7', 'PD1', 'PA1'])
    expect(restored.config.unlockedPins).toEqual(['PD7', 'PD1', 'PA1'])
  })

  it('未解锁时 config 仍输出空数组并往返为空数组', () => {
    const store = useProjectStore()
    const text = serializeProjectFile(store.config)
    expect(JSON.parse(text).unlockedPins).toEqual([])

    const restored = freshStore()
    restored.loadConfig(parseOk(text))
    expect(restored.unlocked).toEqual([])
  })

  it('旧 cube.json 缺 unlockedPins：解析为空数组，导入后 unlocked 为空', () => {
    const cfg = parseOk(JSON.stringify({ version: 1, chip: 'CH32V003F4P6' }))
    expect(cfg.unlockedPins).toEqual([])

    const store = useProjectStore()
    store.unlockSpecial('PD7')
    store.loadConfig(cfg)
    expect(store.unlocked).toEqual([])
  })

  it('loadConfig 过滤非字符串项（手改/旧数据防御）', () => {
    const store = useProjectStore()
    store.loadConfig({
      chip: 'CH32V003F4P6',
      unlockedPins: ['PD7', 42, null, { pin: 'PD1' }, 'PA1'] as unknown as string[],
    })
    expect(store.unlocked).toEqual(['PD7', 'PA1'])
  })

  it('switchDevice 清空解锁状态', () => {
    const store = useProjectStore()
    store.unlockSpecial('PD7')
    store.switchDevice('CH32V203C8T6')

    expect(store.unlocked).toEqual([])
    expect(store.config.unlockedPins).toEqual([])
  })

  it('openConfig 导入文件时保留 unlockedPins', () => {
    const store = useProjectStore()
    store.openConfig({
      version: 1,
      chip: 'CH32V203C8T6',
      projectName: 'demo',
      pins: [],
      naming: { prefix: '' },
      features: { embassy: false, debugPrint: true },
      hal: { rev: 'test' },
      unlockedPins: ['PD0'],
    })

    expect(store.unlocked).toEqual(['PD0'])
    expect(store.config.unlockedPins).toEqual(['PD0'])
  })
})