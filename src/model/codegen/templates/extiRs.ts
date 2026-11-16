// src/generated/exti.rs（EXTI 输入集合与 init）
export const EXTI_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件

use ch32_hal as hal;

/// EXTI 输入集合。
/// 注意：边沿不在构造函数里，由 wait_for_* 系列 async 方法在运行期设置（需 embassy）。
pub struct Exti {
<% items.forEach(function(e){ -%>
    // 边沿: <%- e.edge %>（<%- e.waitFn %> 时生效）
    pub <%- e.ident %>: hal::exti::ExtiInput<'static>,
<% }) -%>
}

pub fn init(<%- params %>) -> Exti {
    Exti {
<% items.forEach(function(e){ -%>
        <%- e.ident %>: hal::exti::ExtiInput::new(<%- e.pinParam %>, <%- e.chParam %>, hal::gpio::Pull::<%- e.pull %>),
<% }) -%>
    }
}
`
