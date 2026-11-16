// src/generated/usart.rs（UART 类型别名与初始化函数）
export const USART_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% instances.forEach(function(u){ -%>
/// <%- u.id %> 驱动类型（<%- u.remapDesc %>）
pub type <%- u.typeName %> = hal::usart::Uart<'static, hal::peripherals::<%- u.id %>, hal::mode::<%- u.modeType %>>;

/// 初始化 <%- u.id %>（<%- u.paramDesc %>）
pub fn <%- u.initFn %>(<%- u.params %>) -> <%- u.typeName %> {
    let mut cfg = hal::usart::Config::default();
<% u.cfgLines.forEach(function(l){ -%>
    <%- l %>
<% }) -%>
<% if (u.asyncMode) { -%>
    // rx 在前、tx 在后；异步需中断绑定（super::Irqs）与 TX/RX DMA 通道
    hal::usart::Uart::new<%- u.remapSyntax %>(peri, rx, tx, irqs, tx_dma, rx_dma, cfg).unwrap()
<% } else { -%>
    // 注意参数顺序：rx 在前、tx 在后；返回 Result，用 unwrap 解包
    hal::usart::Uart::new_blocking<%- u.remapSyntax %>(peri, rx, tx, cfg).unwrap()
<% } -%>
}
<% }) -%>
`
