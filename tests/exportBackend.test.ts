// M11 导出服务后端分流：backendVendorZip 纯函数契约。
// 导出 ZIP 内嵌的 vendor 源码包必须与芯片 HAL 后端一致（ch32-hal / ch58x-hal），
// 未知后端诚实抛错（prepareExport 前由 generateProject 守卫，不会实际走到）。
import { describe, it, expect } from 'vitest'
import { backendVendorZip } from '@/services/projectExport'

describe('backendVendorZip：HAL 后端 → vendor zip', () => {
  it('缺省后端视为 ch32-hal', () => {
    expect(backendVendorZip()).toBe('ch32-hal.zip')
    expect(backendVendorZip(undefined)).toBe('ch32-hal.zip')
  })

  it('ch32-hal → ch32-hal.zip', () => {
    expect(backendVendorZip('ch32-hal')).toBe('ch32-hal.zip')
  })

  it('ch58x-hal → ch58x-hal.zip', () => {
    expect(backendVendorZip('ch58x-hal')).toBe('ch58x-hal.zip')
  })

  it('未知后端抛错，并在消息中带出后端名', () => {
    expect(() => backendVendorZip('other-hal')).toThrow(/other-hal/)
    expect(() => backendVendorZip('other-hal')).toThrow(/未知 HAL 后端/)
  })

  it('空串不是缺省值（未知后端）', () => {
    expect(() => backendVendorZip('')).toThrow()
  })

  it('zip 文件名前缀与后端目录名一致（vendor/<前缀>/...）', () => {
    for (const backend of ['ch32-hal', 'ch58x-hal']) {
      expect(backendVendorZip(backend)).toBe(`${backend}.zip`)
    }
  })
})
