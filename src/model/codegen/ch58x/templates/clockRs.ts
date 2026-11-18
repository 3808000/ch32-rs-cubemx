// src/generated/clock.rs（ch58x-hal：固定 480MHz VCO ÷ div，或 sysctl 预设方法）
//
// BLE 档 32K 低频域（M14 实机裁决，证据 docs/HAL_API_NOTES.md §14.2quater）：
// - ble.clock32k 缺省 lse：生成 config.clock.enable_lse()，与 stack_init SelRTCClock=0 一致。
//   M13 曾误判「板无 LSE 晶振」而移除 enable_lse，造成硬件供 LSI、库按 LSE 定时的错配——
//   广播正常但连接建立必败；LSE 全链实机连接建立已验证（官方模组标配 32.768kHz 晶振）。
// - ble.clock32k=lsi（无晶振板回退）：不生成 enable_lse，stack_init SelRTCClock=1；
//   LSI 校准（官方 C 的 Lib_Calibration_LSI）未移植，连接稳定性未保证。
export const CLOCK_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// ch58x-hal 时钟：SYSCLK=<%- sysclk %>（HCLK 同频，无 AHB/APB 分频器）
<% if (enableLse) { -%>
// 32K 低频域走 LSE（ble.clock32k=lse 缺省）：与 BLE 库 SelRTCClock=0 一致（M14 实机验证）
<% } else { -%>
// 32K 低频域保持 LSI 缺省（非 BLE 工程，或 ble.clock32k=lsi 回退；见 README）
<% } -%>

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
<% if (enableLse) { -%>
    // BLE 32K 时钟源 LSE（外部 32.768kHz 晶振；官方模组标配）
    config.clock.enable_lse();
<% } -%>
    config
}
`