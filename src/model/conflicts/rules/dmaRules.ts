// DMA 规则：embassy 异步外设的 DMA 通道冲突 + 显式通道配置校验（M3.2）。
// 与 codegen 的 buildDmaPlan 共用同一数据约定（dma.json 的 model/channels 可选扩展）：
//  - fixed：请求硬件固定在某个 DMA1_CHn，显式配置只能与数据层固定值一致；
//  - dmamux：requests[].channel 是 DMAMUX 请求号，物理通道来自 channels[]，
//    显式配置的通道必须存在且不能被多个请求重复占用。
import type { DmaData } from '@/model/types'
import { derivePeripheralUsage } from '@/model/peripherals'
import type { PeripheralUsage } from '@/model/peripherals'
import type { ConflictContext } from './context'

interface DmaChannelOption {
  number: number
  name: string
}

interface DmaDataExt {
  model?: 'fixed' | 'dmamux'
  channels?: DmaChannelOption[]
}

/**
 * 已启用外设需要的 DMA 请求名。使用与渲染器相同的 derivePeripheralUsage
 * （AF 引脚即启用，不依赖 peripherals 里是否有显式 enabled 记录），只统计
 * 生成器真正走 DMA 的类别（USART/SPI/I2C）：ADC 当前只有阻塞 convert
 * （HAL 无公开连续/DMA 配置 API），不占 DMA 通道。
 */
function enabledDmaRequests(usages: PeripheralUsage[]): string[] {
  const out: string[] = []
  for (const u of usages) {
    if (!u.enabled || u.category === 'adc') continue
    out.push(`${u.id}_TX`, `${u.id}_RX`)
  }
  return out
}

export function runDmaRules(ctx: ConflictContext): void {
  const { config, data, push } = ctx
  if (!config.features?.embassy || !data.dma) return

  const dma: DmaData = data.dma
  const ext = dma as DmaDataExt
  const model = ext.model === 'dmamux' ? 'dmamux' : 'fixed'
  const channels = Array.isArray(ext.channels) ? ext.channels : []
  const channelName = (n: number) => channels.find((c) => c.number === n)?.name ?? `DMA1_CH${n}`
  const requests = enabledDmaRequests(derivePeripheralUsage(config, data))
  const explicitOf = (request: string) => (config.dma ?? []).find((e) => e.peripheral === request)

  // 同一物理通道被多个请求占用（fixed 按数据层固定通道，dmamux 按显式配置）
  const channelUsers = new Map<number, string[]>()
  const addUser = (channel: number, request: string) => {
    const users = channelUsers.get(channel) ?? []
    users.push(request)
    channelUsers.set(channel, users)
  }

  if (model === 'fixed') {
    for (const request of requests) {
      const entry = dma.requests.find((x) => x.request === request)
      if (!entry) continue // 缺映射由 generationErrors 拦截
      const explicit = explicitOf(request)
      if (explicit && explicit.channel !== entry.channel) {
        push({
          code: 'DMA_CHANNEL_CONFLICT',
          level: 'error',
          message: `${request} 在 ${data.chip.chip} 上固定使用通道 ${entry.channel}（${channelName(entry.channel)}），不能改为通道 ${explicit.channel}；如需释放该通道请停用对应外设`,
          peripheral: request.split('_')[0],
        })
      }
      // 生成代码始终使用固定通道，占用按固定值统计
      addUser(entry.channel, request)
    }
  } else {
    // dmamux：request 号来自 dma.json；用户只需指定物理通道
    for (const request of requests) {
      const explicit = explicitOf(request)
      if (!explicit) continue // 未显式配置时由 buildDmaPlan 自动分配，不会冲突
      const entry = dma.requests.find((x) => x.request === request)
      if (explicit.request !== undefined && entry && explicit.request !== entry.channel) {
        push({
          code: 'DMA_CHANNEL_CONFLICT',
          level: 'error',
          message: `${request} 的 DMAMUX 请求号应为 ${entry.channel}，配置为 ${explicit.request}（数据层 dma.json 为准）`,
          peripheral: request.split('_')[0],
        })
      }
      if (!channels.some((c) => c.number === explicit.channel)) {
        push({
          code: 'DMA_CHANNEL_CONFLICT',
          level: 'error',
          message: `${request} 指定的 DMA 通道 ${explicit.channel} 不在 ${data.chip.chip} 的 dma.json channels 中`,
          peripheral: request.split('_')[0],
        })
        continue
      }
      addUser(explicit.channel, request)
    }
  }

  for (const [channel, users] of channelUsers) {
    if (users.length > 1) {
      push({
        code: 'DMA_CHANNEL_CONFLICT',
        level: 'error',
        message: `DMA 通道 ${channel}（${channelName(channel)}）被多个请求占用：${users.join('、')}`,
      })
    }
  }
}