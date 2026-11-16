// src/generated/pins.rs（GPIO 引脚集合与 init）
export const PINS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
<% if (pins.length > 0) { -%>

use ch32_hal as hal;
use hal::gpio::{<%- useList %>};

/// 已配置的 GPIO 引脚集合（INPUT/OUTPUT 模式；AF/ANALOG 引脚归各外设模块管理）
pub struct Pins<'d> {
<% pins.forEach(function(p){ -%>
    /// <%- p.pin %>（<%- p.comment %>）
    pub <%- p.ident %>: <%- p.kind %><'d>,
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
/// 当前工程未配置 GPIO 引脚
pub struct Pins {}

pub fn init() -> Pins {
    Pins {}
}
<% } -%>
`
