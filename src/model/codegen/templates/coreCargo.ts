// 双核单个核 crate 的 Cargo.toml（按核裁剪 feature）
export const CORE_CARGO_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
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
`
