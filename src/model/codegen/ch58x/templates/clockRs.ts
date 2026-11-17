// src/generated/clock.rs（ch58x-hal：固定 480MHz VCO ÷ div，或 sysctl 预设方法）
export const CLOCK_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// ch58x-hal 时钟：SYSCLK=<%- sysclk %>（HCLK 同频，无 AHB/APB 分频器）

use ch58x_hal as hal;

/// 时钟配置（main.rs 传给 hal::init）
pub fn config() -> hal::Config {
    let mut config = hal::Config::default();
<% if (presetConst) { -%>
    // 命中 HAL 预设：<%- presetLabel %>
    <%- presetConst %>;
<% } else { -%>
    // 非预设 PLL 分频：480MHz VCO ÷ <%- div %> = <%- sysclk %>
    config.clock.mux = hal::sysctl::ClockSrc::PLL(<%- div %>);
<% } -%>
    config
}
`
