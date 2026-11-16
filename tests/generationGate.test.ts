// 生成门禁决议（M7 决议入页）：error 阻止 / warning 需页内勾选 / 其余放行。
import { describe, expect, it } from 'vitest'
import { generationGate } from '@/components/codegen/useGenerationFlow'
import type { PreflightItem, PreflightReport } from '@/model/preflight'

function item(level: 'error' | 'warning', code = 'X'): PreflightItem {
  return { code, level, message: `${level} msg`, target: { view: 'pinout' } }
}

function report(errors: PreflightItem[] = [], warnings: PreflightItem[] = []): PreflightReport {
  return { errors, warnings }
}

describe('generationGate（页内门禁，无弹窗）', () => {
  it('无错误无警告 → 放行（无论勾选与否）', () => {
    expect(generationGate(report(), false)).toBe('go')
    expect(generationGate(report(), true)).toBe('go')
  })

  it('有错误 → 阻止（勾选警告也不放行）', () => {
    expect(generationGate(report([item('error')]), false)).toBe('block')
    expect(generationGate(report([item('error')]), true)).toBe('block')
  })

  it('错误优先于警告确认', () => {
    expect(generationGate(report([item('error')], [item('warning')]), true)).toBe('block')
  })

  it('仅警告未勾选 → 需确认', () => {
    expect(generationGate(report([], [item('warning')]), false)).toBe('need-ack')
  })

  it('仅警告已勾选 → 放行', () => {
    expect(generationGate(report([], [item('warning')]), true)).toBe('go')
  })

  it('多条警告同样需一次性勾选', () => {
    const r = report([], [item('warning', 'A'), item('warning', 'B')])
    expect(generationGate(r, false)).toBe('need-ack')
    expect(generationGate(r, true)).toBe('go')
  })

  it('空报告对象字段缺省兜底（防御手改数据）', () => {
    expect(generationGate({ errors: [], warnings: [] }, false)).toBe('go')
  })

  it('决议为纯函数：同一输入多次调用结果一致', () => {
    const r = report([], [item('warning')])
    expect(generationGate(r, false)).toBe(generationGate(r, false))
    expect(generationGate(r, true)).toBe(generationGate(r, true))
  })
})