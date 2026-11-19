// src/generated/clock.rs（ch5xx-hal：Config 预设关联常量 / 显式 PLL(div) / HSE 直连）
// 真相源 reference/ch5xx-hal @875651b6 src/rcc.rs：预设是 `hal::rcc::Config::PLL_60MHZ` 关联常量，
// **没有** `hal::rcc::presets::*` 模块（契约 D4 的 presets 路径与源码不符，以源码为准）。
export const CLOCK_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// ch5xx-hal 时钟：SYSCLK=<%- sysclk %>（HCLK 同频；外设均取 Fsys）

use ch5xx_hal as hal;

/// 时钟配置（main.rs 传给 hal::init；From<rcc::Config> for hal::Config）
pub fn config() -> hal::rcc::Config {
<% if (presetConst) { -%>
    // 命中 HAL 预设：<%- presetLabel %>
    <%- presetConst %>
<% } else if (hseDirect) { -%>
    // HSE 32MHz 直连（CLK_SYS_MOD=10，Fsys 15..=80MHz 允许）
    hal::rcc::Config::new(hal::rcc::Osc::Hse32, hal::rcc::Sys::Direct)
<% } else { -%>
    // 非预设 PLL 分频：480MHz VCO ÷ <%- div %> = <%- sysclk %>
    hal::rcc::Config::new(hal::rcc::Osc::Hse32, hal::rcc::Sys::Pll(<%- div %>))
<% } -%>
}
`