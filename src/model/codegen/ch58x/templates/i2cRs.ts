// src/generated/i2c.rs（ch58x-hal I2C：构造顺序 peri → scl → sda + const REMAP）
export const I2C_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch58x_hal as hal;
use hal::prelude::*;

<% instances.forEach(function(i){ -%>
/// <%- i.id %> 驱动类型（<%- i.remapDesc %>）
pub type <%- i.typeName %> = hal::i2c::I2c<'static, hal::peripherals::<%- i.id %>>;

/// 初始化 <%- i.id %>（<%- i.paramDesc %>）
pub fn <%- i.initFn %>(
    peri: hal::peripherals::<%- i.id %>,
    scl: hal::peripherals::<%- i.scl %>,
    sda: hal::peripherals::<%- i.sda %>,
) -> <%- i.typeName %> {
    // Config 为 non_exhaustive：crate 外不能用结构体字面量（E0639），先 Default 再赋值；
    // sda_pullup/scl_pullup 保持默认 false（src/i2c.rs:68-84）
    let mut config = hal::i2c::Config::default();
    config.frequency = <%- i.frequency %>.Hz();
    config.duty = hal::i2c::Duty::<%- i.duty %>;
    // 参数顺序：peri → scl → sda（src/i2c.rs:92-100）；7-bit 地址（HAL 内部左移，src/i2c.rs:234）
    hal::i2c::I2c::new::<<%- i.remapConst %>>(peri, scl, sda, config)
}
<% }) -%>
`
