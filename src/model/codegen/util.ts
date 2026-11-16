// 生成期小工具：确定性命名/数值格式化 + 引脚与外设标识符换算。
// 约束：输出不含时间戳/随机值；同一输入必得同一字符串。
import type { DeviceData, ProjectConfig } from '@/model/types'

/** 工程名 → 合法 cargo 包名（小写连字符；空/数字开头兜底） */
export function sanitizePackageName(name: string): string {
  let s = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!s) s = 'ch32-project'
  if (/^[0-9]/.test(s)) s = `app-${s}`
  return s
}

/** Hz 数值 → 下划线分组字符串（24000000 → 24_000_000） */
export function fmtHz(hz: number): string {
  return Math.round(hz)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '_')
}

/** MHz 数值 → 整数或小数（48 → '48MHz'，10.6667 → '10.67MHz'） */
export function fmtMhz(mhz: number): string {
  if (!Number.isFinite(mhz)) return '0MHz'
  if (Number.isInteger(mhz)) return `${mhz}MHz`
  return `${parseFloat(mhz.toFixed(2))}MHz`
}

/** 外设实例 id → Rust 类型名（USART1 → Usart1，ADC1 → Adc1） */
export function typeNameOf(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase()
}

/** 引脚名 → 小写标识符（PD6 → pd6） */
export function pinIdent(pin: string): string {
  return pin.toLowerCase()
}

/** 配置模型 pull → ch32-hal 枚举变体名 */
export function pullVariant(pull: string | undefined): 'Up' | 'Down' | 'None' {
  if (pull === 'UP') return 'Up'
  if (pull === 'DOWN') return 'Down'
  return 'None'
}

/** 引脚单例参数类型（PD6 → hal::Peri<'static, hal::peripherals::PD6>） */
export function periType(pin: string): string {
  return `hal::Peri<'static, hal::peripherals::${pin}>`
}

/** 数据层 DMA 请求 → DMA 通道外设名（USART1_TX → DMA1_CH4）；缺映射返回 null */
export function dmaChannelPeriph(data: DeviceData, request: string): string | null {
  const e = data.dma?.requests.find((r) => r.request === request)
  return e ? `DMA1_CH${e.channel}` : null
}

/** 标签/引脚标识符加用户前缀（snake_case：prefix + '_' + ident） */
export function identWithPrefix(config: ProjectConfig, base: string): string {
  const prefix = config.naming?.prefix?.trim() ?? ''
  return prefix ? `${prefix}_${base}` : base
}