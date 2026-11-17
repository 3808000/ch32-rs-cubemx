// src/generated/clock.rs（ch58x-hal：固定 480MHz VCO ÷ div，或 sysctl 预设方法）
//
// BLE 档同样**不生成** enable_lse()（M13 实机根因，证据 docs/HAL_API_NOTES.md §14.2bis）：
// - ch58x-hal 的 enable_lse() 强制 XT=1 且没有就绪超时/回退，板子无 32.768kHz 晶振时会挂在时钟等待；
// - 官方 C 库在 SelRTCClock=0（HAL 硬编码，src/ble/mod.rs:190）时内部自动回退 LSI，
//   实机广播成功的 C 固件就是 LSI 缺省配置；
// - 因此保持 LSI 缺省，与实机成功配置一致（不追加 enable_lse）。
export const CLOCK_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// ch58x-hal 时钟：SYSCLK=<%- sysclk %>（HCLK 同频，无 AHB/APB 分频器）
// 32K 低频域保持 LSI 缺省：不调用 enable_lse()（BLE 库按 SelRTCClock=0 内部回退，见 README）

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
