// src/generated/mod.rs（模块声明 + Generated 聚合 + init）
export const MOD_RS_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch5xx_hal as hal;

<% modules.forEach(function(m){ -%>
pub mod <%- m %>;
<% }) -%>

/// 全部生成模块的聚合对象：main.rs 只需要拿这一个值
pub struct Generated {
<% fields.forEach(function(f){ -%>
    pub <%- f.name %>: <%- f.type %>,
<% }) -%>
}

pub fn init(p: hal::Peripherals) -> Generated {
<% if (fields.length === 0) { -%>
    let _ = p;
<% } -%>
    Generated {
<% fields.forEach(function(f){ -%>
        <%- f.name %>: <%- f.init %>,
<% }) -%>
    }
}
`