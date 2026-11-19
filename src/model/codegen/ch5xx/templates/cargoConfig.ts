// .cargo/config.toml（ch5xx）：target + build-std；链接参数由 build.rs 发出（-Tlink.x），
// memory.x 由 HAL 的 memory-x feature 经 metapac 提供（D2）。
export const CARGO_CONFIG_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[build]
target = "<%- target %>"

[unstable]
# 与 reference/ch5xx-hal/examples/ch582/.cargo/config.toml 一致：core 从源码构建（nightly + rust-src）
build-std = ["core"]

# 链接参数不放 rustflags：由工程 build.rs 发 cargo:rustc-link-arg-bins=-Tlink.x（顺序可控）。
`