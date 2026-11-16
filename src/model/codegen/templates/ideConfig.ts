// IDE（VSCode）配置模板：settings.json 走 EJS；tasks.json 结构简单，由 ideConfig.ts 组装后 JSON.stringify。
// 注意：不生成 launch.json —— wlink 是否提供 gdbserver 子命令尚未核实（禁止臆造调试链路）。
export const VSCODE_SETTINGS_TPL = `{
  "rust-analyzer.cargo.target": "<%- target %>",
  "rust-analyzer.check.allTargets": false<% if (nightly) { %>,
  "rust-analyzer.cargo.extraEnv": {
    "RUSTFLAGS": "-C target-feature=+xwchc"
  }<% } %>
}
`

/** README 中的调试说明（与是否生成 launch.json 的真实情况保持一致）。 */
export const VSCODE_DEBUG_NOTE =
  '调试配置待核实：wlink 是否提供 `gdbserver` 子命令尚未确认，因此本工程**未生成** `.vscode/launch.json`，避免写入未经验证的调试配置。'