// src/generated/usart.rs（ch58x-hal UART：仅阻塞；构造顺序 peri → tx → rx + const REMAP）
export const USART_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch58x_hal as hal;

<% instances.forEach(function(u){ -%>
/// <%- u.id %> 驱动类型（<%- u.remapDesc %>）
pub type <%- u.typeName %> = hal::uart::Uart<'static, hal::peripherals::<%- u.id %>>;

/// 初始化 <%- u.id %>（<%- u.paramDesc %>）
pub fn <%- u.initFn %>(
    peri: hal::peripherals::<%- u.id %>,
    tx: hal::peripherals::<%- u.tx %>,
    rx: hal::peripherals::<%- u.rx %>,
) -> <%- u.typeName %> {
    // Config 非 non_exhaustive：四个字段完整构造（src/uart.rs:43-58）
    let config = hal::uart::Config {
        baudrate: <%- u.baudrate %>,
        data_bits: hal::uart::DataBits::<%- u.dataBits %>,
        stop_bits: hal::uart::StopBits::<%- u.stopBits %>,
        parity: hal::uart::Parity::<%- u.parity %>,
    };
    // 参数顺序：peri → tx → rx（src/uart.rs:252-261）；REMAP 为 const 泛型 bool
    hal::uart::Uart::new::<<%- u.remapConst %>>(peri, tx, rx, config).unwrap()
}
<% }) -%>
`
