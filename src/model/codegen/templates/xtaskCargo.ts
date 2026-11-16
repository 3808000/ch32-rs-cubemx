// 双核 xtask crate 的 Cargo.toml
// 整个文件包在生成标记区内：重新导出只替换区内内容，区外用户依赖/profile 保留。
export const XTASK_CARGO_TPL = `# >>> ch32-cubemx generated >>>
# 由 ch32-rs-CubeMX 生成 —— 重新导出只更新标记区内内容（标记区外内容会保留）
[package]
name = "xtask"
version = "0.0.0"
edition = "2021"
publish = false
# <<< ch32-cubemx generated <<<
`
