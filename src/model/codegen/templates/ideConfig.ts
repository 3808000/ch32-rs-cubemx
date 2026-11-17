// IDE（VSCode）配置模板：settings.json 走 EJS；tasks.json / launch.json 结构简单，由 ideConfig.ts 组装后 JSON.stringify。
// 调试后端核实结论（2026-11-17）：
// - ch32-rs/wlink 0.1.3 **没有** gdbserver 子命令（源码 Commands 枚举 + `wlink --help` 均为 dump/regs/erase/flash/
//   halt/resume/reset/status/...；upstream main 分支与 issues 也无），不能作为 GDB 服务器；
// - 改用 ch32rv 0.31.3 的 `ch32rv gdb`（gdbstub，默认 127.0.0.1:3333）。attach 不改写 flash，但**不支持
//   vFlash/`load`，也没有 monitor 命令**（docs/cli.ja.md §4.6），因此烧录必须单独用 `ch32rv flash`，
//   launch.json 不写 `monitor reset halt` / `load`（写了会报 unsupported）。
export const VSCODE_SETTINGS_TPL = `{
  "rust-analyzer.cargo.target": "<%- target %>",
  "rust-analyzer.check.allTargets": false<% if (nightly) { %>,
  "rust-analyzer.cargo.extraEnv": {
    "RUSTFLAGS": "-C target-feature=+xwchc"
  }<% } %>
}
`

/** ch32rv GDB 服务器监听地址（`ch32rv gdb --help` 默认 127.0.0.1:3333；GDB 端用 localhost 等价访问）。 */
export const CH32RV_GDB_SERVER_ADDRESS = 'localhost:3333'

/** ch32rv GDB 服务器任务 label（tasks.json 与 launch.json 之外的独立常驻任务）。 */
export const CH32RV_GDB_TASK_LABEL = 'gdbserver (ch32rv)'

/** ch32rv 烧录任务 label：GDB 服务器无 vFlash，烧录必须单独执行（会写 flash）。 */
export const CH32RV_FLASH_TASK_LABEL = '烧录 (ch32rv)'

/** ch32rv GDB 服务器任务命令行：`ch32rv gdb --reset-halt`（连接后复位并停在复位向量）。 */
export const CH32RV_GDB_TASK_COMMAND = 'ch32rv'
export const CH32RV_GDB_TASK_ARGS = ['gdb', '--reset-halt']

/** launch.json 调试配置名与 GDB 可执行文件（默认假设在 PATH，README 说明可改绝对路径）。 */
export const CH32RV_DEBUG_CONFIG_NAME = 'Debug (ch32rv gdbserver)'
export const CH32RV_GDB_DEBUGGER_PATH = 'riscv-none-elf-gdb'

/** 单核/双核调试前构建任务 label，必须与 tasks.json 生成的 label 完全一致。 */
export const SINGLE_CORE_DEBUG_TASK_LABEL = '构建 (release-debug)'
export const DUAL_CORE_DEBUG_TASK_LABEL = 'xtask: 构建'

/** README 中的调试说明（与是否生成 launch.json 的真实情况保持一致）。 */
export const VSCODE_DEBUG_NOTE =
  '调试（已核实）：ch32-rs/wlink 0.1.3 不含 `gdbserver` 子命令，因此 `.vscode/launch.json` 使用 **ch32rv 0.31.3** 的 ' +
  'GDB 服务器（`ch32rv gdb`，默认 `localhost:3333`，`request: attach`，不触发 load）。三步流：① 运行构建任务' +
  '（单核 `构建 (release-debug)`，双核 `xtask: 构建`）；② 运行 `烧录 (ch32rv)`（`ch32rv flash <ELF>`；' +
  'GDB 服务器**不支持 vFlash/`load`/`monitor`**，烧录会写 flash）；③ 运行任务 `gdbserver (ch32rv)`' +
  '（`ch32rv gdb --reset-halt`，常驻终端）后按 F5。' +
  '服务器每次只服务一个 GDB 会话，断开后需重新运行该任务。' +
  '`miDebuggerPath` 默认 `riscv-none-elf-gdb`（假设在 PATH；不在则改为绝对路径）。' +
  '若目标板无响应，`ch32rv gdb` 会在 attach 阶段退出、不会监听端口。'
