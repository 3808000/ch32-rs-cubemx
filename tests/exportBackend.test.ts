// M11/M17 导出服务后端分流：backendVendorZip / bleVendorZip 纯函数契约。
// 导出 ZIP 内嵌的 vendor 源码包必须与芯片 HAL 后端一致（ch32-hal / ch58x-hal / ch5xx-hal），
// 未知后端诚实抛错（prepareExport 前由 generateProject 守卫，不会实际走到）。
import { describe, it, expect } from 'vitest'
import { backendVendorZip, bleVendorZip } from '@/services/projectExport'

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

  it('ch5xx-hal → ch5xx-hal.zip（M17 默认后端）', () => {
    expect(backendVendorZip('ch5xx-hal')).toBe('ch5xx-hal.zip')
  })

  it('未知后端抛错，并在消息中带出后端名', () => {
    expect(() => backendVendorZip('other-hal')).toThrow(/other-hal/)
    expect(() => backendVendorZip('other-hal')).toThrow(/未知 HAL 后端/)
  })

  it('空串不是缺省值（未知后端）', () => {
    expect(() => backendVendorZip('')).toThrow()
  })

  it('zip 文件名前缀与后端目录名一致（vendor/<前缀>/...）', () => {
    for (const backend of ['ch32-hal', 'ch58x-hal', 'ch5xx-hal']) {
      expect(backendVendorZip(backend)).toBe(`${backend}.zip`)
    }
  })
})

describe('bleVendorZip：ch5xx BLE shim → ch5xx-ble.zip', () => {
  it('ch5xx-hal → ch5xx-ble.zip（仅 BLE 档内嵌，非 BLE 不嵌）', () => {
    expect(bleVendorZip('ch5xx-hal')).toBe('ch5xx-ble.zip')
  })

  it('非 ch5xx 后端明确抛错（shim 无 git 上游，只随 ch5xx 导出）', () => {
    expect(() => bleVendorZip('ch58x-hal')).toThrow(/仅随 ch5xx-hal/)
    expect(() => bleVendorZip('ch32-hal')).toThrow(/仅随 ch5xx-hal/)
    expect(() => bleVendorZip()).toThrow(/仅随 ch5xx-hal/)
  })
})
