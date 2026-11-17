// src/main.rs（用户区，仅首次生成；blocking/embassy 两种入口）
export const MAIN_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 本文件为用户区，重新导出不会覆盖
#![no_std]
#![no_main]
<% if (embassy) { -%>
// embassy 档需要 nightly：qingke-rt 0.5 的 entry 宏 + embassy 的 impl_trait_in_assoc_type
#![feature(impl_trait_in_assoc_type)]
<% } -%>

use {ch58x_hal as hal, panic_halt as _};

mod generated;

<% if (embassy) { -%>
#[embassy_executor::main(entry = "qingke_rt::entry")]
async fn main(<%- ble ? 'spawner' : '_spawner' %>: embassy_executor::Spawner) -> ! {
    let p = <% if (clockUsed) { %>hal::init(generated::clock::config())<% } else { %>hal::init(hal::Config::default())<% } %>;
    // 必须在 hal::init 之后、任何 Timer/spawn 之前（src/embassy/mod.rs:4-11）
    hal::embassy::init();
<% } else { -%>
#[qingke_rt::entry]
fn main() -> ! {
    let p = <% if (clockUsed) { %>hal::init(generated::clock::config())<% } else { %>hal::init(hal::Config::default())<% } %>;
<% } -%>

    // —— 用户代码区（生成器永不覆盖本文件）——
    let g = generated::init(p);
    let _ = &g;
<% if (ble) { -%>
    // BLE 协议栈（generated/ble.rs）：初始化 + 角色启动 + TMOS 泵，永不返回
    generated::ble::run(&spawner).await;
<% } else { -%>
    loop {
        // TODO: 你的逻辑
<% if (embassy) { -%>
        embassy_time::Timer::after_millis(1000).await; // 异步延时示例，可删
<% } -%>
    }
<% } -%>
}
`
