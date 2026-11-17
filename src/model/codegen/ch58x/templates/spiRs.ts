// src/generated/spi.rs（ch58x-hal 仅 SPI0；new/new_txonly/new_rxonly + 软件 NSS）
export const SPI_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch58x_hal as hal;
use hal::prelude::*;

<% instances.forEach(function(s){ -%>
/// <%- s.id %> 驱动类型（<%- s.remapDesc %>）
pub type <%- s.typeName %> = hal::spi::Spi<'static, hal::peripherals::<%- s.id %>>;

/// 初始化 <%- s.id %>（<%- s.paramDesc %>）
pub fn <%- s.initFn %>(<%- s.params %>) -> <%- s.typeName %> {
    // Config 为 non_exhaustive：crate 外不能用结构体字面量（含 ..Default::default()，E0639），
    // 必须先 Default 再逐字段赋值；其余字段保持默认值（src/spi.rs:31-45）
    let mut config = hal::spi::Config::default();
    config.clock_polarity = hal::spi::Polarity::<%- s.polarity %>;
    config.bit_order = hal::spi::BitOrder::<%- s.bitOrder %>;
    config.frequency = <%- s.frequency %>.Hz();
    // <%- s.callComment %>
    <%- s.callExpr %>
}
<% if (s.nss) { -%>

/// <%- s.nss.comment %>
pub type <%- s.nss.typeName %> = hal::gpio::Output<'static, hal::peripherals::<%- s.nss.pin %>>;

pub fn <%- s.nss.initFn %>(nss: hal::peripherals::<%- s.nss.pin %>) -> <%- s.nss.typeName %> {
    // ch58x-hal 不消费 NSS（CsPin 只是 trait 标记，spi.rs 不读写 CS），按软件片选生成
    hal::gpio::Output::new(nss, hal::gpio::Level::High, hal::gpio::OutputDrive::_5mA)
}
<% } -%>
<% }) -%>
`
