// 双核工程 README.md（分工表/构建/烧录/合并/时钟）
export const DUAL_README_TPL = `# <%- projectName %>（<%- chip %> 双核工程）

由 ch32-rs-CubeMX 生成：芯片 <%- chip %>（<%- chipPackage %>），QingKe <%- coreSummary %>。
工程是 Cargo workspace，V3F 启动核与 V5F 计算核各一个 crate，另有 \`xtask\` 负责双核构建/烧录/合并。

## 文件清单

<% files.forEach(function(f){ -%>
- \`<%- f.path %>\`：<%- f.desc %>
<% }) -%>
<% if (vendorHal) { -%>
- \`vendor/ch32-hal/\`：完整 HAL 源码（path 依赖），由导出层从内嵌资产写入工程根
<% } -%>

## 双核分工

| 核 | 目录 | ch32-hal feature | target | 职责 |
|---|---|---|---|---|
<% cores.forEach(function(c){ -%>
| <%- c.label %> | \`<%- c.id %>/\` | \`<%- c.halFeature %>\` | \`<%- c.target %>\` | <%- c.mainCore ? '启动核：RCC/GPIO/外设初始化，唤醒 V5F' : '从核：等待 V3F 唤醒，只跑自己的逻辑' %> |
<% }) -%>

- reset 只启动 V3F；V3F 在 \`main.rs\` 里调用 \`qingke::pfic::wake_other_core(0x0001_0000)\` 唤醒 V5F。
- **共享外设（RCC/GPIO/AFIO/EXTI）只能在 V3F 初始化**：V5F 的 \`main.rs\` 不调用 \`hal::init\`。
- 两核通过共享 SRAM \`0x20178000\`（32K）做邮箱；flash 分区见两个 \`memory.x\`。

## 构建

双核各自使用自定义 target json，工具链固定为 nightly（\`rust-toolchain.toml\`，含 rust-src）：

\`\`\`bash
cargo xtask build
\`\`\`

等价于在两个核目录分别执行 \`cargo build --release\`；根目录直接 \`cargo build\` 不会套用各核的
\`.cargo/config.toml\`，请不要用根构建代替 xtask。

## 烧录

需要安装 [wlink](https://github.com/ch32-rs/wlink)：

\`\`\`bash
cargo install --git https://github.com/ch32-rs/wlink
cargo xtask flash
\`\`\`

xtask 先烧 V3F（\`--no-run\` 保持 halt），最后烧 V5F 时复位运行，保证两个镜像同时就位。
可用 \`WLINK_PROBE=VID:PID:SERIAL\` 固定探针。

## 合并镜像

\`\`\`bash
cargo xtask merge          # 输出 out/firmware.bin / out/firmware.hex
\`\`\`

## 时钟

<%- clockSummary %>

时钟代码生成走 HAL 配方（\`hal::rcc::Config::with_*\`）：H4 的 Config 不是可逐字段拼装的平铺结构，
数据层标记 \`fallback: preset_only\`，无匹配预设时导出会被阻止。

## 配置回读与用户代码

- 工程根 \`cube.json\` 是本工程的配置快照（等价于 STM32CubeMX 的 \`.ioc\`），可拖回 ch32-rs-CubeMX 继续编辑；
- \`<核>/src/generated/**\` 是生成区：每次重新导出整体重写，请勿写业务代码；
- \`<核>/src/main.rs\` 是用户区：**永不覆盖**，可自由修改；需要新外设时回到工具重新导出。
<% if (vendorHal) { -%>

## vendor/ch32-hal

两个核都通过 workspace 依赖 \`ch32-hal = { path = "vendor/ch32-hal" }\` 引用同一份 HAL 源码。
升级时用对应 rev 的完整源码替换该目录，并同步 \`cube.json\` 的 \`hal.rev\`。
<% } -%>
`
