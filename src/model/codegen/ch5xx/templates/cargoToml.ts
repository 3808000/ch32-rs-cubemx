// 单核 Cargo.toml（ch5xx-hal，M17 契约 D2 三档矩阵）。
// blocking：["ch582", "rt", "memory-x"]
// embassy ：+ ["embassy", "time-driver-tmr0"] + embassy-executor 0.10 / embassy-time 0.5.1 + [patch.crates-io]
// BLE     ：["ch582", "rt", "memory-x"]（不启 hal 的 embassy/time-driver；shim 自带 embassy-sync 0.8）
// 整个文件包在生成标记区内：重新导出只替换区内内容，区外用户依赖/profile 保留。
export const CARGO_TOML_TPL = `# >>> ch32-cubemx generated >>>
# 由 ch32-rs-CubeMX 生成 —— 重新导出只更新标记区内内容（标记区外内容会保留）
[package]
name = "<%- packageName %>"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "<%- packageName %>"
harness = false

[dependencies]
<% if (vendorHal) { -%>
# 完整 ch5xx-hal 源码由导出层内嵌到 vendor/ch5xx-hal，便于直接查阅/跳转
ch5xx-hal = { path = "vendor/ch5xx-hal", default-features = false, features = <%- halFeatures %> }
<% } else { -%>
# ch5xx-hal 未发布 crates.io：git 依赖并锁定 rev（升级 rev 前须重新核对 API）
ch5xx-hal = { git = "<%- halGit %>", rev = "<%- halRev %>", default-features = false, features = <%- halFeatures %> }
<% } -%>
# ch5xx-hal 不 re-export entry：qingke-rt 必须是直接依赖（0.8.4 与 HAL 同代）
qingke-rt = { version = "0.8.4", features = ["highcode"] }
panic-halt = "1.0"
# SPI 的 MODE_0/MODE_3 常量来自 embedded-hal 1.0（Config.mode 的类型）
embedded-hal = "1.0"
<% if (ble) { -%>
# BLE busy-poll 档：不启用 hal 的 embassy/time-driver feature（shim 直接推 TMOS 泵）。
# ch5xx-ble 是我方 shim crate（无 git 上游）：始终 path 依赖，导出层会内嵌 vendor/ch5xx-ble。
ch5xx-ble = { path = "vendor/ch5xx-ble" }
# shim pubsub 用 crates.io embassy-sync 0.8（与本工程同一版本，避免 trait 不一致）
embassy-sync = "0.8"
critical-section = "1.2"
portable-atomic = { version = "1.11", features = ["critical-section"] }
<% } else if (embassy) { -%>
embassy-executor = { version = "0.10.0", features = ["platform-riscv32", "executor-thread", "portable-atomic"] }
embassy-time = { version = "0.5.1", features = ["tick-hz-1_000_000"] }
portable-atomic = { version = "1.11", features = ["critical-section"] }
<% } -%>

[profile.release]
panic = "abort"
opt-level = "z"
lto = true
codegen-units = 1

# 调试档位（GDB 符号；.vscode/launch.json 的 preLaunchTask 使用）
[profile.release-debug]
inherits = "release"
debug = 2
strip = false
<% if (embassy && !ble) { -%>

# 逐字照 reference/ch5xx-hal/examples/ch582/Cargo.toml：embassy 0.10/0.5 与本 HAL 需要同一 git rev
[patch.crates-io]
embassy-executor = { git = "<%- embassyGit %>", rev = "<%- embassyRev %>" }
embassy-executor-timer-queue = { git = "<%- embassyGit %>", rev = "<%- embassyRev %>" }
embassy-sync = { git = "<%- embassyGit %>", rev = "<%- embassyRev %>" }
embassy-time = { git = "<%- embassyGit %>", rev = "<%- embassyRev %>" }
embassy-time-driver = { git = "<%- embassyGit %>", rev = "<%- embassyRev %>" }
embassy-time-queue-utils = { git = "<%- embassyGit %>", rev = "<%- embassyRev %>" }
embassy-usb = { git = "<%- embassyGit %>", rev = "<%- embassyRev %>" }
embassy-usb-driver = { git = "<%- embassyGit %>", rev = "<%- embassyRev %>" }
<% } -%>
<% if (ble && vendorHal) { -%>

# ch5xx-ble 的 Cargo.toml 以 git rev 依赖 ch5xx-hal；vendor 模式下必须把该 git 源
# patch 到工程内嵌的 vendor/ch5xx-hal，否则会出现两份 HAL、UartTx 等类型不兼容。
[patch."https://github.com/ch32-rs/ch5xx-hal"]
ch5xx-hal = { path = "vendor/ch5xx-hal" }
<% } -%>
# <<< ch32-cubemx generated <<<
`