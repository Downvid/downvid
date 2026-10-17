# 用 Docker 运行 DownVid（原生 WebUI）

DownVid 提供基于原生 Web 界面（WebUI）的容器化运行方式：通过轻量 Node 服务托管前端与下载引擎，
**在浏览器中直接打开即可使用完整功能**，无需安装 Electron、无需远程桌面，支持电脑、平板和手机自适应访问。

---

## 目录

- [特点与优势](#特点与优势)
- [快速开始](#快速开始)
- [使用说明](#使用说明)
- [下载文件位置](#下载文件位置)
- [配置项说明](#配置项说明)
- [运行依赖](#运行依赖)
- [安全与访问控制](#安全与访问控制)
- [品牌与第三方托管政策声明](#品牌与第三方托管政策声明)
- [故障排除](#故障排除)
- [自己构建镜像](#自己构建镜像)
- [架构设计说明](#架构设计说明)

---

## 特点与优势

相较于传统的 Xvfb / VNC 虚拟桌面方案，原生 WebUI 带来质的提升：

- **极致轻量**：去除了 Electron GUI、X11 显示服务与 VNC 组件，镜像体积从近 2GB 降至 ~350MB，运行时内存仅占用数十 MB；
- **原生操作体验**：直接在浏览器渲染 Vue 3 页面，无任何远程桌面鼠标延迟、支持宿主机原生剪贴板直接粘贴，界面 60fps 丝滑流畅；
- **移动端与平板自适应**：手机、平板打开局域网地址即可解析与下载视频，无需安装任何客户端；
- **文件直落宿主机**：下载完成的视频直接写入挂载的 `./data/downloads` 目录，随下随取。

---

## 快速开始

```bash
git clone https://github.com/yxxbc/downvid.git
cd downvid
docker compose up -d
```

启动完成后，在浏览器中直接打开：
👉 **http://127.0.0.1:6080/**

> 从局域网其他设备访问时，将 `127.0.0.1` 替换为运行主机的 IP 地址即可。

---

## 使用说明

进入 Web 界面后，使用流程与桌面版完全一致：
1. **粘贴链接**：在首页输入框粘贴支持网站的视频链接，点击「解析」；
2. **选择规格**：解析成功后，展开选择清晰度、音轨或字幕规格；
3. **点击下载**：任务进入队列并开始分块下载，可在任务卡片上实时查看速度、进度与合并状态；
4. **历史查看**：点击顶部「下载历史」可随时查看下载记录与文件信息。

---

## 下载文件位置

默认布局下，所有下载的视频文件保存在当前目录下的 **`./data/downloads/`**。
在 NAS、家用服务器或软路由上运行时，你可以把宿主机的媒体库目录直接挂载到容器的 `/data/downloads`。

用户设置与下载历史数据保存在 `./data/userdata/`。

---

## 配置项说明

所有参数均可通过环境变量进行定制（写在 `docker-compose.yml` 的 `environment:` 或 `docker run -e`）：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DOWNVID_WEB_HOST` | `127.0.0.1`（容器内为 `0.0.0.0`） | Web 服务绑定的监听 IP，容器内由 compose 声明暴露给端口转发 |
| `DOWNVID_HTTP_PORT` | `6080` | Web 界面对外的宿主机访问端口 |
| `DOWNVID_HOME` | `/data` | 容器内数据根目录 |
| `DOWNVID_DATA_DIR` | `/data/userdata` | 用户数据与下载历史存放目录 |
| `DOWNVID_DOWNLOADS` | `/data/downloads` | 默认视频下载落盘目录 |
| `TZ` | `Asia/Shanghai` | 容器时区，影响日志时间戳 |

---

## 运行依赖

镜像内已预装与清单完全匹配的 **yt-dlp**（官方 nightly 独立运行时）与 **FFmpeg**：
- 进入「设置」→「运行依赖」，各项依赖将直接标记为 **「系统安装」**，绿勾亮起；
- 容器启动后立即可用，无需在界面内额外下载。

若需升级依赖版本，只需重新拉取/构建镜像即可：
```bash
docker compose build --no-cache
docker compose up -d
```

---

## 安全与访问控制

1. **绑定地址与网络隔离**：
   - 容器外独立启动时，服务默认绑定 `127.0.0.1` 回环地址，杜绝意外监听公网；
   - 容器内由 Compose 明确通过 `DOWNVID_WEB_HOST=0.0.0.0` 对接 Docker 端口映射。
2. **WebSocket 跨源（Origin）安全校验**：
   - 服务端内置严格的 Origin 白名单校验机制，仅允许来自同源 Host 或本地回环的连接，严格阻止跨站恶意脚本发起 CSWSH 劫持调用下载与文件接口。
3. **公网暴露建议**：
   - ⚠️ **请勿将 6080 端口直接暴露在公网！**
   - DownVid WebUI 设计为个人自托管工具，本身不含多租户权限系统；
   - 如需在公网环境下远程访问，**强烈建议在前面挂设带认证的反向代理**（例如 Nginx / Caddy / Cloudflare Access 并开启认证），或通过 VPN / Tailscale 接入内网。

---

## 品牌与第三方托管政策声明

详见仓库根目录的 [**TRADEMARKS.md**](../TRADEMARKS.md)：

1. **开源自托管软件**：本 Docker 镜像是供用户个人或团队自行部署的开源软件（基于 MIT 许可），**不代表 DownVid 官方提供任何形式的商业或在线云托管服务**；
2. **第三方托管披露**：第三方若使用本镜像提供公开或商业托管服务，**必须明确向最终用户披露其独立运营身份**，严禁使用“DownVid 官方云端版”、“官方托管”或暗示任何官方背书的措辞；
3. **商标与视觉边界**：软件源码的 MIT 许可不等同于对“DownVid”商标、Logo 视觉素材及官方形象的授权，商业部署应遵守项目品牌政策。

---

## 故障排除

### 1. 网页打不开 / 连接被拒绝

查看容器运行状态与服务日志：
```bash
docker compose ps
docker compose logs --tail=50
```
正常启动日志应包含：
```text
[web] DownVid 1.3.4 WebUI 服务已启动：http://0.0.0.0:6080/
[web] 下载保存目录：/data/downloads
```

### 2. 检查健康检查接口

通过 HTTP 访问健康探针：
```bash
curl http://127.0.0.1:6080/healthz
```
预期返回：`{"ok":true,"version":"1.3.4"}`。

---

## 自己构建镜像

```bash
# 根目录下使用 compose 构建
docker compose build

# 或直接使用 docker 目录下的配置构建
docker build -f docker/Dockerfile -t downvid:latest .
```

---

## 架构设计说明

- **严格物理隔离**：Docker / Web 相关的所有实现集中收敛于 `docker/` 目录（`docker/server/`、`docker/web/`、`docker/Dockerfile`），桌面核心代码（`electron/` 与 `src/`）保持 **100% 官方原样，无任何代码侵入**；
- **前端同构复用**：`docker/web/bridge.ts` 结合独立的 `docker/web/index.html` 入口，在构建期加载桥接层并在浏览器中模拟完整的 `window.electronAPI`，实现对现有 Vue 3 组件及 Pinia 状态管理 100% 零修改复用；
- **核心逻辑共享**：通过 `docker/server/electron-shim.ts` 轻量适配层，Node 服务在无头环境下无缝复用 `electron/download/` 与 `electron/parsers/` 下经过实机检验的稳定下载调度逻辑。
