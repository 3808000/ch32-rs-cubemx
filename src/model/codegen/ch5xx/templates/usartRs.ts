// src/generated/usart.rs（ch5xx-hal UART：new_blocking，参数顺序 peri → rx → tx，REMAP 是 u8）
export const USART_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch5xx_hal as hal;

<% instances.forEach(function(u){ -%>
/// <%- u.id %> 驱动类型（<%- u.remapDesc %>）
pub type <%- u.typeName %> = hal::uart::Uart<'static, hal::peripherals::<%- u.id %>, hal::mode::Blocking>;

/// 初始化 <%- u.id %>（<%- u.paramDesc %>）
pub fn <%- u.initFn %>(
    peri: <%- u.periType %>,
    rx: <%- u.rxType %>,
    tx: <%- u.txType %>,
) -> <%- u.typeName %> {
    // Config 为 non_exhaustive：用 new(baud) 后逐字段赋值（src/uart.rs:100-130）
    let mut config = hal::uart::Config::new(<%- u.baudrate %>);
    config.data_bits = hal::uart::DataBits::<%- u.dataBits %>;
    config.parity = hal::uart::Parity::<%- u.parity %>;
    config.stop_bits = hal::uart::StopBits::<%- u.stopBits %>;
    // 参数顺序：peri → rx → tx（src/uart.rs:714-721，RX 必须先配置）；REMAP 为 const 泛型 u8
    hal::uart::Uart::new_blocking::<<%- u.remapConst %>>(peri, rx, tx, config).unwrap()
}
<% }) -%>
`