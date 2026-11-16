// src/generated/spi.rs（SPI 类型别名与初始化函数）
export const SPI_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% instances.forEach(function(s){ -%>
/// <%- s.id %> 驱动类型（<%- s.remapDesc %>）
pub type <%- s.typeName %> = hal::spi::Spi<'static, hal::peripherals::<%- s.id %>, hal::mode::<%- s.modeType %>>;

/// 初始化 <%- s.id %>（<%- s.paramDesc %>）
pub fn <%- s.initFn %>(<%- s.params %>) -> <%- s.typeName %> {
    let mut cfg = hal::spi::Config::default();
<% s.cfgLines.forEach(function(l){ -%>
    <%- l %>
<% }) -%>
<% if (s.asyncMode) { -%>
    // 签名已核对 ch32-hal src/spi.rs：非 v4x7 家族的异步构造无中断绑定参数（仅 TX/RX DMA）
    hal::spi::Spi::new<%- s.remapSyntax %>(peri, sck, mosi, miso, tx_dma, rx_dma, cfg)
<% } else { -%>
    // 阻塞构造直接返回 Self（无 Result）
    hal::spi::Spi::new_blocking<%- s.remapSyntax %>(peri, sck, mosi, miso, cfg)
<% } -%>
}
<% }) -%>
`
