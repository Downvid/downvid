/**
 * 空配置，用于**阻断向上查找**。
 *
 * ## 为什么需要这个文件
 *
 * 仓库根目录有一份 `postcss.config.js`（给 Electron 的 Vue 前端用），
 * 里面依赖 `@tailwindcss/postcss`。而 `app/frontend` 用的是
 * `@tailwindcss/vite` 插件 —— Tailwind v4 的推荐方式，**不需要 PostCSS**。
 *
 * 问题是 PostCSS 的配置解析会**从当前目录一路往上找**，于是它在
 * `app/frontend` 里找不到配置，就用了根目录那份，然后去加载只装在根
 * `node_modules` 里的 `@tailwindcss/postcss`。
 *
 * 本地不会暴露这个问题（pnpm 的 node_modules 提升让包能找到），
 * 但 CI 里 `app/frontend` 是独立安装的 —— 于是：
 *
 *   [vite:css] Failed to load PostCSS config
 *   Cannot find module '@tailwindcss/postcss'
 *
 * 出现一个空配置后，PostCSS 在这里就停下（找到配置了），不再往上找。
 */
export default {
  plugins: {},
}
