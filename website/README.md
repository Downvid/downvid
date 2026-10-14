# 产品官网（GitHub Pages）

单文件静态落地页，发布在 <https://yxxbc.github.io/downvid/>。

## 为什么是单文件

整站就是一个 `index.html`（样式与脚本内联）：无构建步骤、无依赖、改完直接推。这类
落地页的寿命比应用长，越少维护成本越好。**不要**为了它引入打包工具。

## 目录

```
website/
├── index.html      # 全部内容（HTML + 内联 CSS/JS）
└── README.md       # 本文件
```

## 部署

由 `.github/workflows/pages.yml` 自动发布：推送到 `main` 且改动命中 `website/**`
时触发，也可在 Actions 页面手动运行。

首次启用需要在仓库设置里选一次源：**Settings → Pages → Source 选 "GitHub Actions"**。
之后每次推送自动更新。

## 约定

- **配色取自应用本身**（`src/style.css` 的 `@theme`）：主色 `#8c5100`、强调色
  `#ff9800`、背景 `#fff8f4`。改色时两边一起改，避免官网与应用不一致。
- **文案与 README 保持一致**：功能、平台支持、依赖说明都以 README 为准。
  落地页可以更精简，但不能出现 README 里没有的承诺。
- **下载链接指向 Releases 页面**，不写死具体产物名 —— 产物名随版本变化，
  写死会变成死链（`scripts/gen-release-notes.mjs` 已用扫描方式规避同样的问题）。
- 中英双语切换是纯前端实现（读 `?lang=` 或浏览器语言），无后端。
