// 单核 Cargo.toml（ch58x-hal：edition 2021、qingke-rt 0.5 直依赖、HAL features 恒 embassy）
// 整个文件包在生成标记区内：重新导出只替换区内内容，区外用户依赖/profile 保留。
export const CARGO_TOML_TPL = `# >>> ch32-cubemx generated >>>
# 由 ch32-rs-CubeMX 生成 —— 重新导出只更新标记区内内容（标记区外内容会保留）
[package]
name = "<%- packageName %>"
version = "0.1.0"
# edition 2021：qingke-rt 0.5 的 entry 宏发裸 #[export_name]，2024 需要 unsafe 包裹
edition = "2021"

[[bin]]
name = "<%- packageName %>"
harness = false

[dependencies]
<% if (vendorHal) { -%>
# 完整 ch58x-hal 源码由导出层内嵌到 vendor/ch58x-hal，便于直接查阅/跳转
# default-features=false + <%- ble ? 'embassy/ble：gpio.rs 无条件使用 embassy_sync（src/gpio.rs:14）；' + 'ble feature 额外链接 vendor/LIBCH58xBLE.a（build.rs:9-11）' : 'embassy：gpio.rs 无条件使用 embassy_sync（src/gpio.rs:14），且不启用 BLE' %>
ch58x-hal = { path = "vendor/ch58x-hal", default-features = false, features = <%- halFeatures %> }
<% } else { -%>
# ch58x-hal 未发布 crates.io：git 依赖并锁定 rev（升级 rev 前须重新核对 API）
ch58x-hal = { git = "<%- halGit %>", rev = "<%- halRev %>", default-features = false, features = <%- halFeatures %> }
<% } -%>
# ch58x-hal 不 re-export entry：qingke-rt 必须是直接依赖（禁止 0.8.x，与本 HAL 的 qingke 0.5 代不匹配）
qingke-rt = { version = "0.5.0", features = ["highcode"] }
panic-halt = "0.2.0"
<% if (ble) { -%>
# BLE busy-poll 档（M13）：不用 embassy-executor / embassy-time（stable 工具链即可，无 nightly feature）。
# 事件 try-poll 用 Subscriber::try_next_message_pure（embassy-sync 0.6.2，须与 HAL 的版本一致）；
# 共享状态用 static mut + critical_section（qingke 的 critical-section-impl 由 HAL 启用）。
embassy-sync = "0.6.2"
critical-section = "1.2"
# 链接修复（同 blocking 档）：HAL 非可选依赖 embassy-time-queue-utils 默认 integrated queue，
# 引用 embassy_executor::raw::wake_task → 需要应用提供 __pender；BLE busy-poll 无 executor 提供该符号，
# 显式启用 generic-queue（cargo feature 统一）改走通用 waker 队列。
embassy-time-queue-utils = { version = "0.1.0", features = ["generic-queue-8"] }
<% } else if (embassy) { -%>
embassy-executor = { version = "0.7.0", features = ["nightly", "arch-riscv32", "executor-thread"] }
embassy-time = "0.4.0"
<% } else { -%>
# blocking 档链接修复：HAL 非可选依赖 embassy-time-queue-utils 默认 integrated queue，
# 引用 embassy_executor::raw::wake_task → 需要应用提供 __pender（embassy 档由 main 宏提供）。
# blocking 无 executor，显式启用 generic-queue（cargo feature 统一）改走通用 waker 队列。
embassy-time-queue-utils = { version = "0.1.0", features = ["generic-queue-8"] }
<% } -%>

[profile.release]
panic = "abort"
opt-level = "z"
lto = true
codegen-units = 1

# 预留调试档位（GDB 符号；ch58x 本期不生成 launch.json，供用户/未来工具使用）
[profile.release-debug]
inherits = "release"
debug = 2
strip = false
# <<< ch32-cubemx generated <<<
`
