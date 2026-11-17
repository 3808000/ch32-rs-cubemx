// src/generated/adc.rs（ch58x-hal ADC：Config non_exhaustive + 裸通道引脚字段说明）
export const ADC_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch58x_hal as hal;

/// ADC 驱动类型（单实例，14 路外部通道）
pub type Adc = hal::adc::Adc<'static, hal::peripherals::ADC>;

/// 初始化 ADC（Config 为 non_exhaustive：先 Default 再赋值；diff_en/buf_en 保持默认，src/adc.rs:31-49）
pub fn init_adc(peri: hal::peripherals::ADC) -> Adc {
    // non_exhaustive 结构体在 crate 外不能用结构体字面量（E0639）
    let mut config = hal::adc::Config::default();
    config.clk = hal::adc::SamplingClock::<%- samplingClock %>;
    config.pga_gain = hal::adc::Gain::<%- pgaGain %>;
    hal::adc::Adc::new(peri, config)
}
<% if (channels.length > 0) { -%>

// 模拟输入通道是「裸引脚单例」字段（由 Generated 暴露，字段名 adc_inN）：
//   let v = g.adc.read(&mut g.adc_in0);   // 通道由引脚的 AdcPin::channel() 决定
//   let mv = g.adc.read_as_millivolts(&mut g.adc_in0);
<% channels.forEach(function(c){ -%>
// <%- c.field %> → <%- c.pin %>（<%- c.channel %>）
<% }) -%>
<% } -%>
`
