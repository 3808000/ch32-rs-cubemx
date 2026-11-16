// M9.2 创建工程向导纯函数契约测试：
// 工程名门禁 / 建议名规范化 / 存储位置两分支 / 创建载荷形状。
import { describe, it, expect } from 'vitest'
import {
  PROJECT_STORAGE_SLOT,
  createProjectPayload,
  storagePreview,
  suggestProjectName,
  wizardNameGate,
} from '@/components/home/CreateProjectWizard.vue'

describe('wizardNameGate：第二步必填门禁', () => {
  it('空字符串禁用 Create project', () => {
    expect(wizardNameGate('')).toBe(false)
  })

  it('纯空白（空格/制表/换行）禁用', () => {
    expect(wizardNameGate('   ')).toBe(false)
    expect(wizardNameGate('\t\n ')).toBe(false)
  })

  it('合法名称启用（含首尾空白也视为合法，创建时 trim）', () => {
    expect(wizardNameGate('my-project')).toBe(true)
    expect(wizardNameGate('  ch32 project  ')).toBe(true)
    expect(wizardNameGate('工程')).toBe(true)
  })
})

describe('suggestProjectName：芯片名 → 建议工程名', () => {
  it('芯片名转小写并追加 -project', () => {
    expect(suggestProjectName('CH32V003F4P6')).toBe('ch32v003f4p6-project')
    expect(suggestProjectName('CH32H417QEU6')).toBe('ch32h417qeu6-project')
    expect(suggestProjectName('already-lower')).toBe('already-lower-project')
  })

  it('非法字符折叠为 -，连续/首尾 - 归一', () => {
    expect(suggestProjectName('My Chip!')).toBe('my-chip-project')
    expect(suggestProjectName('  CH32 V203 / C8T6  ')).toBe('ch32-v203-c8t6-project')
    expect(suggestProjectName('--CH32--V003--')).toBe('ch32-v003-project')
  })

  it('空/纯空白芯片名回退 ch32-project', () => {
    expect(suggestProjectName('')).toBe('ch32-project')
    expect(suggestProjectName('   ')).toBe('ch32-project')
    expect(suggestProjectName('!!!')).toBe('ch32-project')
  })
})

describe('storagePreview：存储位置与自动路径', () => {
  it('浏览器分支：localStorage 槽位 + 本地保存说明', () => {
    const preview = storagePreview(false, 'my-project')
    expect(preview.location).toContain('localStorage')
    expect(preview.location).toContain(PROJECT_STORAGE_SLOT)
    expect(preview.path).toBe('localStorage://ch32-rs-cubemx/project/my-project')
    expect(preview.note).toContain('纯本地')
    expect(preview.note).toContain('不上传')
  })

  it('桌面端分支：文案诚实标注磁盘工程库待后续里程碑', () => {
    const preview = storagePreview(true, 'my-project')
    expect(preview.location).toContain('WebView')
    expect(preview.note).toContain('桌面端磁盘工程库待后续里程碑')
    expect(preview.path).toBe('localStorage://ch32-rs-cubemx/project/my-project')
  })

  it('名称为空时路径显示 <name> 占位', () => {
    expect(storagePreview(false).path).toBe('localStorage://ch32-rs-cubemx/project/<name>')
    expect(storagePreview(true, '  ').path).toBe('localStorage://ch32-rs-cubemx/project/<name>')
  })

  it('浏览器与桌面端位置文案不同（两分支可区分）', () => {
    expect(storagePreview(false, 'p').location).not.toBe(storagePreview(true, 'p').location)
    expect(PROJECT_STORAGE_SLOT).toBe('ch32-rs-cubemx:project')
  })
})

describe('createProjectPayload：Create project 载荷', () => {
  it('合法输入返回 { chip, name }，名称 trim', () => {
    expect(createProjectPayload('CH32V003F4P6', '  my-project  ')).toEqual({
      chip: 'CH32V003F4P6',
      name: 'my-project',
    })
  })

  it('未选芯片或空名返回 null', () => {
    expect(createProjectPayload(null, 'my-project')).toBeNull()
    expect(createProjectPayload('CH32V003F4P6', '')).toBeNull()
    expect(createProjectPayload('CH32V003F4P6', '   ')).toBeNull()
  })

  it('载荷形状固定为 chip/name 两个键（HomeView 契约）', () => {
    const payload = createProjectPayload('CH582M', 'ble-demo')
    expect(payload).not.toBeNull()
    expect(Object.keys(payload ?? {}).sort()).toEqual(['chip', 'name'])
  })
})
