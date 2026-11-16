// 双核 V5F 从核 src/main.rs（用户区，不调用 hal::init）
export const DUAL_V5F_MAIN_TPL = `// 由 ch32-rs-CubeMX 生成 —— 本文件为用户区，重新导出不会覆盖
// 从核（V5F）：由 V3F 的 wake_other_core() 唤醒。共享 RCC/GPIO 已由 V3F 初始化，
// 这里绝不能再调用 hal::init（会重配共享 PLL）。
#![no_std]
#![no_main]

use panic_halt as _;

mod generated;

#[qingke_rt::entry]
fn main() -> ! {
<% if (clockUsed) { -%>
    // 引用生成的时钟配置（只读构建，不应用）；V5F 的实际时钟来自共享 RCC
    let _shared_rcc = generated::clock::rcc_config();
<% } -%>
    let _g = generated::init();
    loop {
        // TODO: 你的逻辑（V5F 计算核）
        core::hint::spin_loop();
    }
}
`
