// src/generated/clock.rs（RCC 预设常量或逐字段构造）
export const CLOCK_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// SYSCLK=<%- sysclk %> HCLK=<%- hclk %> PCLK1=<%- pclk1 %> PCLK2=<%- pclk2 %>

use ch32_hal as hal;

/// 时钟树推导出的 RCC 配置
pub fn rcc_config() -> hal::rcc::Config {
<% if (presetConst) { -%>
    // 命中 HAL 预设常量：<%- presetLabel %>
    <%- presetConst %>
<% } else { -%>
    // 无匹配预设：按 Config 字段显式构造（Config 为 non_exhaustive 思路一致：default 后逐字段赋值）
    let mut cfg = hal::rcc::Config::default();
<% assignments.forEach(function(a){ -%>
    <%- a %>
<% }) -%>
    cfg
<% } -%>
}
`
