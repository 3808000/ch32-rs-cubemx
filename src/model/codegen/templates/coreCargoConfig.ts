// 双核单个核的 .cargo/config.toml（json target/build-std）
export const CORE_CARGO_CONFIG_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[build]
target = "<%- target %>.json"

[unstable]
build-std = ["core"]
json-target-spec = true

[target."<%- target %>"]
runner = "wlink -v flash"
`
