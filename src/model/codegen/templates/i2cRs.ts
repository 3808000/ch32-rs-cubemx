// src/generated/i2c.rs（I2C 类型别名与初始化函数）
export const I2C_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% instances.forEach(function(i){ -%>
/// <%- i.id %> 驱动类型（<%- i.remapDesc %>）
pub type <%- i.typeName %> = hal::i2c::I2c<'static, hal::peripherals::<%- i.id %>, hal::mode::<%- i.modeType %>>;

/// 初始化 <%- i.id %>（<%- i.paramDesc %>）
pub fn <%- i.initFn %>(<%- i.params %>) -> <%- i.typeName %> {
    let mut cfg = hal::i2c::Config::default();
<% i.cfgLines.forEach(function(l){ -%>
    <%- l %>
<% }) -%>
<% if (i.asyncMode) { -%>
    // 异步需双中断绑定（<%- i.id %>_EV/<%- i.id %>_ER，见 super::Irqs）与 TX/RX DMA 通道
    hal::i2c::I2c::new<%- i.remapSyntax %>(peri, scl, sda, irqs, tx_dma, rx_dma, hal::time::Hertz::hz(<%- i.freq %>), cfg)
<% } else { -%>
    // 阻塞构造直接返回 Self（无 Result）
    hal::i2c::I2c::new_blocking<%- i.remapSyntax %>(peri, scl, sda, hal::time::Hertz::hz(<%- i.freq %>), cfg)
<% } -%>
}
<% }) -%>
`
