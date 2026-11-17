// .vscode/settings.json（ch58x：无 launch.json / 无 gdbserver，仅 rust-analyzer 目标）
export const CH58X_VSCODE_SETTINGS_TPL = `{
  "rust-analyzer.cargo.target": "<%- target %>",
  "rust-analyzer.check.allTargets": false
}
`
