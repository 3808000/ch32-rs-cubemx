// 单核工程 README.md（工程报告/文件清单/构建/烧录/用户区约定）
export const README_TPL = `# <%- projectName %>

由 ch32-rs-CubeMX 生成的 Rust 工程：芯片 <%- chip %>（<%- chipPackage %>，target \`<%- target %>\`），基于 [ch32-hal](https://github.com/ch32-rs/ch32-hal)（rev \`<%- halRev %>\`）。

## 工程报告

### 引脚占用

<%- pinTable %>

### 时钟

<%- clockTable %>

### 外设实例

<%- peripheralTable %>
<% if (interruptTable) { -%>

### 中断

<%- interruptTable %>
<% } -%>

### Flash / RAM 预算

<%- budgetTable %>

> 容量来自芯片数据（\`chip.json\`）；实际占用以构建产物（\`cargo size\` 等）为准。

### 生成信息

<%- metadataTable %>

## 文件清单

<% files.forEach(function(f){ -%>
- \`<%- f.path %>\`：<%- f.desc %>
<% }) -%>
<% if (vendorHal) { -%>
- \`vendor/ch32-hal/\`：完整 HAL 源码（path 依赖），由导出层从内嵌资产写入
<% } -%>

## 配置回读（cube.json）

工程根目录的 \`cube.json\` 是本工程的配置快照（等价于 STM32CubeMX 的 \`.ioc\`）：在 ch32-rs-CubeMX 的 Home 页点击「导入工程配置」，或直接把文件拖入窗口，即可在此基础上继续编辑引脚/时钟/外设并重新导出。

## 构建

\`\`\`bash
cargo build --release
\`\`\`

目标 triple 已由 \`.cargo/config.toml\` 指定，无需额外 \`--target\` 参数。
<% if (nightly) { -%>
rv32ec 是 tier-3 目标：首次构建会经 \`rust-toolchain.toml\` 自动安装 nightly 并用 build-std 编译 core。
<% } -%>

### 构建档位

<%- toolchainTable %>

别名定义在 \`.cargo/config.toml\` 的 \`[alias]\`，profile 定义在 \`Cargo.toml\` 标记区内（重新导出会更新）。当前选择的档位：\`<%- profile %>\`。

## 烧录与串口

\`\`\`bash
# 方式一：cargo run（走 .cargo/config.toml 里的 runner）
cargo run --release

# 方式二：直接调用 wlink
wlink -v flash --enable-sdi-print --watch-serial target/<%- target %>/release/<%- packageName %>
\`\`\`

\`--enable-sdi-print\` 开启单线调试打印；代码里调用 \`hal::debug::SDIPrint::enable()\` 后即可用 \`hal::println!\` 输出，串口输出由 \`--watch-serial\` 转发。
<% if (ideConfig) { -%>

## VSCode 配置

已生成 \`.vscode/settings.json\`（rust-analyzer target / check.allTargets）与 \`.vscode/tasks.json\`（构建 / 烧录任务）。

<%- debugNote %>
<% } -%>
<% if (embassy) { -%>

## 异步运行时

本工程启用 embassy：入口为 \`#[embassy_executor::main(entry = "qingke_rt::entry")]\`，时基由 \`time-driver-tim2\` 提供（\`embassy_time::Timer\`）。
<% } -%>

## 用户代码约定（重要）

- \`src/generated/**\` 是**生成区**：每次重新导出整体重写，请勿在其中写业务代码；
- \`src/main.rs\` 是**用户区**：只在首次导出时创建，之后重新导出**永不覆盖**，可放心修改；
- 用户代码**不受目录位置限制**：可自由新增任意 Rust 模块（例如 \`src/app/\`、\`src/board/\`），在 \`src/main.rs\` 中用 \`mod app;\` 等自行声明即可；生成器只重写 \`src/generated/**\`，不会触碰这些文件；
- 需要新的引脚/外设配置时，回到 ch32-rs-CubeMX 修改后重新导出，用户代码原样保留。
<% if (vendorHal) { -%>

## vendor/ch32-hal（内嵌 HAL 源码）

本工程通过 path 依赖引用 \`vendor/ch32-hal\`：完整 HAL 源码就在工程内，可直接跳转/阅读实现，无需联网即可构建。

升级方法：用对应 rev 的完整源码替换 \`vendor/ch32-hal\` 目录，并同步本工程记录的 HAL rev（见文首与 \`cube.json\` 的 \`hal.rev\`）；也可在 ch32-rs-CubeMX 中升级 HAL 版本后重新导出。
<% } -%>
`