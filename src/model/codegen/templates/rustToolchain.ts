// 单核工程 rust-toolchain.toml（stable+targets 或 nightly+rust-src）
export const RUST_TOOLCHAIN_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[toolchain]
<% if (nightly) { -%>
# tier-3 目标（rv32ec）：需 nightly + rust-src + build-std
channel = "nightly"
components = ["rust-src"]
<% } else { -%>
channel = "stable"
targets = ["<%- target %>"]
<% } -%>
`
