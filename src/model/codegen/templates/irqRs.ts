// src/generated/irq.rs（NVIC/PFIC 中断使能与优先级）
// HAL 签名核对：reference/ch32-hal/src/interrupt_ext.rs
//   InterruptExt::enable() 为 unsafe；set_priority(Priority) 内部包 unsafe；
//   Priority 变体 P0..P15，由 ch32_hal::interrupt 重导出。
export const IRQ_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// NVIC/PFIC：按 cube.json 的 interrupts 使能中断并设置优先级。

use ch32_hal::interrupt::{Interrupt, InterruptExt, Priority};

/// 使能配置中的中断并设置抢占优先级。
pub fn init() {
<% items.forEach(function(i){ -%>
    // <%- i.irq %>（IRQ <%- i.number %>）优先级 P<%- i.priority %>
    unsafe { Interrupt::<%- i.pac %>.enable(); }
    Interrupt::<%- i.pac %>.set_priority(Priority::P<%- i.priority %>);
<% }) -%>
}
`