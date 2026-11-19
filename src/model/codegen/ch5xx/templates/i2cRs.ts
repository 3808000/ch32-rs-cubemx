// src/generated/i2c.rs（ch5xx-hal I2C：new_blocking，peri → scl → sda，REMAP u8；无上拉字段）
export const I2C_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch5xx_hal as hal;

<% instances.forEach(function(i){ -%>
/// <%- i.id %> 驱动类型（<%- i.remapDesc %>）
pub type <%- i.typeName %> = hal::i2c::I2c<'static, hal::peripherals::<%- i.peri %>, hal::mode::Blocking>;

/// 初始化 <%- i.peri %>（<%- i.paramDesc %>）
pub fn <%- i.initFn %>(
    peri: <%- i.periType %>,
    scl: <%- i.sclType %>,
    sda: <%- i.sdaType %>,
) -> <%- i.typeName %> {
    // Config 为 non_exhaustive：先 Default 再赋值；HAL 无 sda_pullup/scl_pullup 字段，
    // 构造时把两线置为内部上拉输入（外部上拉仍必需，src/i2c.rs:203-224）
    let mut config = hal::i2c::Config::default();
    config.frequency = hal::time::Hertz(<%- i.frequency %>);
    config.duty = hal::i2c::Duty::<%- i.duty %>;
    // 参数顺序：peri → scl → sda（src/i2c.rs:203-208）；7-bit 地址
    hal::i2c::I2c::new_blocking::<<%- i.remapConst %>>(peri, scl, sda, config).unwrap()
}
<% }) -%>
`