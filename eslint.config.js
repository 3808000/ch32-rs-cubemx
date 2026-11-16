import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

/**
 * MVC 分层边界规则。
 *
 * 核心规则 no-restricted-imports 没有 zones 选项（zones 属于 eslint-plugin-import），
 * 这里用等价的 flat config 组合实现：files 限定被约束的层，patterns.regex 匹配被禁止的层。
 * 依赖方向必须单向向下：views/components → controllers → services → model。
 *
 * @param {string} name 规则块名（eslint --debug 可见）
 * @param {string[]} files 受约束的文件 glob
 * @param {string[]} forbiddenLayers 禁止 import 的层（src 下的目录名）
 * @param {string} message 违规提示（中文）
 */
function layerBoundary(name, files, forbiddenLayers, message) {
  return {
    name,
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // 仅匹配 `@/` 别名导入；相对路径跨层由 review 兜底（项目约定统一用别名）。
              regex: `^@/(${forbiddenLayers.join('|')})(?:/|$)`,
              message,
            },
          ],
        },
      ],
    },
  }
}

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },
  {
    name: 'app/files-to-ignore',
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/reference/**',
      '**/coverage/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'release/**',
    ],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // ---- MVC 分层边界（依赖只能向下：views/components → controllers → services → model）----
  layerBoundary(
    'app/layer-model',
    ['src/model/**/*.{ts,mts,tsx,vue}'],
    ['controllers', 'views', 'components', 'services'],
    'model 层必须保持纯净：禁止 import controllers/views/components/services，请改为参数注入或把代码上移。',
  ),
  layerBoundary(
    'app/layer-services',
    ['src/services/**/*.{ts,mts,tsx,vue}'],
    ['controllers', 'views', 'components'],
    'services 层不得依赖 controllers/views/components，请把状态与 UI 逻辑留在上层。',
  ),
  layerBoundary(
    'app/layer-controllers',
    ['src/controllers/**/*.{ts,mts,tsx,vue}'],
    ['views', 'components'],
    'controllers 层不得依赖 views/components，视图应通过 store 读取状态。',
  ),
)