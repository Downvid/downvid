# 状态管理

> 从 `AGENTS.md` 拆出，内容未改动。

| 状态 | 位置 |
|------|------|
| 应用状态（解析结果 / 任务队列 / 弹窗） | `app/frontend/src/lib/store.svelte.ts`（Svelte 5 runes 单例） |
| 用户设置 | `userData/settings.json`，入口 `app/internal/settings/settings.go`；前端映射在 `app/frontend/src/lib/settings.ts` |
| 下载历史 | `app/internal/history` → `~/.downvid/download-history.json`（原子写） |
| 运行依赖 | `app/internal/deps`（探测结果缓存 60 秒） |
| 更新 | `app/internal/update`（wmlUpdate 发现/下载 + 原生安装） |

**所有后端调用必须经 `app/frontend/src/lib/backend.ts`**：浏览器里直接 import `wailsjs` 会白屏，
换传输层时也只需要改这一处。

## 更新源（wmlUpdate）

检查与下载交给 **wmlUpdate**（`app/internal/update/wml.go`）；安装仍留在 `install_*.go`。
原因是 wmlUpdate 的 directory/file/command 策略要求固定安装路径，deferred helper 也只对
它自己的 CLI 生效——嵌入到 DownVid 时复制出来的是 DownVid 本身，不会执行安装计划。

- `auto` = **GitHub → Gitee → CNB**。Gitee / CNB 都是完整镜像，清单与资产都在各自站点，
  任一条都能独立完成检查与下载。
- Gitee：`Xynrin/downvid`；`website/updates/manifest.gitee.json` 提交在仓库里，
  `scripts/sync-gitee-release.mjs` 上传对应资产。
- CNB：`yxxbc/downvid`；`scripts/sync-cnb-release.mjs` 上传版本资产，并把
  manifest.cnb.json 写到固定的 `update` Release。CNB 的 raw API 需要登录，所以客户端读
  公开的 Release 资产 URL。
- `release.yml` 运行两个同步脚本（各自 `continue-on-error`，Secret `GITEE_TOKEN` /
  `CNB_TOKEN`）。`.github/workflows/sync-mirrors.yml` 在每次 push main / tag 时同步源码：
  Gitee 完整历史；CNB 当前 tree 快照（完整历史含 CI 没有的旧 LFS 对象）。
- 旧的 `jsdelivr / ghproxy / website` 源已移除；`NormalizeSource` 把旧设置值回退 `auto`。
- 新增源要同时改 `wmlSource`、`UPDATE_SOURCE_IDS`、中英词条与前端设置项。

---
