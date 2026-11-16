// DMA 规则：embassy 异步外设的 DMA 通道被多个请求占用。
import { categoryOfPeripheral } from '@/model/device'
import type { ConflictContext } from './context'

export function runDmaRules(ctx: ConflictContext): void {
  const { config, data, peripherals, push } = ctx

  // ---- DMA 通道冲突（embassy 异步外设） ----
  if (config.features?.embassy && data.dma) {
    const channelUsers = new Map<number, string[]>()
    for (const [id, state] of Object.entries(peripherals)) {
      if (!state.enabled) continue
      const cat = categoryOfPeripheral(id)
      const reqs: string[] = []
      if (cat === 'usart') reqs.push(`${id}_TX`, `${id}_RX`)
      else if (cat === 'spi') reqs.push(`${id}_TX`, `${id}_RX`)
      else if (cat === 'i2c') reqs.push(`${id}_TX`, `${id}_RX`)
      else if (cat === 'adc') reqs.push(id)
      for (const r of reqs) {
        const entry = data.dma.requests.find((x) => x.request === r)
        if (!entry) continue
        const arr = channelUsers.get(entry.channel) ?? []
        arr.push(r)
        channelUsers.set(entry.channel, arr)
      }
    }
    for (const [ch, users] of channelUsers) {
      if (users.length > 1) {
        push({ code: 'DMA_CHANNEL_CONFLICT', level: 'error', message: `DMA 通道 ${ch} 被多个请求占用：${users.join('、')}` })
      }
    }
  }
}