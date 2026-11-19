// rust-toolchain.toml（ch5xx）：nightly + rust-src（.cargo/config 的 [unstable] build-std=["core"]）。
export const RUST_TOOLCHAIN_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[toolchain]
# ch5xx 工程使用 build-std=["core"]（见 .cargo/config.toml）：core 由源码构建需要 nightly + rust-src
channel = "nightly"
components = ["rust-src"]
targets = ["<%- target %>"]
`