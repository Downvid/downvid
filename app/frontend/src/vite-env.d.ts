/// <reference types="vite/client" />

// Vite 的资源导入类型：图片与 `?raw` 都需要声明，
// 否则 `tsc --noEmit` 会把每个 `import x from './a.jpg'` 判成找不到模块。
// vite/client 已覆盖常见图片与 `?raw`，这里只补它没覆盖的。
