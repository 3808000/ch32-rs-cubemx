// 双核 V3F 启动核 src/main.rs（用户区，唤醒 V5F）
export const DUAL_V3F_MAIN_TPL = `// 由 ch32-rs-CubeMX 生成 —— 本文件为用户区，重新导出不会覆盖
// 启动核（V3F）：reset 只启动本核；RCC/GPIO/EXTI 等共享外设由这里初始化，
// 随后唤醒 hart 1 上的 V5F 镜像。
#![no_std]
#![no_main]

use {ch32_hal as hal, panic_halt as _};

mod generated;

/// 必须与 v5f/memory.x 的 FLASH ORIGIN 一致（1KB 对齐）
const V5F_ENTRY: u32 = 0x0001_0000;

#[qingke_rt::entry]
fn main() -> ! {
<% if (debugPrint) { -%>
    hal::debug::SDIPrint::enable();
<% } -%>
    let mut config = hal::Config::default();
<% if (clockUsed) { -%>
    config.rcc = generated::clock::rcc_config();
<% } -%>
    let p = hal::init(config);

    // 唤醒 V5F（hart 1）到它自己的 flash 入口
    unsafe { qingke::pfic::wake_other_core(V5F_ENTRY) };

    // —— 用户代码区（生成器永不覆盖本文件）——
    let g = generated::init(p);
    let _ = &g;
    loop {
        // TODO: 你的逻辑（V3F 控制核）
        hal::delay::Delay.delay_ms(1000);
    }
}
`
