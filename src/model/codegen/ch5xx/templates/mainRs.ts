// src/main.rs（用户区，仅首次生成；blocking / embassy / BLE busy-poll 三种入口）
// ch5xx 差异（D4）：
// - embassy 档用 #[embassy_executor::main(entry = "qingke_rt::entry")]，**无** hal::embassy::init（hal::init 内部完成）；
// - BLE 档在 hal::init 之后、generated::ble::run()（内部 ble::init）之前调用 shim 的 32K 时钟设置：
//   lse → ch5xx_ble::enable_lse()；lsi → ch5xx_ble::set_clock32k_lsi()（顺序待 S1 实测确认）。
export const MAIN_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 本文件为用户区，重新导出不会覆盖
#![no_std]
#![no_main]
<% if (embassy && !ble) { -%>
// embassy 档需要 nightly：embassy 的 impl_trait_in_assoc_type
#![feature(impl_trait_in_assoc_type)]
<% } -%>

use {ch5xx_hal as hal, panic_halt as _};

mod generated;

<% if (ble) { -%>
#[qingke_rt::entry]
fn main() -> ! {
    let p = hal::init(hal::Config { rcc: generated::clock::config() });
<% if (enableLse) { -%>
    // BLE 32K 低频域 LSE（外部 32.768kHz）：hal::init 后、ble::init 前（shim 固定寄存器序列）
    ch5xx_ble::enable_lse();
<% } else { -%>
    // BLE 32K 低频域 LSI（无晶振板回退）：选择内部 32kHz RC
    ch5xx_ble::set_clock32k_lsi();
<% } -%>

    // —— 用户代码区（生成器永不覆盖本文件）——
    let g = generated::init(p);
    let _ = &g;
    // BLE 协议栈（generated/ble.rs）：shim 的 busy-poll TMOS 主循环，永不返回
    generated::ble::run();
}
<% } else if (embassy) { -%>
#[embassy_executor::main(entry = "qingke_rt::entry")]
async fn main(_spawner: embassy_executor::Spawner) -> ! {
    let p = <% if (clockUsed) { %>hal::init(hal::Config { rcc: generated::clock::config() })<% } else { %>hal::init(hal::Config::default())<% } %>;

    // —— 用户代码区（生成器永不覆盖本文件）——
    let g = generated::init(p);
    let _ = &g;
    loop {
        // TODO: 你的逻辑
        embassy_time::Timer::after_millis(1000).await; // 异步延时示例，可删
    }
}
<% } else { -%>
#[qingke_rt::entry]
fn main() -> ! {
    let p = <% if (clockUsed) { %>hal::init(hal::Config { rcc: generated::clock::config() })<% } else { %>hal::init(hal::Config::default())<% } %>;

    // —— 用户代码区（生成器永不覆盖本文件）——
    let g = generated::init(p);
    let _ = &g;
    loop {
        // TODO: 你的逻辑
    }
}
<% } -%>
`