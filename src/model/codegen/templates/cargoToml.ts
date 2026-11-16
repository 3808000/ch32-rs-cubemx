// 单核工程 Cargo.toml（HAL 依赖/embassy 可选/profile 优化参数）
export const CARGO_TOML_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[package]
name = "<%- packageName %>"
version = "0.1.0"
edition = "2024"

[[bin]]
name = "<%- packageName %>"
harness = false

[dependencies]
<% if (vendorHal) { -%>
# 完整 HAL 源码由导出层内嵌到 vendor/ch32-hal，便于直接查阅/跳转
ch32-hal = { path = "vendor/ch32-hal", default-features = false, features = [<%- halFeatures %>] }
<% } else { -%>
# ch32-hal 未发布 crates.io：git 依赖并锁定 rev（升级 rev 前须重新核对 API）
ch32-hal = { git = "<%- halGit %>", rev = "<%- halRev %>", default-features = false, features = [<%- halFeatures %>] }
<% } -%>
<% if (embassy) { -%>
embassy-executor = { version = "0.10.0", features = ["platform-spin", "executor-thread"] }
embassy-time = { version = "0.5.1" }
<% } -%>
qingke-rt = "0.8.4"
# unsafe-trust-wch-atomics：WCH 内核无完整 CAS 实现，需信任其原子指令
qingke = { version = "0.8.4", features = ["unsafe-trust-wch-atomics"] }
embedded-hal = "1.0.0"
panic-halt = "1.0.0"

[profile.dev]
opt-level = 's'

[profile.release]
strip = false
codegen-units = 1
debug = 2
debug-assertions = false
incremental = false
lto = 'fat'
opt-level = 's'
overflow-checks = false
`
