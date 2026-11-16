// 双核根 .cargo/config.toml（仅 xtask 别名）
export const DUAL_CARGO_CONFIG_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
# 工程根只放 xtask 别名；每个核的 target/runner 在 <核>/.cargo/config.toml 中
[alias]
xtask = "run --package xtask --release --"
`
