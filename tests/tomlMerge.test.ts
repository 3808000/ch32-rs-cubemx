// Cargo.toml 标记区合并测试：生成一次语义、区间替换、用户内容保留与空白容错。
import { describe, expect, it } from 'vitest'
import {
  GENERATED_END_MARKER,
  GENERATED_START_MARKER,
  extractGeneratedRegion,
  hasGeneratedMarkers,
  mergeCargoToml,
} from '@/services/tomlMerge'

/** 构造带标记区的生成结果（模拟生成器产出的 Cargo.toml）。 */
function generated(version = '0.1.0'): string {
  return [
    GENERATED_START_MARKER,
    '# 由 ch32-rs-CubeMX 生成 —— 重新导出只更新标记区内内容（标记区外内容会保留）',
    '[package]',
    'name = "demo"',
    `version = "${version}"`,
    '',
    '[dependencies]',
    'ch32-hal = "0.1"',
    GENERATED_END_MARKER,
    '',
  ].join('\n')
}

describe('mergeCargoToml', () => {
  it('用户自有 Cargo.toml（不含标记区）原样返回，不覆盖', () => {
    const existing = '[package]\nname = "mine"\n\n[dependencies]\nserde = "1"\n'
    expect(mergeCargoToml(existing, generated())).toBe(existing)
  })

  it('existing 含标记区：只替换区间内容，标记区外用户内容保留', () => {
    const existing = [
      '# 用户文件头（标记区外）',
      GENERATED_START_MARKER,
      '[package]',
      'name = "demo"',
      'version = "0.0.0"',
      GENERATED_END_MARKER,
      '',
      '[dependencies]',
      'my-crate = "1.2"',
      '',
    ].join('\n')

    const merged = mergeCargoToml(existing, generated('0.2.0'))
    expect(merged).toContain('# 用户文件头（标记区外）')
    expect(merged).toContain('my-crate = "1.2"')
    expect(merged).toContain('version = "0.2.0"')
    expect(merged).not.toContain('version = "0.0.0"')
    // 标记行数量不变（没有被重复插入）
    expect(merged.match(/>>> ch32-cubemx generated >>>/g)).toHaveLength(1)
    expect(merged.match(/<<< ch32-cubemx generated <<</g)).toHaveLength(1)
  })

  it('用户加依赖后重新导出：标记区外依赖仍在，标记区内为最新生成内容', () => {
    // 首次导出
    const first = mergeCargoToml('', generated('0.1.0'))
    // 用户在标记区外追加自己的依赖与 profile
    const userEdited = `${first}
[dependencies.my-helper]
version = "1.0"

[profile.release]
lto = "thin"
`
    const merged = mergeCargoToml(userEdited, generated('0.3.0'))
    expect(merged).toContain('[dependencies.my-helper]')
    expect(merged).toContain('version = "1.0"')
    expect(merged).toContain('lto = "thin"')
    expect(merged).toContain('version = "0.3.0"')
    expect(merged).not.toContain('version = "0.1.0"')
  })

  it('existing 为空字符串 → 返回 generated（首次生成）', () => {
    const gen = generated()
    expect(mergeCargoToml('', gen)).toBe(gen)
  })

  it('existing 仅空白 → 返回 generated', () => {
    const gen = generated()
    expect(mergeCargoToml(' \n\t\n', gen)).toBe(gen)
  })

  it('标记行前后空白差异（缩进/行尾空格）仍能识别并替换', () => {
    const existing = [
      '  # >>> ch32-cubemx generated >>>   ',
      '[package]',
      'name = "demo"',
      'version = "0.0.1"',
      '\t# <<< ch32-cubemx generated <<<\t',
      '',
      '[dependencies]',
      'user-dep = "9"',
    ].join('\n')

    const merged = mergeCargoToml(existing, generated('1.0.0'))
    expect(merged).toContain('version = "1.0.0"')
    expect(merged).not.toContain('version = "0.0.1"')
    expect(merged).toContain('user-dep = "9"')
    // 用户标记行的缩进格式被保留
    expect(merged).toContain('  # >>> ch32-cubemx generated >>>   ')
  })

  it('标记行使用 CRLF 时仍能识别', () => {
    const existing = `${GENERATED_START_MARKER}\r\n[package]\r\nname = "demo"\r\nversion = "0.0.0"\r\n${GENERATED_END_MARKER}\r\n`
    expect(hasGeneratedMarkers(existing)).toBe(true)
    const merged = mergeCargoToml(existing, generated('2.0.0'))
    expect(merged).toContain('version = "2.0.0"')
    expect(merged).not.toContain('version = "0.0.0"')
  })

  it('generated 缺标记区时保守保留 existing', () => {
    const existing = `${GENERATED_START_MARKER}\n[package]\nname = "demo"\n${GENERATED_END_MARKER}\n`
    expect(mergeCargoToml(existing, '[package]\nname = "other"\n')).toBe(existing)
  })
})

describe('extractGeneratedRegion / hasGeneratedMarkers', () => {
  it('无标记文本：has=false，extract=null', () => {
    expect(hasGeneratedMarkers('[package]\nname = "x"\n')).toBe(false)
    expect(extractGeneratedRegion('[package]\nname = "x"\n')).toBeNull()
  })

  it('有标记：返回标记区内容（不含标记行，保留结束标记前的换行）', () => {
    const text = `${GENERATED_START_MARKER}\n[package]\nname = "x"\n${GENERATED_END_MARKER}\n`
    expect(hasGeneratedMarkers(text)).toBe(true)
    expect(extractGeneratedRegion(text)).toBe('[package]\nname = "x"\n')
  })

  it('只有单个标记或顺序颠倒：视为无标记区', () => {
    expect(hasGeneratedMarkers(`${GENERATED_START_MARKER}\n[package]\n`)).toBe(false)
    expect(hasGeneratedMarkers(`${GENERATED_END_MARKER}\n[package]\n`)).toBe(false)
    expect(
      hasGeneratedMarkers(`${GENERATED_END_MARKER}\n[package]\n${GENERATED_START_MARKER}\n`),
    ).toBe(false)
  })
})