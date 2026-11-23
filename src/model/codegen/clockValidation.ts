// 生成器复用时钟树的速率与拒绝条件，并附上已有的外设冲突类型。
import { computeClock, mergeClockConfig } from '@/model/clock'
import { computePeripheralClocks } from '@/model/clock/peripheral'
import { peripheralClockState, type PeripheralUsage } from '@/model/peripherals'
import type { Conflict, DeviceData, ProjectConfig } from '@/model/types'

export function peripheralClockErrors(
  config: ProjectConfig,
  data: DeviceData,
  usages: PeripheralUsage[],
  backend: string,
): Conflict[] {
  const clock = mergeClockConfig(data.clock, config.clock)
  const frequencies = computeClock(data.clock, clock)
  // 核心时钟非法时由 RCC 校验提示，避免派生一串无意义的外设错误。
  if (!(frequencies.hclkMhz > 0) || !Number.isFinite(frequencies.hclkMhz)) return []

  return computePeripheralClocks(data.clock, clock, frequencies, data.peripherals, peripheralClockState(usages), backend)
    .flatMap(({ category, periId, issues }) => {
      const code = backend === 'ch5xx-hal' && category === 'usart' ? 'BAUDRATE_UNREPRESENTABLE'
        : backend === 'ch5xx-hal' && category === 'spi' ? 'SPI_FREQUENCY_UNREPRESENTABLE'
          : backend === 'ch5xx-hal' && category === 'i2c' ? 'I2C_CLOCK_OUT_OF_RANGE'
            : 'PERIPHERAL_CLOCK_INVALID'
      return issues.filter((issue) => issue.level === 'error')
        .map((issue): Conflict => ({ code, level: 'error', peripheral: periId, message: `${periId}：${issue.message}` }))
    })
}
