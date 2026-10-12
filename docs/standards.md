# 仓库规范

面向维护者与贡献者的操作规范。**目标是让改动可预测、可回滚、可审计**——本项目的安装包会分发到用户机器上并长期存活，因此"发布之后再发现问题"的代价很高。

相关文档：[发布流程](./release.md) · [贡献指南](../CONTRIBUTING.md) · [安全政策](../SECURITY.md) · [架构说明](./architecture.html)

## 1. 分支

| 类型 | 命名 | 用途 |
| --- | --- | --- |
| 功能 | `feat/<简述>` | 新功能 |
| 修复 | `fix/<简述>` | Bug 修复 |
| 文档 | `docs/<简述>` | 仅文档 |
| 重构 | `refactor/<简述>` | 不改行为的结构调整 |
| 杂项 | `chore/<简述>` | 构建、依赖、CI |
| 安全 | `security/<简述>` | 安全修复（**先走私密报告渠道**） |

- `main` 受保护，禁止直接推送
- 分支名用小写与连字符，避免中文与空格
- 合入后删除分支

## 2. 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，**正文用中文**。

```
<type>(<scope>): <简述>

<可选正文：为什么这么改，而不是改了什么>
```

### type

`feat` `fix` `docs` `refactor` `perf` `test` `build` `ci` `chore` `revert` `security`

### scope（按目录/模块）

| scope | 对应区域 |
| --- | --- |
| `deps` | 运行依赖（探测/下载/清单） |
| `download` | 下载链路与解析分发 |
| `parser` | 各平台解析器 |
| `updater` | 应用内更新 |
| `cookies` | Cookie 读取与策略 |
| `ui` | 渲染进程界面 |
| `backend` | Go 依赖边车 |
| `ci` / `build` | 工作流与构建配置 |
| `release` | 发布流程与产物 |

### 示例

```
fix(cookies): macOS 上解析失败 EEXIST
feat(deps): 缺依赖时弹一键下载引导
refactor(download): 拆分直链与 yt-dlp 两条路径
```

**破坏性变更**：在 type 后加 `!`，并在正文用 `BREAKING CHANGE:` 说明影响与迁移方式。这类改动同时要求 `MAJOR` 版本号（见 [发布流程](./release.md#版本语义)）。

## 3. PR 流程

1. **开 PR 前先自查**

   ```bash
   pnpm vue-tsc --noEmit
   cd backend && gofmt -l . && go vet ./... && go test ./...
   pnpm deps:manifest:check
   ```

2. **PR 描述**填全：改动说明、改动类型、测试方式、关联 Issue
3. **CI 必须全绿**：类型检查、Go 测试、打包校验、CodeQL、依赖审查
4. **评审**：`.github/CODEOWNERS` 中列出的路径需对应维护者批准
5. **合入方式**：Squash merge，commit 标题沿用 PR 标题（保持 Conventional Commits）

### 评审要点

- 是否碰到 [§5 改动落点清单](#5-改动落点清单) 中的"多处必须同步"？
- 是否改变用户可见行为？需要的话有没有更新 CHANGELOG 与文档？
- 是否引入新的运行时依赖？新增依赖需说明理由与替代方案
- 是否影响已发布客户端的升级能力？（产物命名、清单格式、仓库地址）

## 4. Issue 处理

### 标签体系

| 标签 | 含义 |
| --- | --- |
| `bug` | 确认的缺陷 |
| `enhancement` | 功能请求 |
| `parse-error` | 平台解析失败（模板：`parse_error.yml`） |
| `setup` | 安装/环境问题（模板：`setup_issue.yml`） |
| `deps` | 运行依赖相关（探测/下载失败） |
| `updater` | 更新相关 |
| `needs-info` | 等待提问者补充信息 |
| `good first issue` | 适合新贡献者 |
| `duplicate` / `wontfix` | 关闭原因 |

### 处理约定

- **先复现再定性**：解析类问题必须拿到原始链接（可要求私下提供）
- **必须索取日志**：`userData/downvid.log` 是诊断打包应用问题最快的途径，`bug_report.yml` 已内置该提示
- **依赖类问题**先让用户去「设置 → 运行依赖」点重新检测——界面会显示探测到的路径与来源
- 超过 14 天无回复且缺 `needs-info` 信息的，可关闭并标注
- 关闭时说明原因与替代方案，不要静默关闭

## 5. 改动落点清单

**这是最容易出错的部分**：以下几个地方是手工维护的多处同步，漏改会静默失败（不报错、功能不生效）。

### 新增渲染进程可调用的主进程能力

三处必须同时改，否则静默失败：

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `electron/ipc/<domain>.ts` | `ipcMain.handle(...)`（并在 `electron/main.ts` 注册） |
| 2 | `electron/preload.ts` | `contextBridge` 暴露入口 |
| 3 | `src/env.d.ts` | `Window.electronAPI` 类型定义 |

> `src/env.d.ts` **不能出现顶层 import/export**：那会把它从全局声明脚本变成模块，`interface Window` 随即失效。依赖类型一律用内联 `import('./types/...')` 引用。

### 新增广播事件（主进程 → 渲染进程）

1. `electron/store.ts` 的 `broadcast` 或对应 IPC 模块中发送
2. `electron/preload.ts` 暴露 `onXxx(cb)` 并返回 unsubscribe 闭包
3. `src/env.d.ts` 补类型
4. 订阅方必须在组件卸载时调用 unsubscribe

现有事件：`download:progress`、`history:updated`、`update:status`、`menu:showAbout`、`deps:progress`

### 改用户设置形状

设置存在 `localStorage['settings']`（**不在 Pinia 中**），直接改形状会让老用户设置静默失效：

1. 全局搜索 `localStorage.getItem('settings')`，逐个确认读取处有默认值兜底
2. 新字段要能被旧数据补齐（读取时 `{ ...默认值, ...JSON.parse(saved) }`）
3. 删除或重命名字段属于 **MAJOR** 变更（见 [发布流程](./release.md)）
4. 同步更新 `src/components/SettingsView.vue` 与相关文档

当前字段：`downloadDir`、`filenameTemplate`、`preferredQuality`、`cookieMode`、`cookiesFile`、`proxy`、`depPaths`

### 改运行依赖（yt-dlp / ffmpeg / ffprobe）

1. 新增依赖种类 → `backend/internal/runtime`（`Kinds`、`Optional`、候选路径）与 `src/types/deps.ts`
2. 改下载源或版本 → **只改** `scripts/gen-deps-manifest.mjs` 的资产表，然后 `pnpm deps:manifest` 生成清单
3. 若新增平台，需同时补：清单资产表、`electron-builder.json5`、`release.yml` 的构建矩阵
4. 依赖解析失败的引导依赖 `[[deps-missing:<kind>]]` 标记，改动 `electron/utils/binary.ts` 时不要破坏该格式

### 改发布产物

见 [发布流程 · 产物命名契约](./release.md#产物命名契约)。**产物名一旦发布即不可更改**，改名会让存量用户无法自动更新。

### 触碰更新逻辑

`electron/updater.ts`、`electron/constants.ts`、`electron-builder.json5` 的 `publish`、`scripts/gen-update-manifests.mjs` 都受 CODEOWNERS 保护。改动前请确认：

- 老版本客户端还能读到清单吗？
- 校验值（`sha512`）还和实际文件一致吗？
- macOS 自实现替换 `.app` 的逻辑是否受影响？

## 6. 废弃（deprecation）流程

移除用户可见的能力必须分步，不能一步到位：

1. **标记废弃**（`MINOR`）：文档与界面标注"将于 x.y 移除"，保留功能
2. **发警告**（`MINOR`）：运行时/日志给出替代方案的提示
3. **移除**（`MAJOR`）：CHANGELOG 的 `### 移除` 段落写明替代方案

例：移除 `pnpm download-deps` 脚本时，先把它替换为提示信息，再在下个 MAJOR 移除。

## 7. 文档要求

改动以下内容时**必须**同步文档：

| 改动 | 需更新的文档 |
| --- | --- |
| 新增/修改 IPC 接口 | `docs/architecture.html`（+ `.svg`） |
| 改依赖来源或解析顺序 | `AGENTS.md`、`CLAUDE.md`、`docs/troubleshooting.md` |
| 改构建/发布步骤 | `docs/release.md`、`docs/build-from-source.md`、`README.md` |
| 新增设置项 | `README.md` 的常见问题、`docs/faq.md` |
| 用户可见的行为变化 | `CHANGELOG.md` 的 `## [Unreleased]` |

> `AGENTS.md`（中文速查）与 `CLAUDE.md`（英文对应版）是**同一份知识的两个语言版本**，改动其一时必须同步另一份。

## 8. 依赖引入原则

- 优先标准库与已有依赖；新增运行时依赖需在 PR 中说明体积与替代方案
- 前端依赖打进 `dist/`，体积直接影响安装包——避免为了单个工具函数引入整个库
- 必须通过 `dependency-review`（高危拦截、许可证白名单：MIT / ISC / Apache-2.0 / BSD / 0BSD / Unlicense / CC0 / Python-2.0 / MPL-2.0）
- Go 侧车**刻意只用标准库**：它会被交叉编译成 5 个平台的二进制打进安装包，引入第三方库会显著影响可审计性

## 9. 代码风格

- 前端：TypeScript 严格模式（`strict` + `noUnusedLocals` + `noUnusedParameters`，未使用的 import / 参数会让构建失败）
- Go：`gofmt`（CI 会检查）+ `go vet`
- 没有 ESLint / Prettier。**不要引入**——格式化差异会污染历史 diff
- UI 文案、注释、commit body **一律中文**，与现有风格一致
- Vue 组件用 `<script setup>`
- 注释解释**为什么**，不复述代码在做什么
