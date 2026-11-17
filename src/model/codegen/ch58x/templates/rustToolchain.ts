// rust-toolchain.toml：blocking / BLE busy-poll 用 stable；embassy 用 nightly（impl_trait_in_assoc_type）
export const RUST_TOOLCHAIN_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[toolchain]
<% if (embassy) { -%>
# embassy 档：embassy-executor 的 impl_trait_in_assoc_type 需要 nightly
channel = "nightly"
targets = ["<%- target %>"]
<% } else { -%>
# stable：blocking 档与 BLE busy-poll 档（BLE 不使用 embassy 执行器/nightly feature）
channel = "stable"
targets = ["<%- target %>"]
<% } -%>
`
