// src/generated/adc.rs（ch5xx-hal ADC：Config non_exhaustive + 通道=GPIO 单例）
export const ADC_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch5xx_hal as hal;

/// ADC 驱动类型（单实例，14 路外部通道；通道由 GPIO 单例的 AdcChannel impl 决定）
pub type Adc = hal::adc::Adc<'static, hal::peripherals::ADC>;

/// 初始化 ADC（Config non_exhaustive：先 Default 再赋值；src/adc.rs:174-200）
pub fn init_adc(peri: <%- periType %>) -> Adc {
    let mut config = hal::adc::Config::default();
    config.gain = hal::adc::Gain::<%- pgaGain %>;
    config.sample_clock = hal::adc::SampleClock::<%- samplingClock %>;
    hal::adc::Adc::new(peri, config)
}
<% if (channels.length > 0) { -%>

// 模拟输入通道 = GPIO 单例（由 Generated 暴露，字段名 adc_inN）：
//   let raw = g.adc.blocking_read(&mut g.adc_in0).unwrap(); // u16, 12-bit
//   let mv = raw as u32 * 3300 / 4096;                      // 参考 3.3V 的近似换算（HAL 无 read_as_millivolts）
// 通道表按 HAL impl_channel! 与数据层逐一核对（PA4=ch0 … PA9=ch13）：
<% channels.forEach(function(c){ -%>
// <%- c.field %> → <%- c.pin %>（<%- c.channel %>）
<% }) -%>
<% } -%>
`