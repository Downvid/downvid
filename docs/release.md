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

- 更换 GitHub 仓库、组织，或改变发布渠道（`electron/constants.ts`、`electron-builder.json5` 的 `publish`）
- 改产物命名规则（`DownVid-Setup-*` 等，见下文"产物命名契约"）
- 更换更新清单的文件名或结构（`latest.yml` / `latest-mac.yml` / `latest-linux*.yml`）
- 提高最低系统版本要求（如放弃 macOS 12、Windows 10 以下）
- 移除或重命名 `localStorage['settings']` 中的字段（老用户设置会丢失）
- 移除已发布的 IPC 通道（`electron/preload.ts` 暴露给渲染进程的接口）

> 注意：**删除 `localStorage['settings']` 的字段名属于 MAJOR**，因为老用户的设置会静默失效。改设置形状时应新增字段并在读取时做兼容兜底。

### 预发布版本

预发布用 `-beta.1` / `-rc.1` 这类后缀（如 `1.3.0-beta.1`），**不发布到主仓库的 release**，避免自动更新把用户带到测试版。当前项目没有预发布渠道。

## 发布步骤

### 1. 前置检查

```bash
# 全部必须通过，CI 也是同一套
pnpm vue-tsc --noEmit
cd backend && gofmt -l . && go vet ./... && go test ./...
pnpm deps:manifest:check      # 依赖清单是否落后上游
```

### 2. 升版本号

只改 `package.json` 的 `version`。**不要手改任何 `latest*.yml`**——它们由 CI 按最终产物重新生成，手改必然与文件不一致。

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

5 个架构目标并行构建，任一失败都不会发布。失败时先修复再重新打 tag（已推送的 tag 需要删除后重推）：

```bash
git tag -d v1.3.0 && git push origin :refs/tags/v1.3.0
```

### 6. 发布后核对

- Release 页面产物齐全（5 个架构，含 `.blockmap` 与 `latest*.yml`）
- 下载一个安装包，确认能打开
- 用**上一个版本**的应用检查一次「检查更新」，确认能发现新版本（这是更新链路唯一可靠的验证方式）

## 产物命名契约

以下文件名**不可更改**。旧版本的客户端会把它们硬编码在更新清单（`latest*.yml`）里，一旦改名，所有存量用户将无法自动更新，只能手动下载。

| 平台 | 产物名 |
| --- | --- |
| Windows 安装包 | `DownVid-Setup-<version>.exe` |
| Windows 便携版 | `DownVid-Portable-<version>.exe` |
| macOS | `DownVid-<arch>-Mac-<version>.<dmg\|zip>`（如 `DownVid-arm64-Mac-1.2.1.dmg`） |
| Linux x64 | `DownVid-x86_64-Linux-<version>.AppImage` / `DownVid-amd64-Linux-<version>.deb` / `.rpm` |
| Linux arm64 | `DownVid-arm64-Linux-<version>.AppImage` |
| 更新清单 | `latest.yml`（Windows）、`latest-mac.yml`（macOS）、`latest-linux.yml`、`latest-linux-arm64.yml` |

这些规则定义在 `electron-builder.json5` 的 `artifactName`。**Linux 用 `amd64`/`x86_64` 而不是 `x64`**，与 electron-builder 的 `${arch}` 取值不同，是历史约定。

### 便携版为什么必须单独命名

便携版与安装包同为 `.exe`。若同名，两者会互相覆盖，且 `latest.yml` 里的 `sha512` 会与实际文件不一致，导致**所有 Windows 用户自动更新时报校验失败**。`portable.artifactName` 里的 `-Portable-` 后缀不能删。

## 更新清单的生成

`scripts/gen-update-manifests.mjs` 在构建完成后对**最终产物**逐个计算 `sha512` 与 `size`，覆盖式写出全部 `latest*.yml`。

为什么不直接用 electron-builder 各自生成的清单：5 个架构在各自 job 中构建，每个 job 都会产出一份 `latest*.yml` 并互相覆盖，最终清单与实际上传的文件对不上。因此 `release.yml` 的做法是——各 job 只上传产物与自己的清单，最后统一由该脚本按真实文件重新生成。

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
| `DownVid-Setup-*` / `*Portable*` / `.dmg` / `.deb` / `.rpm` / `.tar.gz` / `AppImage` | ✅ 近似代表 | 用户主动下载安装 |
| `*.zip` / `*-Mac-*.zip` | ⚠️ 含自动更新 | macOS 自动更新也走 zip |
| `*.blockmap` | ❌ 只是更新差分 | **仅自动更新时下载**，是存量用户升级，不是新增 |
| `latest*.yml` | ❌ 只是清单 | **每次检查更新都会请求**，占总量的大头 |

实测（2026-10 的四个版本）：清单请求 656 次、blockmap 62 次、安装包合计 489 次。
直接相加得到"1.2K 下载"；按上表口径还原后，真实装机量级是**约 430**。

区分「新增」与「升级」的干净口径：

```
真实安装 = 安装包下载
自动更新 = blockmap 下载（即可推出"存量用户有多少在升级"）
检查更新 = latest*.yml 请求
```

**另一个值得注意的信号**：blockmap 下载量远小于安装包下载量，说明**存量用户大多不升级**。
发版时若希望用户真正用上新版本，不能只依赖自动更新，应在 Release 正文顶部放醒目的下载入口
（`scripts/gen-release-notes.mjs` 已生成）。

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

在 GitHub 不可达的网络环境下，更新会失败但**不影响应用其余功能**。用户可：
- 在「设置 → 代理」配置代理后重试
- 直接前往 Releases 页面手动下载

代码里不做静默重试与降级路径，避免出现"更新了一半"的状态。

## 依赖清单与发布的关系

`backend/internal/manifest/assets.gen.go` 里的 tag 与 SHA-256 是**编译进 Go 边车**的，因此：

- 更新清单**必须**重新构建并发版才能对用户生效，不存在"服务端热更新"
- CI 会跑 `pnpm deps:manifest:check`，清单落后于上游时会失败
- yt-dlp 建议跟随上游 nightly（站点修复及时）；ffmpeg-static 没有官方校验值，`pnpm deps:manifest` 会下载后自算（约 130 MB 流量）

## 分支与 CI

- `main` 未开启分支保护，维护者可直接推送；外部贡献建议走 PR
- 推送 tag `v*` 触发发布；推送 `main` 或开 PR 都会触发 CI（类型检查 + Go 测试 + 打包校验 + CodeQL + 依赖审查）
- `release.yml` 的 `permissions` 只申请 `contents: write`，不要在 job 内扩大权限
