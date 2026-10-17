# DownVid 容器化（原生 WebUI）

本目录收纳**全部** Docker / WebUI 相关实现，桌面核心代码（`electron/` 与 `src/`）
保持官方原样、无任何修改。

| 文件 | 职责 |
| --- | --- |
| `Dockerfile` | 两阶段构建：编译前端 / 服务端 / Go 边车，运行期只带打包产物 |
| `entrypoint.sh` | PID 1 下的启动与存活监督（`node` 直跑打包产物，不经 tsx） |
| `server/` | 无头 WebSocket + HTTP 服务（复用 `electron/` 的下载与解析逻辑） |
| `server/update.ts` | 容器版更新检查（查最新版本 + 给出拉镜像命令） |
| `web/` | WebUI 前端入口（桥接层模拟 `window.electronAPI`） |
| `docker-compose.yml` | 从本目录直接 `docker compose up -d` |

构建与使用说明见 [`docs/docker.md`](../docs/docker.md)。

## 三条不能踩的线

1. **服务端必须保持「可打包成单文件」**：镜像里没有 `node_modules`，运行期
   只有 `node docker/dist-server/index.js`。新增的 `import` 要么是 Node 内建，
   要么会被 `docker/server/vite.config.ts` 打进同一份产物（`ssr.noExternal`）。
   引一个带原生 `.node` 的包会在这里直接构建失败——那正是我们想要的失败方式。
2. **镜像里的 yt-dlp / ffmpeg 版本不能手写**：一律取自
   `backend/internal/manifest/assets.gen.go`（经 `scripts/deps-asset.mjs`）。
   手写版本会在升级清单时静默漂移，镜像里的编码器与桌面版对不上。
3. **不要给 `/data` 固定 uid**：那是宿主机 bind mount，属主由 NAS / 软路由决定。
   需要最小权限时在 compose 里用 `user:` 指定，别改镜像默认值。
