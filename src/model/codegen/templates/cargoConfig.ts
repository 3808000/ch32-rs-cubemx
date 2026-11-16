// 单核工程 .cargo/config.toml（target/runner/build-std）
export const CARGO_CONFIG_TPL = `# 由 ch32-rs-CubeMX 生成 —— 重新导出会覆盖本文件
[build]
<% if (jsonTarget) { -%>
target = "<%- jsonTargetFile %>"
<% } else { -%>
target = "<%- target %>"
<% } -%>

[target."<%- target %>"]
runner = "wlink -v flash --enable-sdi-print --watch-serial"

# 构建档位别名（profile 定义在 Cargo.toml 标记区内）
[alias]
build-size = "build --profile release-size"
build-speed = "build --profile release-speed"
build-debug = "build --profile release-debug"

<% if (jsonTarget) { -%>
[unstable]
build-std = ["core"]
json-target-spec = true
<% } -%>
`
