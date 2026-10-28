# 发布流程与版本策略

本文档是 DownVid 的发布契约。**改动发布相关配置前请先读完**——这里的每一条约束都对应过一次真实事故。

## 版本语义

采用 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)，`MAJOR.MINOR.PATCH`。

这是一个桌面应用而不是库，因此"兼容性"指的是**用户侧的既有能力不被破坏**：

| 变更类型 | 版本位 | 判定标准 |
| --- | --- | --- |
| `PATCH` | 修复 | 只修 bug、改文案、更新依赖清单，不改变任何现有行为 |
| `MINOR` | 新增 | 新增功能、新增平台、新增设置项；**老版本用户不升级也能继续正常使用** |
| `MAJOR` | 破坏性 | 老版本客户端会失效或无法升级，或用户需要手工干预才能继续使用 |

### 属于 MAJOR 的典型改动

- 更换 GitHub 仓库、组织，或改变发布渠道（`shared/app.ts` 与各流水线里的仓库坐标）
- 改产物命名规则（`DownVid-Wails-*`，见下文「产物命名契约」）
- 提高最低系统版本要求（如放弃 macOS 12、Windows 10 以下）
- 移除或重命名 `settings.json` 中的字段（老用户设置会丢失）
- 移除已发布的后端绑定方法或广播事件

> 注意：**删除 `settings.json` 的字段名属于 MAJOR**，因为老用户的设置会静默失效。
> 改设置形状时应新增字段并在读取时做默认值兜底。

### 预发布版本

预发布用 `-beta.1` / `-rc.1` 这类后缀（如 `1.3.0-beta.1`），**不发布到主仓库的 release**，避免自动更新把用户带到测试版。当前项目没有预发布渠道。

## 发布步骤

### 1. 前置检查

```bash
# 全部必须通过，release.yml 的 gate job 是同一套
(cd app && gofmt -l . && go vet ./... && go test ./...)
(cd backend && gofmt -l . && go vet ./... && go test ./...)
pnpm --dir app/frontend check
pnpm test
pnpm deps:manifest:check      # 依赖清单是否落后上游
pnpm lint:website             # 官网（含版本号占位）静态约束
pnpm lint:docs && pnpm lint:workflows
```

> **不要**为了发版去手工改 `website/index.html` 的版本号：`release.yml` 会在
> Release 创建成功后自动刷新它（见[官网版本号](#官网版本号为什么需要自动刷新)）。

### 2. 升版本号

只改 `package.json` 的 `version`。应用内更新直接读 GitHub Releases 的产物列表
（`app/internal/update`），没有额外的清单文件需要同步。

### 3. 写 CHANGELOG

在 `CHANGELOG.md` 顶部按已有格式加段落。这段内容会被 `release.yml` 提取为 Release Notes，因此：

- 标题必须是 `## [x.y.z] - YYYY-MM-DD`，与 `package.json` 完全一致
- 用 `### 新增` / `### 修复` / `### 变更` / `### 移除` 分类
- 面向用户描述影响，而不是罗列 commit

### 4. 提交并打 tag

```bash
git add -A && git commit -m "chore(release): 1.3.0"
git tag v1.3.0
git push origin main --tags
```

也可以在 Actions 页面手动运行 `release.yml` 并填写与 `package.json` 一致的版本号，由工作流创建 tag。**版本号不一致时工作流会直接失败**，这是有意设计。

### 5. 观察构建

三个平台（macOS 通用 / Windows x64 / Linux x64）并行构建，任一失败都不会发布。
失败时先修复再重新打 tag（已推送的 tag 需要删除后重推）：

```bash
git tag -d v1.3.0 && git push origin :refs/tags/v1.3.0
```

### 6. 发布后核对

- Release 页面产物齐全（三个平台的 zip / tar.gz）
- 下载一个安装包，确认能打开
- 用**上一个版本**的应用检查一次「检查更新」，确认能发现新版本（这是更新链路唯一可靠的验证方式）

> 其中「官网版本号」这一项**不需要人核对**：`release.yml` 在 Release 创建成功、
> 且通过 `verify-release.mjs` 自检之后，会自动跑 `pnpm website:version` 把
> `website/index.html` 的版本号刷成本次版本并提交回 `main`，随后**显式触发一次
> Vercel 部署并回读线上页面**，确认真的生效。详见下文「官网版本号为什么需要自动刷新」
> 与「为什么还要显式触发一次部署」。

## 官网版本号为什么需要自动刷新

官网（`website/index.html` + `styles.css` + `app.js`）由 Vercel 从 `main` 直接发布，
**没有构建步骤**；版本号占位在 `index.html` 中，因此只能是硬编码的：

- 页面脚本加载后会请求 `releases/latest`，把版本号覆盖成真实 tag
- 但这条路径依赖三件事：能联网、没被 GitHub 限流、访问者没禁用 `sessionStorage`
- 任何一条不成立，界面就退回那个**写死的值**——它不会报错，只会安静地过期，
  于是页面上写着 `v1.3.4` 而实际最新版是 `v1.4.0`

所以写死的值必须每次发布后刷新，而不是靠人记得：

| 环节 | 做什么 |
| --- | --- |
| 标记 | `website/index.html` 的版本号元素带 `data-version`（刷新脚本的定位标记） |
| 刷新 | `pnpm website:version` → `scripts/sync-website-version.mjs`，只替换那个元素的文本 |
| 时机 | `release.yml` 的 `release` job **最后**三步：自检通过之后、预发布则跳过 |
| 部署 | 推 `main` 后显式调一次 Vercel Deploy Hook，再轮询线上页面的 `data-version` |
| 校验 | `pnpm lint:website` 要求 `data-version` 占位存在且是 `v<数字>` 形态 |

**时机为什么放在最后**：发布被取消或失败时，官网不该先跳到一个不存在的版本。
自检失败时后续步骤不执行，写入的版本一定已经在 Releases 里。

**预发布为什么跳过**：`/releases/latest` 拿不到标记为 prerelease 的版本，
官网显示 beta 号会让稳定用户以为该去下 beta。

**产物直链不受影响**：下载按钮至今仍是运行时按 `ARTIFACTS` 模板 + 最新 Release
拼出来的（见 `website/README.md` 的「下载区」），本流程只刷新离线兜底的版本号，
不写死任何产物名。

## 为什么还要显式触发一次部署

推 `main` 本来就会由 Vercel 的 Git 集成部署，但这条链路的成败在 GitHub 里**没有任何信号**：

- `release.yml` 用 `GITHUB_TOKEN` 推提交，GitHub 不会为它新建 Actions run（防递归），
  仓库里看不到这次 push 的任何结果
- Vercel 侧有没有建部署、部署的是哪个提交，只有打开 Vercel 面板才知道
- 静默失败的后果和版本号过期一样：Release 已经发出去，官网却还停在上一版

所以发布流程最后多一步：向 Vercel 的 Deploy Hook 发一次 `POST`，然后轮询
`https://downvid-coral.vercel.app`（域名取自 `shared/app.ts` 的 `WEBSITE_URL`，不另写一份），
直到页面的 `data-version` 变成 `v<本次版本>`；5 分钟仍未变就判这次发布失败。

**只需要配一次**：Vercel 项目 `downvid` → Settings → Git → Deploy Hooks，名称随意、
分支选 `main`，把生成的 URL 存成 GitHub 仓库的 Actions secret `VERCEL_DEPLOY_HOOK`。
没配时这一步只发一条 warning 并跳过——Git 集成仍是兜底，发布不该因为少一条可选
触发路径而变红；但那条 warning **不代表**官网已经更新。

## 产物命名契约

产物名以 `DownVid-Wails-` 开头，同时被四处引用，**改一处必须改四处**：

| 位置 | 用途 |
| --- | --- |
| `.github/workflows/release.yml` | 打包步骤（真正的名字来源） |
| `app/internal/update/migration.go` | 自更新识别安装包形态 |
| `website/app.js` | 官网按系统直链产物 |
| `scripts/gen-release-notes.mjs` | Release 正文的下载徽章与对照表 |

| 平台 | 产物名 |
| --- | --- |
| macOS（通用） | `DownVid-Wails-mac-universal-<version>.zip` |
| Windows x64 | `DownVid-Wails-windows-x64-<version>.zip` |
| Linux x64 | `DownVid-Wails-linux-x64-<version>.tar.gz` |

`pnpm lint:website` 会比对官网模板与 `release.yml`；`scripts/verify-release.mjs`
会在发布后核对三个包是否都挂上了。

## 应用内自更新

`app/internal/update` 直接读 GitHub Releases 的产物列表，按平台/架构选包，下载后校验
（`sha512` 优先，GitHub 的 `digest` 兜底）再安装：

| 平台 | 安装方式 |
| --- | --- |
| macOS | zip → `ditto` 解压 → 替换 `.app` → 重开 |
| Windows | NSIS 安装器 → 静默安装 → 重启 |
| Linux | AppImage → 替换文件本身 → 重开 |

deb / rpm / tar.gz 不做自动安装（需要包管理器，静默替换会破坏系统包数据库），
界面会退回「打开下载页」。

## 发布后可选：补充外部徽章

README 顶部目前有 Downloads / Release / Stars / License / Product Hunt。以下徽章需要**外部平台先满足条件**，
不要提前加上去（会显示成破损图片）：

| 徽章 | 条件 | 地址 |
| --- | --- | --- |
| [Trendshift](https://trendshift.io/repositories/180707) | 进入 Trendshift **Top 25** 后徽章 API 才会生成 | `https://trendshift.io/api/badge/repositories/180707` |

判断方法：访问徽章地址，返回 **200** 说明已可用、**404** 说明还没生成
（对照：已进榜的仓库返回 200）。加的时候同步更新 `README.md` 与 `README.zh-CN.md` 两份。

## 如何统计真实的下载量 / 装机量

**不要用 release 资源下载量的总和**——它同时被三种因素放大，会得出严重偏高的结论：

| 资源类型 | 是否代表装机 | 说明 |
| --- | --- | --- |
| 三种产物（`.zip` / `.tar.gz`） | ✅ 近似代表 | 用户主动下载，macOS 的 zip 同时用于自动更新 |
| GitHub API 的 release 请求 | ❌ 只是查询 | 每次检查更新都会请求，占总量的大头 |

> 自更新走的是 GitHub API 的产物直链，**没有**额外的清单请求；
> 因此 release 资源下载量比旧架构时代更接近真实装机量。
> 但 macOS 的 zip 同时用于自动更新，想区分「新增」与「升级」只能结合 API 请求次数估算。

### 为什么不做客户端匿名统计

曾评估过上报匿名使用数据（装机 ID / 版本 / 平台 / 崩溃率）。**结论：不做**，原因：

- 上述 GitHub 公开数据已覆盖"多少人在用、用什么平台、多少人在升级"这几个最常问的问题
- 客户端统计**独有**的价值只剩活跃留存、版本分布与崩溃率；但项目当前装机量级（数百），
  样本不足以支撑有意义的留存分析
- 代价不小：需要一套接收端点（Worker 或自建）、首次启动的知情同意流程、隐私说明，
  以及"被怀疑偷偷统计"的信任成本
- 崩溃与卡顿类问题，靠 `userData/downvid.log`（见 troubleshooting）与 Issue 反馈已能定位

若将来装机量增长到需要真实留存数据，再重新评估——届时可用 Cloudflare Worker 收事件，
客户端默认开启但首次启动明示告知、设置内可关闭。

## 发布后哪些东西能改，哪些不能

| 操作 | 是否可行 | 说明 |
| --- | --- | --- |
| 给已发布的 Release 补充说明 | ✅ | 只改文本 |
| 上传额外的附件 | ✅ | 不影响既有清单，但**不要**覆盖清单 |
| 删除 Release | ⚠️ | 会让尚未更新的用户失去下载来源；如需撤回请发新版本 |
| 覆盖已发布的安装包 | ❌ | 文件变了但清单里的 `sha512` 没变，用户端会报校验失败 |
| 修改已推送的 tag | ❌ | tag 指向的产物与清单是配套的，改动会让老客户端更新失败 |

如果某个版本有严重问题，**不要删 Release、不要覆盖产物**，按下面的流程撤回。

## 撤回（Rollback）

### 应用有严重 bug

1. 立即在 Release 页面把问题版本标记为 pre-release（或编辑说明加上醒目警告）
2. 修复后发一个 `PATCH` 版本，例如 `1.3.1`
3. 由于清单里的版本号高于故障版本，已升级的用户会自动收到新版本

> 无法让用户"降级"：更新机制只识别更高的版本号。这是有意设计，避免用户被降级到存在安全问题的旧版本。

### 依赖清单（yt-dlp / ffmpeg）有问题

依赖清单落后或哈希失配会让用户端"下载即校验失败"。处理顺序：

1. 运行 `Update dependencies manifest` 工作流（或本地 `pnpm deps:manifest`）修正 `assets.gen.go`
2. 由于清单是**编译进边车**的，必须发一个新版本才能生效
3. 已经在故障版本上的用户，可在「设置 → 运行依赖」里手动指定自己安装的路径临时绕过

### 更新源不可用

更新按 wmlUpdate 的源链自动降级（GitHub 直连 → gh-proxy → jsDelivr / Gitee / 官网的 static
manifest），全部失败时**不会静默当成「已是最新」**：界面显示失败摘要。用户可：
- 在「设置 → 代理」配置代理后重试
- 直接前往 Releases 页面手动下载

降级只影响「发现与下载」，安装仍由各平台的原生安装器完成；不会出现「更新了一半」的状态。

## 依赖清单与发布的关系

`backend/internal/manifest/assets.gen.go` 里的 tag 与 SHA-256 是**编译进 Go 边车**的，因此：

- 更新清单**必须**重新构建并发版才能对用户生效，不存在"服务端热更新"
- CI 会跑 `pnpm deps:manifest:check`，清单落后于上游时会失败
- yt-dlp 建议跟随上游 nightly（站点修复及时）；ffmpeg-static 没有官方校验值，`pnpm deps:manifest` 会下载后自算（约 130 MB 流量）

## 分支与 CI

- `main` 未开启分支保护，维护者可直接推送；外部贡献建议走 PR
- 推送 tag `v*` 触发发布；推送 `main` 或开 PR 都会触发 CI（Go 测试 + 前端检查 + 静态校验 + 构建 + CodeQL + 依赖审查）
- `release.yml` 的 `permissions` 只申请 `contents: write`，不要在 job 内扩大权限
