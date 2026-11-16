// 双核单个核 crate 的 Cargo.toml（按核裁剪 feature）
// 整个文件包在生成标记区内：重新导出只替换区内内容，区外用户依赖/profile 保留。
export const CORE_CARGO_TPL = `# >>> ch32-cubemx generated >>>
# 由 ch32-rs-CubeMX 生成 —— 重新导出只更新标记区内内容（标记区外内容会保留）
[package]
name = "<%- coreName %>"
version = "0.1.0"
edition = "2024"

[[bin]]
name = "<%- coreName %>"
path = "src/main.rs"
harness = false

[dependencies]
ch32-hal = { workspace = true, features = [<%- halFeatures %>] }
qingke-rt = { version = "0.8.4", features = [<%- rtFeatures %>] }
qingke = { version = "0.8.4", features = [<%- qingkeFeatures %>] }
<% if (mainCore) { -%>
embedded-hal = "1.0.0"
<% } -%>
panic-halt = "1.0.0"
# <<< ch32-cubemx generated <<<
`
