/// <reference types="vite/client" />

// Vite 的资源导入类型。
//
// `vite/client` 覆盖常见图片类型，但**不覆盖 `?raw`** —— 而
// `src/lib/announcement.ts` 用 `import zh from '../announcements/author.zh.md?raw'`
// 把公告文本编进产物。缺这个声明时 `tsc --noEmit` 会把它们判成找不到模块，
// 而 `vite build` 本身是能过的——所以这个错误只在类型检查时出现。
declare module '*?raw' {
  const content: string
  export default content
}

declare module '*.md?raw' {
  const content: string
  export default content
}
