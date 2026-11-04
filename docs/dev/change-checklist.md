# 改动落点清单

> 从 `AGENTS.md` 拆出，内容未改动。

## 新增后端能力（前端可调用）

1. 在 `app/bindings_*.go`（下载 / 依赖相关）或 `app/app.go`（窗口 / 更新 / 历史等）加导出方法。
   Wails 会按方法签名生成 `wailsjs`，不需要手写 preload / IPC 注册。
2. 前端**只能**经 `app/frontend/src/lib/backend.ts` 调用，不要在组件里直接 `import wailsjs/...`：
   浏览器里那会直接抛 `Failed to resolve module`，整页白屏；换传输层时也只改这一处。
3. 前后端字段名是**逐字契约**：`app/frontend/src/lib/types.ts` 与 Go 结构体的 JSON tag 必须一致。
   数组一侧改了不会有类型错误，只会让界面显示空白。
4. 验证：`pnpm --dir app/frontend check` + `cd app && go test ./...`。

## 新增广播事件（Go → 前端）

1. Go 侧 `a.emit("event", data)`（`app/app.go` 的 `emit`）。
2. 前端在 `app/frontend/src/lib/backend.ts` 里订阅并**返回 unsubscribe**；组件卸载时必须调用。
3. 事件名与 payload 形状记进 `app/frontend/src/lib/types.ts`，否则只有运行时才发现对不上。

## 改用户设置形状

- 唯一入口是 `app/internal/settings/settings.go`，前端映射在 `app/frontend/src/lib/settings.ts`。
- 只许新增（读取时用默认值补齐）；删改属于 MAJOR 变更。
- `app/frontend/scripts/check-settings-write.mjs` 会扫描「绕过入口直接写设置」的调用。

## 改前端文案

- 词条表在 `app/frontend/src/lib/i18n.svelte.ts`。
- 新增 key 必须中英成对；`pnpm lint:i18n:app` 会双向校验并检查 `t()` 引用的 key 是否存在。
- `t()` 是响应式的，**不能在模块顶层求值**；需要常量时用 `computed` / getter。

## 改运行依赖 / 清单

- 依赖探测由 `backend/` 边车负责；`app/internal/deps` 只起进程、转 NDJSON 事件，
  **不要在这里再写一份候选路径表**（那正是「依赖页说装了、加速页说没装」的来源）。
- **新增依赖种类**：`backend/internal/runtime` 的 `Kinds` / `Optional` / 候选路径，以及
  `shared/acceleration.ts` 的 `DEP_KINDS`。
- **改下载源或版本**：只改 `scripts/gen-deps-manifest.mjs` 的资产表，然后 `pnpm deps:manifest`。
  不要手改 `backend/internal/manifest/assets.gen.go`（生成文件）。
- **新增平台**：清单资产表 + `app/scripts/build.sh` 的目标列表 + `.github/workflows/release.yml`
  构建矩阵，三处都要。

## 改发布产物

产物名以 `DownVid-Wails-` 开头，出现在五处，改一处必须改五处：
`release.yml` 的打包步骤、`app/internal/update/migration.go`、`app/internal/update/wml.go` 的
`wmlAssetRules`、`website/app.js` 的产物模板、`scripts/gen-release-notes.mjs`。
`scripts/lib/update-manifest.mjs` 还会解析平台/架构段。`pnpm lint:website` 会比对官网那一侧。

发布后必须核对「tag ↔ Release」对得上：

- `pnpm verify:release`：核对某个 tag 是否真有 Release、三个平台的包是否齐全。
- `.github/workflows/release-audit.yml`：**独立于发布流程**的每日审计，不一致就开一条带
  `release-audit` 标签的 Issue。
- 本地开发时版本号与已发布版本一致是正常的；**不要为了让 `verify:release` 通过而提前升版本**。

## 改仓库坐标 / 外部链接

唯一来源是 `shared/app.ts`。`pnpm sync:repo` 会检查流水线、脚本、官网里的坐标是否一致。

## 新增/重写模块 → 会改变上游成分，触发来源审计

`docs/provenance/` 是来源审计 / 目标架构 / 发布质量的落地文档。数字由 `pnpm audit:provenance` 现场重算：

- 新增的文件里有 ≥15%（且 ≥8 行）逐字来自上游 Videdown → **必须登记**在
  `scripts/data/provenance/registry.json`，否则 CI 红叉
- 登记表里的数字与实测不一致 → 同样红叉（先 `node scripts/audit-provenance.mjs --write`）
- `docs/provenance/audit.md` 里的存活行数与实测不一致 → 红叉

上游快照在 `scripts/data/provenance/upstream/`，**不要修改**。

## 改产品官网（`website/`）

无构建的多文件站点（`index.html` / `styles.css` / `app.js`），由 Vercel 项目 `downvid` 的 Git 集成
在推送 main 后直接发布（`vercel.json` 指定 `outputDirectory: "website"`）。
`release.yml` 会显式触发一次 Vercel Deploy Hook，再回读线上页面的 `data-version` 确认部署生效。

容易静默失败、`pnpm lint:website` 全部覆盖的几点：

- **引用的仓库资源**（og:image、favicon、logo）走 `raw.githubusercontent.com/<owner>/<repo>/main/...`
  绝对地址，文件改名/删除后线上裂图，本地无提示
- **中英词条双向成对**：`data-i18n` 占位 ↔ `I18N.en` 词条
- **配色是手抄的**：官网 `:root` 的 `--primary` 等必须与 `app/frontend/src/app.css` 的 `@theme` 一致
- **无构建 / 零依赖**：只允许本地 `styles.css` / `app.js`，除 Google Fonts 外不得外链脚本/样式
- **下载按钮按系统直链产物**：`app.js` 里的 `ARTIFACTS` 产物名模板必须与 `release.yml` 的
  `build-wails` 一致，对不上不会报错，只是所有平台都挑不到产物
- **hero 的预览是应用主界面的可交互复刻**（不是截图）：改应用界面时要同步这一份

---
