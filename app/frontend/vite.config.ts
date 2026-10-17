import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// 不用 SvelteKit：本项目是单窗口 SPA（loadFile + hash 传参），
// 且有「桌面 + 容器」两个构建入口。Kit 的 router/SSR/adapter 在这里
// 全是负担而没有收益（不需要 SEO、不需要服务端渲染）。
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true },
})
