# 产品官网（Vercel 静态托管）

无构建的多文件静态落地页，**一个发布目标**：

- **Vercel**：<https://downvid-coral.vercel.app>（`vercel.json` 指定 `outputDirectory: "website"`，
  全球 Edge CDN 加速；项目 `downvid` 已连上 GitHub 仓库，推送 `main` 自动部署）

GitHub Pages **不再使用**：仓库从未在 Settings → Pages 里选过源（`has_pages=false`），
`actions/configure-pages` 因此只会稳定报 `Get Pages site failed`。那个工作流
（`.github/workflows/pages.yml`）已删除，不要再恢复——恢复后又会红叉，除非有人先去网页设置里启用 Pages。

## 为什么拆成三个文件

早期是一个 `index.html`（样式与脚本内联）。新版 UI 的 hero 预览变大后，继续单文件会让
HTML / CSS / JS 都难以维护，因此按职责拆成：

```
website/
├── index.html      # 语义结构 + 中英 data-i18n 占位
├── styles.css      # 官网样式 + 新版 UI 预览样式
├── app.js          # 下载区逻辑 / i18n / 可交互预览
└── README.md       # 本文件
```

仍然是**无构建、零依赖**：`index.html` 直接引用本地 `styles.css` / `app.js`，
只有 Google Fonts 是外部样式来源。**不要**为了它引入打包工具或第三方脚本。

## 部署

推送 `main` 即发布（Vercel 的 Git 集成，命中 `website/**` 或 `vercel.json` 时重建）。
本地预览：

```bash
pnpm exec vercel dev      # 或 python3 -m http.server --directory website
```

`vercel.json` 把 `buildCommand` / `installCommand` 覆盖成 `echo`，避免 Vercel 误判为 Vite
项目后去跑 Electron 构建；`cleanUrls: true` 让 `/index.html` 与 `/` 等价。
`.vercelignore` 排除 `backend/ electron/ src/ tests/ docs/`。

## 校验

推送前跑一次 `pnpm lint:website`（CI 的 frontend job 也会跑）。它拦的是**本地看不出来、
线上才会出现**的几类问题：

| 检查 | 不管会怎样 |
| --- | --- |
| 只允许本地 `styles.css` / `app.js`，不出现第三方脚本或样式表（字体 CDN 除外） | 「无构建、无依赖」的前提被悄悄破坏 |
| 引用的仓库资源存在（og:image / favicon / logo / demo-thumb） | 文件改名后线上裂图，本地无提示 |
| 中英词条**双向**成对（`data-i18n` ↔ `I18N.en`，以及脚本拼装的 `t('...')` / `I18N.zh`） | 缺英文的条目切到英文仍显示中文；脚本拼的会显示成 key 本身 |
| 配色与 `src/style.css` 的 `@theme` 一致 | 官网与应用颜色渐渐不像一家人 |
| `#osIcons` 里的平台图标与 `app.js` 的 `PLATFORMS` 双向对上 | 键名写错只是**没有图标**，线上不报错 |
| `app.js` 里的仓库坐标（`REPO`）与 `shared/app.ts` 一致 | 下载按钮指向别人的仓库 |
| 下载产物名模板与 `electron-builder.json5` 的 `artifactName` 一致 | 产物改名后所有平台都静默挑不到，只剩「去 Releases 页面」的兜底 |
| 版本号占位（`data-version`）存在且是 `v<数字>` 形态 | 刷新脚本找不到落点，版本号从此不再随发布更新 |
| `mailto:` 下的联系邮箱与 `shared/app.ts` 的 `CONTACT_EMAIL` 一致、主题已编码 | 地址写错时页面照常渲染，只是信寄不到；主题不编码会被邮件客户端截断 |

`tests/website-download.test.ts` 从 `app.js` 抽取「>>> 纯逻辑」块跑真实产物列表；
`tests/website-version.test.ts` 同时检查 `index.html` 的占位和 `app.js` 不重复写版本号。

## 在线演示（hero 预览）

hero 里那块预览**不是截图**，而是新版应用主界面的**可交互复刻**（纯 Vanilla JS，无框架）：

- 结构 / 文案 / 配色照 `app/frontend/demo/components/DownloadView.vue` / `ActivityPanel` /
  `EffortSlider` 的新 UI 搬过来；解析与下载换成本地动画
- 画布按应用窗口的 **1100px** 设计，外层用 `transform: scale()` 等比缩放到容器宽度
- **默认是新版首页**：命令条 + 四档 effort 滑块 + 44 周下载热力图 + 最近下载；
  点「解析」进入结果页，点「下载」才出现右侧任务队列，历史 / 关于标签页可直接点
- 能点的：示例链接、解析、格式单选、下载、历史 / 关于、中英切换、四档加速
- 缩略图用 `src/assets/demo-thumb.jpg`（raw 地址，新资源要推上 main 才生效）；
  列表里的三张小图是 CSS 渐变占位，避免依赖未提交的 poster 资源
- 改应用界面时要**同步这一份**；`lint:website` 会比对复刻里抄来的那批 `@theme` 颜色 token

## 下载区（按系统直链）

hero 的主按钮会识别访问者的系统，点击**直接下载**对应安装包，不跳转 Releases 页面：

1. 读 `navigator.userAgentData` / `userAgent` 判断系统与芯片。Chrome / Edge 还能通过
   Client Hints 读到架构；Safari / Firefox 读不到，macOS 默认给 Apple 芯片版
   （Intel 版固定列在「其他格式」里，用户自己点得到）
2. 页面加载时请求一次 `api.github.com/repos/<owner>/<repo>/releases/latest`，结果放
   `sessionStorage` 缓存 30 分钟。未认证限额是 60 次/小时且**按访问者 IP** 计，
   刷新页面不该重复消耗；存储被禁用只是每次重新请求，不影响下载
3. 在真实产物列表里按产物名模板挑包（`app.js` 里的 `ARTIFACTS`），按钮 `href`
   指向 `browser_download_url`。GitHub 对产物返回 `Content-Disposition: attachment`，
   所以点击即下载、不离开页面
4. 任何一步失败（离线 / 403 限流 / 产物缺失 / 系统未识别）都**退回 Releases 页面**：
   按钮不会留死链，也不会弹错误框

这是官网唯一一次外部请求，而且请求的是**自己的仓库**：下载目标是功能性信息，
值得一次带缓存的请求；hero 的下载量仍是静态数字（见下），因为那只是社会认同。
**不要**为了它引入第三方脚本或 shields.io 徽章。

产物名模板是这份逻辑唯一的脆弱点：模板与 `electron-builder.json5` 的 `artifactName`
对不上时不会报错，只是所有平台都挑不到产物。`pnpm lint:website` 会比对两者，
`tests/website-download.test.ts` 用真实的产物列表（含 `.blockmap` / `.zip` / `latest*.yml`
等干扰项）断言每个模板都能命中。

## 版本号（发布时自动刷新）

「关于软件」演示里的版本号带 `data-version` 标记，是一个**离线兜底值**：

```html
<p class="dv-about-version" id="dvAboutVersion" data-version>v1.4.0</p>
```

- 页面脚本加载后会请求 `releases/latest`，把它覆盖成真实 tag（`renderAlt` 与 `syncAppDemo` 里各有一处）
- 拉不到时（离线 / 被 GitHub 限流 / 禁用 `sessionStorage`）显示的就是这里的值
- 因此这个值**必须每次发布后刷新**，由 `release.yml` 在 Release 创建成功并自检通过后
  自动跑 `pnpm website:version`（`scripts/sync-website-version.mjs`）写入并提交回 `main`

**不要删 `data-version`**：刷新脚本靠它定位，`pnpm lint:website` 会校验它在不在。
也不要手工去改它——发布流程会覆盖，手工改反而会和 `package.json` 不一致。

## 赞助与商务合作

「加入开源社区」之后有一个独立的赞助与商务合作区，两张卡片直链
`mailto:xynrin@icloud.com`（赞助 / 商务各一个主题）：

- **邮箱是唯一来源**：`shared/app.ts` 的 `CONTACT_EMAIL`。官网、关于页、README 都指它，
  `pnpm lint:website` 会比对官网与它是否一致——写错不会报错，只是信寄不到
- **主题随语言切换**：`data-mail-subject` 存中文主题，`data-i18n-subject` 指向英文词条，
  `apply(lang)` 里重写 `href`。只写死中文主题时，英文用户点开会看到一封中文主题的邮件
- **主题必须编码**：裸的空格与方括号会被部分邮件客户端截断，`lint:website` 会拦

## 下载量 / 星标

hero 里的下载量与星标用 **README 同款 shields.io 徽章**，数字实时：

- 徽章是 `<img>`，不是脚本或样式，所以不破坏「零依赖」的约定；但它确实是**外部图片请求**
- `lint:website` 会核对徽章 URL 里的仓库坐标与 `shared/app.ts` 一致

## 约定

- **配色取自应用本身**（`src/style.css` 的 `@theme`）：主色 `#8c5100`、强调色
  `#ff9800`、背景 `#fff8f4`。改色时两边一起改（`lint:website` 会比对）。
- **文案与 README 保持一致**：功能、平台支持、依赖说明都以 README 为准。
  落地页可以更精简，但不能出现 README 里没有的承诺。
- **不写死具体产物名**：下载按钮在运行时按「产物名模板 + 最新 Release」
  拼直链，拉不到就退回 Releases 页面，所以不会变成死链。
  版本号是这条规则唯一的例外（无构建、首帧必须有东西可显示），由发布流程自动刷新。
- **新版 UI 视觉**：无玻璃拟态、发丝线 + 实体面、琥珀只做信号；圆角 token 与应用
  新版默认尺度对齐（card 16 / panel 12 / media 10）。
- **顶栏不放导航链接**：品牌在左、中英切换在右；页面一路往下滑。
- **「能做什么」的卡片是可交互小演示**：平台 / 画质 / 浏览器是分组单选，
  下载加速卡片是四档 effort 选择，依赖识别逐个检出，检查更新用真实最新版本号。
  全部是纯前端演示；文案走 `t()`，切语言时用 `syncDemos()` 重刷。
- 中英双语切换是纯前端实现（读 `?lang=` 或浏览器语言），无后端。
