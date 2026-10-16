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
线上才会出现**的几类问题：

| 检查 | 不管会怎样 |
| --- | --- |
| 引用的仓库资源存在（og:image / favicon / logo） | 文件改名后线上裂图，本地无提示 |
| 中英词条**双向**成对（`data-i18n` ↔ `I18N.en`，以及脚本拼装的 `t('...')` / `I18N.zh`） | 缺英文的条目切到英文仍显示中文；脚本拼的会显示成 key 本身 |
| 配色与 `src/style.css` 的 `@theme` 一致 | 官网与应用颜色渐渐不像一家人 |
| 零依赖（除 Google Fonts 外无外链脚本/样式） | 「无构建、无依赖」的前提被悄悄破坏 |
| shields.io 徽章的仓库坐标与 `shared/app.ts` 一致 | 写错了徽章静默显示 `no data`，看起来像项目没人用 |
| `#osIcons` 里的平台图标与脚本 `PLATFORMS` 双向对上 | 键名写错只是**没有图标**，线上不报错 |
| 页面脚本里的仓库坐标（`REPO`）与 `shared/app.ts` 一致 | 下载按钮指向别人的仓库 |
| 下载产物名模板与 `electron-builder.json5` 的 `artifactName` 一致 | 产物改名后所有平台都静默挑不到，只剩「去 Releases 页面」的兜底 |
| 版本号占位（`data-version`）存在且是 `v<数字>` 形态 | 刷新脚本找不到落点，版本号从此不再随发布更新 |
| `mailto:` 里的联系邮箱与 `shared/app.ts` 的 `CONTACT_EMAIL` 一致、主题已编码 | 地址写错时页面照常渲染，只是信寄不到；主题不编码会被邮件客户端截断 |

## 在线演示（hero 预览）

hero 里那块预览**不是截图**，而是应用主界面的**可交互复刻**（仍然是单文件内联，没有框架）：

- 结构 / 文案 / 配色照 `src/components/DownloadView.vue`、`UrlInput.vue`、`FormatSelector.vue`、
  `DownloadQueue.vue` 搬过来，只把真实解析与下载换成本地动画（约 1.5s 出结果，进度条自己走完）
- 画布按应用窗口的实际 CSS 宽度 **1100px** 设计，所以内部尺寸可以直接照搬应用里的 px 值；
  外层再用 `transform: scale()` 等比缩放到容器宽度 —— 效果等同于把窗口截图缩小，但可以点
- **默认就是「已粘贴 + 已解析 + 正在下载」的样子**：一进页面就是完整界面（链接已填、格式列好、
  右侧任务在跑进度），不用先点一遍才知道长什么样；进度跑完会停在「已完成」，之后随时可以再点
- 能点的：解析视频信息（会重新解析一遍）、格式单选、立即下载（任务进右侧队列并跑进度）、
  下载历史 / 关于软件 标签页、中英切换
- 缩略图用 `src/assets/demo-thumb.jpg`（从 `src/assets/screen.png` 里裁出来的原链接预览图，
  连时长角标一起，所以不用再叠一层）；它是 raw 地址，**新加的资源要推上 main 才会生效**，
  加载失败时退回内置的 SVG 底图，不会裂图
- 改应用界面时要**同步这一份**；`lint:website` 会比对复刻里抄来的那批 `@theme` 颜色 token
  （`--tertiary`、`--secondary-container`、`--surface-dim`、`--primary-fixed` 等），
  抄错会像配色漂移一样被拦下

## 下载区（按系统直链）

hero 的主按钮会识别访问者的系统，点击**直接下载**对应安装包，不跳转 Releases 页面：

1. 读 `navigator.userAgentData` / `userAgent` 判断系统与芯片。Chrome / Edge 还能通过
   Client Hints 读到架构；Safari / Firefox 读不到，macOS 默认给 Apple 芯片版
   （Intel 版固定列在「其他格式」里，用户自己点得到）
2. 页面加载时请求一次 `api.github.com/repos/<owner>/<repo>/releases/latest`，结果放
   `sessionStorage` 缓存 30 分钟。未认证限额是 60 次/小时且**按访问者 IP** 计，
   刷新页面不该重复消耗；存储被禁用只是每次重新请求，不影响下载
3. 在真实产物列表里按产物名模板挑包（`index.html` 里的 `ARTIFACTS`），按钮 `href`
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
<p class="dv-about-version" id="dvAboutVersion" data-version>v1.3.4</p>
```

- 页面脚本加载后会请求 `releases/latest`，把它覆盖成真实 tag（`renderAlt` 与 `syncAppDemo` 里各有一处）
- 拉不到时（离线 / 被 GitHub 限流 / 禁用 `sessionStorage`）显示的就是这里的值
- 因此这个值**必须每次发布后刷新**，由 `release.yml` 在 Release 创建成功并自检通过后
  自动跑 `pnpm website:version`（`scripts/sync-website-version.mjs`）写入并提交回 `main`

**不要删 `data-version`**：刷新脚本靠它定位，`pnpm lint:website` 会校验它在不在。
也不要手工去改它——发布流程会覆盖，手工改反而会和 `package.json` 不一致。

想本地核对/刷新：

```bash
pnpm website:version            # 用 package.json 的版本刷新
pnpm website:version 1.4.0      # 指定版本
pnpm website:version --check    # 只核对（落后则退出码 1）
```

## 赞助与商务合作

「加入开源社区」之后有一个独立的赞助与商务合作区，两张卡片直链
`mailto:xynrin@icloud.com`（赞助 / 商务各一个主题）：

- **邮箱是唯一来源**：`shared/app.ts` 的 `CONTACT_EMAIL`。官网、关于页、README 都指它，
  `pnpm lint:website` 会比对官网与它是否一致——写错不会报错，只是信寄不到
- **主题随语言切换**：`data-mail-subject` 存中文主题，`data-i18n-subject` 指向英文词条，
  `apply(lang)` 里重写 `href`。只写死中文主题时，英文用户点开会看到一封中文主题的邮件
- **主题必须编码**：裸的空格与方括号会被部分邮件客户端截断，`lint:website` 会拦
- **要写明「软件本身不含广告」**：README 的卖点里有「无任何弹窗广告」，只加合作入口
  不作区分，读者会以为要往安装包里塞广告

## 下载量 / 星标

hero 里的下载量与星标用 **README 同款 shields.io 徽章**，数字实时，没有「发布后忘了刷新」的问题：

- 徽章是 `<img>`，不是脚本或样式，所以不破坏「零依赖」的约定；但它确实是**外部图片请求**，
  网络受限时显示不出来（README 顶部本来就有一整排同样的徽章）
- `lint:website` 会核对徽章 URL 里的仓库坐标与 `shared/app.ts` 一致：写错了不会报错，
  徽章只会静默显示 `no data`，看起来像项目没人用
- 以前靠 `scripts/gen-website-stats.mjs`（`pnpm website:stats`）把总数写死进 HTML，
  现在不需要了，那个脚本已删除

## 约定

- **配色取自应用本身**（`src/style.css` 的 `@theme`）：主色 `#8c5100`、强调色
  `#ff9800`、背景 `#fff8f4`。改色时两边一起改（`lint:website` 会比对）。
- **文案与 README 保持一致**：功能、平台支持、依赖说明都以 README 为准。
  落地页可以更精简，但不能出现 README 里没有的承诺。
- **不写死具体产物名**：下载按钮在运行时按「产物名模板 + 最新 Release」
  拼直链，拉不到就退回 Releases 页面，所以不会变成死链。模板本身由 `lint:website`
  与 `electron-builder.json5` 对齐（`scripts/gen-release-notes.mjs` 也是同样的思路）。
  版本号是这条规则唯一的例外（单文件、无构建，页面首帧必须有东西可显示），
  见下节——它由发布流程自动刷新，不靠人记得。
- **版式参考 <https://www.deepseek.com/harness/>**：居中 hero + 大预览图、两列卡片网格、
  「安装与运行」的代码块、居中的社区 CTA、极简页脚；配色仍取自应用本身（见上）。
  重做版式时保持这套区块划分，不要再回到老式的左右分栏 hero。
- **顶栏有两种状态，靠 `is-stuck` 切换**：停在页面顶部时是**通栏细条**（原来那版），
  往下滑超过 12px 才收成**浮动圆角胶囊**并钉在顶部（半透明 + 模糊 + 投影，上方还有一层渐隐），
  滑回顶部自动还原。**不放导航链接**——页面就是一路往下滑；品牌在左、中英切换在右。
- **「能做什么」的卡片是可交互小演示**（和桌面端一样能点）：平台 / 画质 / 浏览器是分组单选
  （`data-pick-set`，画质还会带出对应体积 `data-pick-out`），下载加速能开始 / 暂停并让进度条走，
  依赖识别逐个「检出」，检查更新会用**真实拉到的最新版本号**作答。全部是纯前端演示、
  不联网改状态；文案走 `t()`，切语言时会用 `syncDemos()` 重刷。
- 中英双语切换是纯前端实现（读 `?lang=` 或浏览器语言），无后端。
