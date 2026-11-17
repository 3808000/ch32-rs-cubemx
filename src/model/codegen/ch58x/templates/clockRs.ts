// src/generated/clock.rs（ch58x-hal：固定 480MHz VCO ÷ div，或 sysctl 预设方法）
// BLE 开启时追加 enable_lse()：hal::ble 的 Config 无 LSE 开关，ble::init 硬编码 SelRTCClock=0。
export const CLOCK_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// ch58x-hal 时钟：SYSCLK=<%- sysclk %>（HCLK 同频，无 AHB/APB 分频器）

use ch58x_hal as hal;

/// 时钟配置（main.rs 传给 hal::init）
pub fn config() -> hal::Config {
    let mut config = hal::Config::default();
<% if (lse) { -%>
    // BLE 强制 LSE 32.768kHz：ble::init 硬编码 SelRTCClock=0（src/ble/mod.rs:190），Config 无开关
<% } -%>
<% if (presetConst) { -%>
    // 命中 HAL 预设：<%- presetLabel %>
    <%- presetConst %><%- lse ? '.enable_lse()' : '' %>;
<% } else { -%>
    // 非预设 PLL 分频：480MHz VCO ÷ <%- div %> = <%- sysclk %>
    config.clock.mux = hal::sysctl::ClockSrc::PLL(<%- div %>);
<% if (lse) { -%>
    config.clock.enable_lse();
<% } -%>
<% } -%>
    config
}
`
