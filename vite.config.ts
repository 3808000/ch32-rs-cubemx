/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))
const stub = fileURLToPath(new URL('./src/services/nodeStub.ts', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // 分层路径别名：@/model、@/services、@/controllers、@/views、@/components
      '@': src,
      // ejs 在浏览器端仅用 client:true 编译模板，fs/path 只被惰性引用；
      // 提供空 stub 避免运行时加载 node 内置模块
      fs: stub,
      path: stub,
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // Monaco 体积较大，单独分包避免主 chunk 超限告警
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['monaco-editor'],
          element: ['element-plus'],
        },
      },
    },
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})