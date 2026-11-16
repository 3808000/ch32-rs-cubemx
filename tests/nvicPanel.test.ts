// M3.1 NVIC 面板：store 中断配置语义 + 面板渲染（SSR，无 DOM 依赖）。
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp, h } from 'vue'
import type { SetupContext } from 'vue'
import { renderToString } from '@vue/server-renderer'
import NvicPanel from '@/components/peripherals/NvicPanel.vue'
import { useProjectStore } from '@/controllers/project'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('NVIC store 中断配置', () => {
  it('setInterrupt 新增：默认使能、优先级 0', () => {
    const store = useProjectStore()
    store.setInterrupt('USART1', {})
    expect(store.interrupts).toEqual([{ irq: 'USART1', enabled: true, priority: 0 }])
    expect(store.dirty).toBe(true)
  })

  it('setInterrupt 更新：保留未提供的字段，priority 夹取 0..15', () => {
    const store = useProjectStore()
    store.setInterrupt('USART1', { enabled: true, priority: 3 })
    store.setInterrupt('USART1', { priority: 20 })
    expect(store.interrupts).toEqual([{ irq: 'USART1', enabled: true, priority: 15 }])
    store.setInterrupt('USART1', { priority: -4 })
    expect(store.interrupts).toEqual([{ irq: 'USART1', enabled: true, priority: 0 }])
    store.setInterrupt('USART1', { enabled: false })
    expect(store.interrupts).toEqual([{ irq: 'USART1', enabled: false, priority: 0 }])
  })

  it('removeInterrupt 删除一条，不存在的 IRQ 无副作用', () => {
    const store = useProjectStore()
    store.setInterrupt('USART1', { enabled: true, priority: 1 })
    store.setInterrupt('SPI1', { enabled: true, priority: 2 })
    store.removeInterrupt('USART1')
    expect(store.interrupts.map((x) => x.irq)).toEqual(['SPI1'])
    store.removeInterrupt('NOT_THERE')
    expect(store.interrupts.map((x) => x.irq)).toEqual(['SPI1'])
  })

  it('config getter 输出 interrupts（cube.json 往返）', () => {
    const store = useProjectStore()
    store.setInterrupt('USART1', { enabled: true, priority: 4 })
    expect(store.config.interrupts).toEqual([{ irq: 'USART1', enabled: true, priority: 4 }])
  })

  it('resetPinout / switchDevice 清空中断配置', () => {
    const store = useProjectStore()
    store.setInterrupt('USART1', { enabled: true, priority: 1 })
    store.resetPinout()
    expect(store.interrupts).toEqual([])

    store.setInterrupt('USART1', { enabled: true, priority: 1 })
    store.switchDevice('CH32V203C8T6')
    expect(store.interrupts).toEqual([])
  })
})

/** 轻量 DOM 桩：SSR 下渲染为普通标签，避免依赖 Element Plus 运行时。 */
function stub(tag: string) {
  return {
    inheritAttrs: false,
    setup(_props: unknown, { slots }: SetupContext) {
      return () => h(tag, {}, slots.default ? slots.default() : [])
    },
  }
}

describe('NvicPanel 渲染', () => {
  it('显示已配置数、启用数、芯片 IRQ 行', async () => {
    const pinia = createPinia()
    const store = useProjectStore(pinia)
    store.setInterrupt('USART1', { enabled: true, priority: 2 })

    const app = createSSRApp(NvicPanel)
    app.use(pinia)
    for (const tag of ['el-input', 'el-select', 'el-option', 'el-switch']) app.component(tag, stub('span'))
    app.component('el-button', stub('button'))

    const html = await renderToString(app)
    expect(html).toContain('已配置')
    expect(html).toMatch(/已配置\s*<strong[^>]*>1<\/strong>\s*条中断/)
    expect(html).toMatch(/启用\s*<strong[^>]*>1<\/strong>\s*条/)
    // 芯片 IRQ 表（V003 全表 23 条）
    expect(html).toContain('USART1')
    expect(html).toContain('EXTI7_0')
    expect(html).toContain('TIM2')
    expect(html.match(/data-irq=/g)).toHaveLength(23)
  })

  it('切换芯片后 IRQ 行数随数据层变化', async () => {
    const pinia = createPinia()
    const store = useProjectStore(pinia)
    store.switchDevice('CH582M')
    const app = createSSRApp(NvicPanel)
    app.use(pinia)
    for (const tag of ['el-input', 'el-select', 'el-option', 'el-switch']) app.component(tag, stub('span'))
    app.component('el-button', stub('button'))
    const html = await renderToString(app)
    // CH582M 数据层有 20 条中断（halBackend 仅影响导出），此处验证行数随数据层变化
    expect(html.match(/data-irq=/g)).toHaveLength(20)
    expect(html).toContain('BLEB')
  })
})