import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

/**
 * WebUI 构建配置（仅 Docker/Web 专用，完全隔离在 docker/ 目录下）。
 *
 * 输入：docker/web/index.html -> docker/web/entry.ts -> src/main.ts
 * 输出：docker/dist-web/
 *
 * 完全不触碰根目录的 vite.config.ts 与 electron 构建链路。
 */

const ROOT = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(ROOT, 'src'),
    },
  },
  build: {
    outDir: path.resolve(ROOT, 'docker/dist-web'),
    emptyOutDir: true,
  },
  plugins: [
    vue(),
  ],
})
