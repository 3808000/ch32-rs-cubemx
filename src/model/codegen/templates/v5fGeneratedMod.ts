// 双核 V5F 侧 generated/mod.rs 骨架（时钟快照+空 init）
export const V5F_GENERATED_MOD_TPL = `// 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
// V5F 从核骨架：当前数据模型只提供一份（V3F 侧的）引脚/外设配置，
// 因此从核只生成时钟快照与空 init；RCC/GPIO 由启动核统一初始化。

<% if (clockUsed) { -%>
pub mod clock;
<% } -%>

/// V5F 侧聚合对象（暂无外设字段）
pub struct Generated {}

pub fn init() -> Generated {
    Generated {}
}
`
