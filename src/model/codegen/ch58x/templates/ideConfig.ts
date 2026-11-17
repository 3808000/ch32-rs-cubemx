// .vscode/settings.json（ch58x：rust-analyzer 目标；M12 起另有 launch.json，见下方 MRS OpenOCD 常量）
export const CH58X_VSCODE_SETTINGS_TPL = `{
  "rust-analyzer.cargo.target": "<%- target %>",
  "rust-analyzer.check.allTargets": false
}
`

// ---------------------------------------------------------------------------
// M12 调试链（契约 D9）：MRS 随附的 WCH fork OpenOCD（wlinke + sdi + wch_riscv）。
// ch32rv 0.31.4 / wlink 0.1.3 / probe-rs 均不支持 CH58x；WCH MRS V3.0.0 的 OpenOCD 是唯一可用 GDB 服务器。
//
// 一次性 setup（README 同文，A2 负责接线）：
//   ln -s ~/mrs-openocd/bin/openocd ~/.local/bin/openocd-wch
//   export MRS_OPENOCD_CFG=~/mrs-openocd/bin/wch-riscv.cfg
// 任务/调试配置只引用 `openocd-wch`（PATH）与 ${env:MRS_OPENOCD_CFG}（环境变量），
// 因此工程可移植：换机器只需重跑上面两条。
//
// 硬前提（诚实标注，2026-11-18 实测）：芯片侧 CFG_DEBUG_EN 必须已开启（ISP/BOOT 两线调试），
// 否则 OpenOCD attach 报 "WCH-Link failed to connect with riscv chip"；开启需 WCHISPTool（Linux 下需
// 用户明确授权的 wchisp config 写操作）。BLE 生成/编译不依赖该开关。
// ---------------------------------------------------------------------------

/** MRS OpenOCD 启动器名（setup 中软链到 ~/.local/bin/openocd-wch）。 */
export const CH58X_MRS_OPENOCD_CMD = 'openocd-wch'

/** OpenOCD 板级 cfg 路径：由环境变量提供，避免工程写死用户目录。 */
export const CH58X_MRS_OPENOCD_CFG_ENV = '${env:MRS_OPENOCD_CFG}'

/** gdbserver 任务参数：`openocd-wch -f ${env:MRS_OPENOCD_CFG}`（wch-riscv.cfg 内建 3333 端口监听）。 */
export const CH58X_MRS_OPENOCD_CFG_ARGS = ['-f', CH58X_MRS_OPENOCD_CFG_ENV]

/** gdbserver 常驻任务 label（tasks.json）。 */
export const CH58X_GDB_SERVER_TASK_LABEL = 'gdbserver (MRS OpenOCD)'

/** MRS OpenOCD 烧录任务 label（写 flash，仅用户主动运行）。 */
export const CH58X_MRS_FLASH_TASK_LABEL = '烧录 (MRS OpenOCD)'

/** wchisp USB ISP 备用烧录任务 label（M11 保留）。 */
export const CH58X_WCHISP_FLASH_TASK_LABEL = '烧录 (wchisp)'

/** 默认构建任务 label（cargo build --release，M11 原样）。 */
export const CH58X_BUILD_TASK_LABEL = '构建'

/** 调试前构建任务 label：产出 release-debug（debug=2/strip=false）供 GDB 读符号，与 ch32 命名对齐。 */
export const CH58X_DEBUG_BUILD_TASK_LABEL = '构建 (release-debug)'

/** launch.json 配置名与 GDB 可执行文件（默认假设在 PATH，README 说明可改绝对路径）。 */
export const CH58X_DEBUG_CONFIG_NAME = 'Debug (MRS OpenOCD)'
export const CH58X_GDB_DEBUGGER_PATH = 'riscv-none-elf-gdb'

/** MRS OpenOCD wch-riscv.cfg 的 GDB 监听地址（实测 gdb 端口 3333）。 */
export const CH58X_GDB_SERVER_ADDRESS = 'localhost:3333'
