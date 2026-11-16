// 双核 rust-toolchain.toml（nightly+rust-src+llvm-tools）
export const DUAL_RUST_TOOLCHAIN_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
# 双核两套自定义 target json（+xwchc / +b）需要 nightly + rust-src + build-std=core
[toolchain]
channel = "nightly"
components = ["rust-src", "llvm-tools-preview"]
`
