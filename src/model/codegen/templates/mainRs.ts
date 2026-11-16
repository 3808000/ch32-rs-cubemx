// 单核 src/main.rs（用户区，仅首次生成）
export const MAIN_TPL = `// 由 ch32-rs-CubeMX 生成 —— 本文件为用户区，重新导出不会覆盖
#![no_std]
#![no_main]

use {ch32_hal as hal, panic_halt as _};

mod generated;

<% if (embassy) { -%>
#[embassy_executor::main(entry = "qingke_rt::entry")]
async fn main(_spawner: embassy_executor::Spawner) -> ! {
<% } else { -%>
#[qingke_rt::entry]
fn main() -> ! {
<% } -%>
<% if (debugPrint) { -%>
    hal::debug::SDIPrint::enable();
<% } -%>
    let mut config = hal::Config::default();
<% if (clockUsed) { -%>
    config.rcc = generated::clock::rcc_config();
<% } -%>
    let p = hal::init(config);

    // —— 用户代码区（生成器永不覆盖本文件）——
    let g = generated::init(p);
    let _ = &g;
    loop {
        // TODO: 你的逻辑
<% if (embassy) { -%>
        embassy_time::Timer::after_millis(1000).await; // 异步延时示例，可删
<% } -%>
    }
}
`
