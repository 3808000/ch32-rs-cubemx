// src/generated/adc.rs（ADC 结构体、初始化与读取示例）
export const ADC_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% instances.forEach(function(a){ -%>
/// <%- a.id %>：ADC 通道是引脚的 trait 实现（非整数索引），每个使用的通道一个引脚字段
pub struct <%- a.typeName %> {
    pub adc: hal::adc::Adc<'static, hal::peripherals::<%- a.id %>>,
<% a.channels.forEach(function(c){ -%>
    /// <%- c.pin %>（<%- c.channel %>）
    pub <%- c.field %>: hal::Peri<'static, hal::peripherals::<%- c.pin %>>,
<% }) -%>
}

pub fn <%- a.initFn %>(<%- a.params %>) -> <%- a.typeName %> {
<% if (adcApi === 'v4x7') { -%>
    // H4/V4x7：Adc::new 返回 Result（时钟不可用/过快时失败）
    let adc = hal::adc::Adc::new(adc_peri, Default::default()).unwrap();
<% } else { -%>
    let adc = hal::adc::Adc::new(adc_peri, Default::default());
<% } -%>
    <%- a.typeName %> {
        adc,
<% a.channels.forEach(function(c){ -%>
        <%- c.field %>: <%- c.param %>,
<% }) -%>
    }
}
<% if (a.channels.length > 0) { -%>

// 读取示例（按需复制到用户代码区）：
<% a.channels.forEach(function(c){ -%>
<% if (adcApi === 'v4x7') { -%>
// let v = g.<%- a.fieldName %>.adc.blocking_read(&mut g.<%- a.fieldName %>.<%- c.field %>, hal::adc::SampleTime::<%- a.sampleTime %>).unwrap();
<% } else { -%>
// let v = g.<%- a.fieldName %>.adc.convert(&mut g.<%- a.fieldName %>.<%- c.field %>, hal::adc::SampleTime::<%- a.sampleTime %>);
<% } -%>
<% }) -%>
<% } -%>
<% }) -%>
`
