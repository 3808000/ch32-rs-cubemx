// src/main.rs（用户区，仅首次生成；BLE busy-poll / blocking / embassy 三种入口）
export const MAIN_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 本文件为用户区，重新导出不会覆盖
#![no_std]
#![no_main]
<% if (embassy && !ble) { -%>
// embassy 档需要 nightly：qingke-rt 0.5 的 entry 宏 + embassy 的 impl_trait_in_assoc_type
#![feature(impl_trait_in_assoc_type)]
<% } -%>

use {ch58x_hal as hal, panic_halt as _};

mod generated;

<% if (ble) { -%>
#[qingke_rt::entry]
fn main() -> ! {
    // CH58x 实机根因（M13，证据 docs/HAL_API_NOTES.md §14.2bis）：qingke-rt 0.5 启动后 mstatus.MIE=0
    // （handle_reset 注释称由 mret 置位，实机未生效）→ 所有 ISR 不执行。必须在 hal::init 之前显式开全局中断。
    unsafe { core::arch::asm!("csrs mstatus, 8") };
    let p = <% if (clockUsed) { %>hal::init(generated::clock::config())<% } else { %>hal::init(hal::Config::default())<% } %>;
<% } else if (embassy) { -%>
#[embassy_executor::main(entry = "qingke_rt::entry")]
async fn main(_spawner: embassy_executor::Spawner) -> ! {
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
    // BLE 协议栈（generated/ble.rs）：busy-poll 运行时（不用 embassy 执行器/Timer），
    // 初始化 + 角色启动 + TMOS 主循环，永不返回
    generated::ble::run();
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
