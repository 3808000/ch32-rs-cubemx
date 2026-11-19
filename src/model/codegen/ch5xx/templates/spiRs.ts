// src/generated/spi.rs（ch5xx-hal 全双工 new_blocking + 软件 NSS；MODE_0/MODE_3）
export const SPI_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch5xx_hal as hal;

<% instances.forEach(function(s){ -%>
/// <%- s.id %> 驱动类型（<%- s.remapDesc %>）
pub type <%- s.typeName %> = hal::spi::Spi<'static, hal::peripherals::<%- s.id %>, hal::mode::Blocking>;

/// 初始化 <%- s.id %>（<%- s.paramDesc %>）
pub fn <%- s.initFn %>(<%- s.params %>) -> <%- s.typeName %> {
    // Config 为 non_exhaustive：先 Default 再逐字段赋值（src/spi.rs:112-140）
    let mut config = hal::spi::Config::default();
    config.frequency = hal::time::Hertz(<%- s.frequency %>);
    // 控制器只有 MODE_0/MODE_3（clock_mode() 对其它组合返回 ConfigError::Mode）
    config.mode = embedded_hal::spi::<%- s.mode %>;
    config.bit_order = hal::spi::BitOrder::<%- s.bitOrder %>;
    // 全双工构造：peri → sck → mosi → miso（src/spi.rs:188-194）
    hal::spi::Spi::new_blocking::<<%- s.remapConst %>>(peri, sck, mosi, miso, config).unwrap()
}
<% if (s.nss) { -%>

/// <%- s.nss.comment %>
pub type <%- s.nss.typeName %> = hal::gpio::Output<'static>;

pub fn <%- s.nss.initFn %>(nss: <%- s.nss.pinType %>) -> <%- s.nss.typeName %> {
    // ch5xx SPI 不管理片选（vendor 示例同样用 GPIO）；初始高电平（空闲）
    hal::gpio::Output::new(nss, hal::gpio::Level::High, hal::gpio::Speed::Low)
}
<% } -%>
<% }) -%>
`