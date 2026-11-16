// 双核 workspace 根 Cargo.toml（members/共享依赖/profile）
export const DUAL_ROOT_CARGO_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
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
`
