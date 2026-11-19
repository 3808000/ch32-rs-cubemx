// src/generated/pins.rs（GPIO 引脚集合与 init；ch5xx 驱动句柄不携带 pin 泛型）
// Uart/Spi/I2c 同理：`Output<'d>` / `Input<'d>` 只带生命周期；引脚单例仅作构造参数。
export const PINS_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
<% if (pins.length > 0) { -%>

use ch5xx_hal as hal;
use hal::gpio::{<%- useList %>};

/// 已配置的 GPIO 引脚集合（INPUT/OUTPUT；AF 引脚归外设、ANALOG 引脚归 ADC，不在此生成）
pub struct Pins<'d> {
<% pins.forEach(function(p){ -%>
    /// <%- p.pin %>（<%- p.comment %>）
    pub <%- p.ident %>: hal::gpio::<%- p.kind %><'d>,
<% }) -%>
}

/// 逐引脚传入 hal::Peripherals 的引脚单例，返回 'static 借用期的引脚集合
pub fn init(<%- params %>) -> Pins<'static> {
    Pins {
<% pins.forEach(function(p){ -%>
        <%- p.ident %>: <%- p.expr %>,
<% }) -%>
    }
}
<% } else { -%>
/// 当前工程未配置 GPIO 引脚（AF 引脚归外设；ANALOG 引脚由生成的 adc 通道单例接管）
pub struct Pins {}

pub fn init() -> Pins {
    Pins {}
}
<% } -%>
`