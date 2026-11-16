// 单核工程 Cargo.toml（HAL 依赖/embassy 可选/profile 优化参数）
// 整个文件包在生成标记区内：重新导出只替换区内内容，区外用户依赖/profile 保留。
export const CARGO_TOML_TPL = `# >>> ch32-cubemx generated >>>
# 由 ch32-rs-CubeMX 生成 —— 重新导出只更新标记区内内容（标记区外内容会保留）
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

# 工具链档位（M4.4）：用 .cargo/config.toml 的 build-size/build-speed/build-debug 别名调用。
# Cargo 要求自定义 profile 显式 inherits（release 基准，不改变默认 release 构建）。
[profile.release-size]
inherits = 'release'
opt-level = 'z'
lto = 'fat'
strip = 'symbols'

[profile.release-speed]
inherits = 'release'
opt-level = 3

[profile.release-debug]
inherits = 'release'
debug = 2
opt-level = 's'
# <<< ch32-cubemx generated <<<
`
