// src/generated/mod.rs（模块声明、中断绑定、Generated 聚合）
export const MOD_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

<% modules.forEach(function(m){ -%>
pub mod <%- m %>;
<% }) -%>

<% if (irqs.length > 0) { -%>
// embassy 中断绑定（异步 USART/I2C 构造需要）
hal::bind_interrupts! {
    struct Irqs {
<% irqs.forEach(function(i){ -%>
        <%- i.irq %> => <%- i.handler %>;
<% }) -%>
    }
}

<% } -%>
/// 全部生成模块的聚合对象：main.rs 只需要拿这一个值
pub struct Generated {
<% fields.forEach(function(f){ -%>
    pub <%- f.name %>: <%- f.type %>,
<% }) -%>
}

pub fn init(p: hal::Peripherals) -> Generated {
<% if (inits.length === 0) { -%>
    let _ = p;
<% } -%>
<% calls.forEach(function(c){ -%>
    <%- c %>;
<% }) -%>
    Generated {
<% inits.forEach(function(c){ -%>
        <%- c.field %>: <%- c.call %>,
<% }) -%>
    }
}
`
