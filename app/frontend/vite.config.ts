import { readFileSync } from 'node:fs'
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
// 版本号从 package.json 注入，前端不再手写一份。
// 手写的版本号会在发版时忘记改，而「关于页显示旧版本」是最常见的报障信息。
function resolveVersion(): string {
  try {
    const rootPkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    if (rootPkg.version) return rootPkg.version
  } catch {}
  try {
    const localPkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    if (localPkg.version && localPkg.version !== '0.0.0') return localPkg.version
  } catch {}
  return '1.6.4'
}

function resolveBuildDate(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}.${month}.${day}`
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(resolveVersion()),
    __BUILD_DATE__: JSON.stringify(resolveBuildDate()),
  },
  plugins: [svelte(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
})
