// HTML 单文件工程报告（M6）的静态外壳：内联 CSS（浅色主题/系统字体）+ 页面骨架。
// 约定：
// - 骨架只含两个占位符 <!--REPORT_TITLE--> 与 <!--REPORT_BODY-->，由渲染层用 split/join 替换
//   （不用正则 replace，避免替换串里的 $ 被特殊解释）；动态内容一律先在渲染层 HTML 转义。
// - 无外部依赖、无 JS：离线双击即可完整阅读；不含时间戳/随机值，输出确定性。

/** 内联样式：浅色主题、系统字体栈、表格与文件组徽章配色。 */
export const HTML_REPORT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0 auto; padding: 24px 16px 48px; max-width: 1080px;
  background: #fafbfc; color: #1f2329; line-height: 1.6;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e8eb; }
.sub { color: #6b7280; margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; background: #fff; font-size: 14px; }
th, td { border: 1px solid #e5e8eb; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f5f7fa; font-weight: 600; white-space: nowrap; }
tbody tr:nth-child(even) td { background: #fcfcfd; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 13px; background: #f3f4f6; padding: 1px 5px; border-radius: 4px;
}
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; }
.badge-generated { background: #dbeafe; color: #1d4ed8; }
.badge-project_file { background: #dcfce7; color: #15803d; }
.badge-user_code { background: #fef3c7; color: #b45309; }
.badge-pack { background: #f3e8ff; color: #7e22ce; }
.empty { color: #6b7280; }
.kv th { width: 180px; }
footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e5e8eb; color: #6b7280; font-size: 13px; }
@media print { body { background: #fff; padding: 0; } }
`.trim()

/** 页面骨架：占位符 <!--REPORT_TITLE-->（<title> 内）与 <!--REPORT_BODY-->（<body> 内）。 */
export const HTML_REPORT_SHELL = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><!--REPORT_TITLE--></title>
<style>
${HTML_REPORT_CSS}
</style>
</head>
<body>
<!--REPORT_BODY-->
</body>
</html>
`