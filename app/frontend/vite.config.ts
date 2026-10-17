import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// 不用 SvelteKit：本项目是单窗口 SPA，且有「桌面 + 容器」两个构建入口。
//
// ## base: './' 是必须的
//
// Wails 用 `embed.FS` 从**根**加载资源，而 Vite 默认生成绝对路径
// （`/assets/xxx.woff2`）。在 Wails 的 asset server 里 `/assets/...` 能命中，
// 但在 file:// 加载或反向代理挂子路径时会 404——表现是**图标全变成文字**
// （字体没加载，liga 连字不生效），而构建完全不报错。
//
// 用相对路径后，index.html 与 CSS 里的引用都是 `./assets/...`，
// 三种加载方式（Wails / file:// / 子路径）都能工作。
export default defineConfig({
  base: './',
  plugins: [svelte(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
})
