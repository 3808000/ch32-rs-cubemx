// .cargo/config.toml（ch58x：无 build.rs，链接参数走 rustflags；memory.x 由 HAL build.rs 提供）
export const CARGO_CONFIG_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[build]
target = "<%- target %>"

[target."<%- target %>"]
# ch58x-hal 的 build.rs 把 memory.x 写入 OUT_DIR 并输出 link-search；
# 工程自身不生成 build.rs / memory.x，只需链接 link.x（与 HAL examples/.cargo/config.toml 一致）
rustflags = ["-C", "link-arg=-Tlink.x"]
`
