// 双核 workspace 根 Cargo.toml（members/共享依赖/profile）
// 整个文件包在生成标记区内：重新导出只替换区内内容，区外用户依赖/profile 保留。
export const DUAL_ROOT_CARGO_TPL = `# >>> ch32-cubemx generated >>>
# 由 ch32-rs-CubeMX 生成 —— 重新导出只更新标记区内内容（标记区外内容会保留）
[workspace]
members = [<%- members %>]
resolver = "2"

[workspace.dependencies]
# 双核共用同一份 HAL；每个核在自己的 Cargo.toml 里追加各自的 ch32-hal feature
ch32-hal = { <%- halDependency %> }

[profile.dev]
opt-level = "s"

[profile.release]
strip = false
codegen-units = 1
debug = 2
debug-assertions = false
incremental = false
lto = "fat"
opt-level = "s"
overflow-checks = false
# <<< ch32-cubemx generated <<<
`
