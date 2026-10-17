import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// 不用 SvelteKit：本项目是单窗口 SPA，且有「桌面 + 容器」两个构建入口。
// Tailwind 用官方 Vite 插件（v4 的推荐方式），不用 PostCSS——
// 少一层配置，构建也快。
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
})
