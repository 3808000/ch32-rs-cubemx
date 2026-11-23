import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

const srcRoot = fileURLToPath(new URL('./src/', import.meta.url))
const forbiddenLayers = {
  model: ['controllers', 'services', 'views', 'components'],
  services: ['controllers', 'views', 'components'],
  controllers: ['views', 'components'],
}

// 同时检查别名、相对路径和字面量动态导入，按目标文件所在层判断。
// 领域层可以依赖纯计算库，Vue、Pinia、Element Plus 和 Tauri 只在上层使用。
const layerBoundary = {
  create(context) {
    const importer = context.physicalFilename
    const layer = relative(srcRoot, importer).split(sep)[0]
    const blocked = forbiddenLayers[layer]
    if (!blocked) return {}

    function checkImport(node) {
      const specifier = node.source?.value
      if (typeof specifier !== 'string') return
      if (layer === 'model' && /^(?:vue|pinia|element-plus|@vue\/[^/]+|@element-plus\/[^/]+|@tauri-apps\/[^/]+)(?:\/|$)/.test(specifier)) {
        context.report({ node: node.source, message: `model 层不得依赖界面或桌面库 ${specifier}。` })
        return
      }
      const target = specifier.startsWith('@/')
        ? resolve(srcRoot, specifier.slice(2))
        : specifier.startsWith('./') || specifier.startsWith('../') || isAbsolute(specifier)
          ? resolve(dirname(importer), specifier)
          : null
      if (!target) return

      const targetLayer = relative(srcRoot, target).split(sep)[0]
      if (blocked.includes(targetLayer)) {
        context.report({ node: node.source, message: `${layer} 层不得依赖 ${targetLayer} 层。` })
      }
    }

    return {
      ImportDeclaration: checkImport,
      ExportAllDeclaration: checkImport,
      ExportNamedDeclaration: checkImport,
      ImportExpression: checkImport,
      TSImportType: checkImport,
    }
  },
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

  {
    name: 'app/layer-boundaries',
    files: ['src/**/*.{ts,mts,tsx,vue}'],
    plugins: { app: { rules: { 'layer-boundary': layerBoundary } } },
    rules: { 'app/layer-boundary': 'error' },
  },
)
