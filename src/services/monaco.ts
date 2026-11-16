// Monaco Editor 初始化与语言注册（代码实时预览面板专用，规格见提示词 §6.5）。
// 预览为只读形态：rust/json/markdown/ini 用内置基础 tokenizer，toml 自行注册；
// 全部语言共用 editor.worker（基础 worker），不挂语言服务 worker。
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// Vite 通过 ?worker 后缀把 worker 独立打包；MonacoEnvironment 必须在任何
// editor 创建之前就位，因此放在模块顶层（静态 import 保证了加载顺序）。
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

let initialized = false

/**
 * 幂等初始化：注册 TOML 语言（Monaco 无内置 TOML），返回 monaco 命名空间。
 * 多次调用安全，注册逻辑只执行一次。
 */
export function ensureMonaco(): typeof monaco {
  if (!initialized) {
    initialized = true
    monaco.languages.register({ id: 'toml', extensions: ['.toml'], aliases: ['TOML'] })
    monaco.languages.setMonarchTokensProvider('toml', {
      tokenizer: {
        root: [
          // 行注释
          [/#.*$/, 'comment'],
          // 表头 [section] / [[array-of-tables]]
          [/\[\[[^\]\n]*\]\]/, 'type.identifier'],
          [/\[[^\]\n]*\]/, 'type.identifier'],
          // 多行字符串（粗匹配）与单行字符串
          [/"""(?:[^"\\]|\\.)*"""/, 'string'],
          [/'''(?:[^'\\]|\\.)*'''/, 'string'],
          [/"(?:\\.|[^"\\\n])*"/, 'string'],
          [/'(?:\\.|[^'\\\n])*'/, 'string'],
          // 键值对的键与等号（在字符串之后，避免吞掉带引号的键）
          [/([ \t]*)([A-Za-z0-9_.-]+)([ \t]*)(=)/, ['white', 'variable.name', 'white', 'delimiter']],
          // 布尔
          [/\b(?:true|false)\b/, 'keyword'],
          // 日期时间（TOML 原生类型）
          [/\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?/, 'number'],
          // 浮点 / 整数（含正负号）
          [/[+-]?\d+\.\d+(?:[eE][+-]?\d+)?/, 'number.float'],
          [/[+-]?\d+/, 'number'],
        ],
      },
    })
  }
  return monaco
}

/**
 * 按文件扩展名推断 Monaco 语言 id。
 * .rs→rust、.toml→toml、.json→json、.md→markdown、.x（链接脚本）→ini，其余 plaintext。
 */
export function languageOf(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.rs')) return 'rust'
  if (lower.endsWith('.toml')) return 'toml'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.x')) return 'ini'
  return 'plaintext'
}

// 导出 monaco 命名空间，组件侧统一从这里取，避免多处直连 monaco-editor
export { monaco }
