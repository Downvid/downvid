# 产品官网（Vercel 静态托管）

单文件静态落地页，**一个发布目标**：

- **Vercel**：<https://downvid-coral.vercel.app>（`vercel.json` 指定 `outputDirectory: "website"`，
  全球 Edge CDN 加速；项目 `downvid` 已连上 GitHub 仓库，推送 `main` 自动部署）

GitHub Pages **不再使用**：仓库从未在 Settings → Pages 里选过源（`has_pages=false`），
`actions/configure-pages` 因此只会稳定报 `Get Pages site failed`。那个工作流
（`.github/workflows/pages.yml`）已删除，不要再恢复——恢复后又会红叉，除非有人先去网页设置里启用 Pages。

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

推送 `main` 即发布（Vercel 的 Git 集成，命中 `website/**` 或 `vercel.json` 时重建）。
本地预览：

```bash
pnpm exec vercel dev      # 或直接 open website/index.html
```

`vercel.json` 把 `buildCommand` / `installCommand` 覆盖成 `echo`，避免 Vercel 误判为 Vite
项目后去跑 Electron 构建；`cleanUrls: true` 让 `/index.html` 与 `/` 等价。
`.vercelignore` 排除 `backend/ electron/ src/ tests/ docs/`，部署体积只有几百字节。

## 校验

推送前跑一次 `pnpm lint:website`（CI 的 frontend job 也会跑）。它拦的是**本地看不出来、
线上才会出现**的四类问题：

| 检查 | 不管会怎样 |
| --- | --- |
| 引用的仓库资源存在（og:image / favicon / 截图） | 文件改名后线上裂图，本地无提示 |
| 中英词条**双向**成对（`data-i18n` ↔ `I18N.en`） | 缺英文的条目切到英文仍显示中文 |
| 配色与 `src/style.css` 的 `@theme` 一致 | 官网与应用颜色渐渐不像一家人 |
| 零依赖（除 Google Fonts 外无外链脚本/样式） | 「无构建、无依赖」的前提被悄悄破坏 |
| 下载量标记格式（`<b data-download-count>N</b>`） | 刷新脚本找不到落点，数字再也更新不了 |

## 下载量

hero 里的「已被下载 N 次」是**静态数字**，取 GitHub Releases 全部产物 `download_count` 之和：

```bash
pnpm website:stats     # 从 GitHub API 汇总并写回 index.html
```

**刻意不做实时拉取**，两条理由：

1. 官网约定零第三方依赖，不引 shields.io 的图片请求（国内还可能加载失败）
2. 未认证的 GitHub API 限额是 **60 次/小时且按出口 IP 共享**（1.3.3 的贡献者列表 403
   事故就是它），前端 fetch 得为 403 写一套降级 UI，不值得

代价是数字会停在**上次刷新的时刻**。发布新版后顺手跑一次即可；`lint:website` **不**比对
数字是否最新——它分钟级在动（写这段时的实测：几分钟内自己涨了十几次），放进 CI 必然随机红。

## 约定

- **配色取自应用本身**（`src/style.css` 的 `@theme`）：主色 `#8c5100`、强调色
  `#ff9800`、背景 `#fff8f4`。改色时两边一起改（`lint:website` 会比对）。
- **文案与 README 保持一致**：功能、平台支持、依赖说明都以 README 为准。
  落地页可以更精简，但不能出现 README 里没有的承诺。
- **下载链接指向 Releases 页面**，不写死具体产物名 —— 产物名随版本变化，
  写死会变成死链（`scripts/gen-release-notes.mjs` 已用扫描方式规避同样的问题）。
- 中英双语切换是纯前端实现（读 `?lang=` 或浏览器语言），无后端。
