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
- [升级容器](#升级容器)
- [更新源与网络受限环境](#更新源与网络受限环境)
- [安全与访问控制](#安全与访问控制)
- [品牌与第三方托管政策声明](#品牌与第三方托管政策声明)
- [故障排除](#故障排除)
- [自己构建镜像](#自己构建镜像)
- [架构设计说明](#架构设计说明)

---

## 特点与优势

相较于传统的 Xvfb / VNC 虚拟桌面方案，原生 WebUI 带来质的提升：

- **极致轻量**：去除了 Electron GUI、X11 显示服务与 VNC 组件，镜像压缩后约 **200MB**（解压约 600MB），运行时内存仅占用数十 MB；
- **原生操作体验**：直接在浏览器渲染 Vue 3 页面，无任何远程桌面鼠标延迟、支持宿主机原生剪贴板直接粘贴，界面 60fps 丝滑流畅；
- **移动端与平板自适应**：手机、平板打开局域网地址即可解析与下载视频，无需安装任何客户端；
- **文件直落宿主机**：下载完成的视频直接写入挂载的 `./data/downloads` 目录，随下随取。

---

## 快速开始

官方镜像发布在 GHCR，支持 **amd64 / arm64** 两个架构，不需要先 clone 仓库：

```bash
docker run -d --name downvid \
  -p 6080:6080 \
  -v "$PWD/data/downloads:/data/downloads" \
  -v "$PWD/data/userdata:/data/userdata" \
  ghcr.io/Downvid/downvid:latest
```

或者用 compose（**推荐**：升级只要两条命令，见[升级容器](#升级容器)）：

```bash
curl -O https://raw.githubusercontent.com/Downvid/downvid/main/docker-compose.yml
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
| `DOWNVID_IMAGE` | 未设置 | 镜像名（如 `ghcr.io/Downvid/downvid:latest`）。用于检查 registry 上有没有新 digest，并原样出现在「升级命令」里 |
| `DOWNVID_UPDATE_SOURCE` | `auto` | 更新源：`auto` / `github` / `jsdelivr` / `ghproxy` / `gitee` / `website`。也可以在界面里改 |

---

## 运行依赖

镜像内已预装 **yt-dlp / FFmpeg / ffprobe**，三者的**版本与 SHA-256 都取自仓库的依赖清单**
（`backend/internal/manifest/assets.gen.go`），也就是说与桌面版用户点「下载」拿到的
是**同一份二进制**——编码器、合并行为、能下的站点完全一致。

- 进入「设置」→「运行依赖」，三项都会标记为 **「系统安装」**；
- 容器启动后立即可用，无需在界面内额外下载；
- 构建镜像时每个二进制都会校验 SHA-256，下载损坏或被替换会**直接构建失败**，
  而不是等用户点了下载才发现视频是坏的。

依赖版本跟随清单升级，所以升级依赖 = 升级镜像（见下一节）。

---

## 升级容器

容器里**不能**自更新：进程跑在镜像的只读层上，任何改动都会在下次 `docker run` 时消失。
升级方式只有一条——拉新镜像并重建容器：

```bash
docker compose pull downvid
docker compose up -d downvid
```

镜像里带更新检查：有新版本时界面会提示，并给出上面这两条命令（一键复制）。
也可以在「设置 → 更新」里换更新源，见下文。

首次升级到新版本后建议顺手看一眼容器日志，确认迁移没报错：

```bash
docker compose logs --tail=50 downvid
```

---

## 更新源与网络受限环境

镜像里的更新检查与桌面版**共用同一套更新源链路**：

```text
GitHub API → jsDelivr → gh-proxy → Gitee → 官网
```

依次尝试，任一成功即停止。原因很直接：国内网络下 `api.github.com` 经常连不上，而
**「连不上」在更新流程里的表现是「已是最新」**——用户什么提示都看不到，就永远停在旧版本上。
这条链路本身要是坏了，发新版也修不好（通道就是坏的），所以必须能换路。

三种改法，按使用场景选：

| 场景 | 做法 |
| --- | --- |
| 某个源在你这里不通 | 界面「设置 → 更新 → 更新源」选另一个 |
| 想统一给整台机器/整个内网定策略 | compose 里设 `DOWNVID_UPDATE_SOURCE=ghproxy` |
| 有内网镜像 / 反向代理 | `DOWNVID_UPDATE_SOURCE=github`（把 github.com 与 api.github.com 在 DNS 或代理层接管） |

> Gitee 与 jsDelivr 这两条源需要仓库维护者在对应平台同步发布才会生效。没同步时它们会返回
> 404，链路会**静默跳过**——不影响其它源，但也不会给你答案。

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
[web] DownVid 1.4.0 WebUI 服务已启动：http://0.0.0.0:6080/
[web] 下载保存目录：/data/downloads
```

### 2. 检查健康检查接口

通过 HTTP 访问健康探针：
```bash
curl http://127.0.0.1:6080/healthz
```
预期返回（镜像名与版本都会带上，排障时贴这一行就够）：
```json
{"ok":true,"app":"DownVid","image":"ghcr.io/Downvid/downvid:latest","repo":"Downvid/downvid","version":"1.4.0","tz":"Asia/Shanghai"}
```

### 3. 下载报 EACCES / 提示目录不可写

`/data/downloads` 是宿主机目录的 bind mount，**属主由宿主机决定**，镜像不会替你改。
先确认宿主机上的目录对容器内用户可写：

```bash
ls -ld ./data/downloads
# 需要时把属主改成运行容器的 uid（默认是 root）
sudo chown -R 1000:1000 ./data/downloads
```

如果你的 NAS 只允许特定 uid 写（群晖 / 飞牛常见），在 compose 里显式指定，别改镜像：

```yaml
    user: "1026:100"   # 你的 DSM 账号 uid:gid
```

### 4. 依赖显示「未下载」而不是「系统安装」

镜像里的三个二进制在 `/usr/local/bin`，属于边车的系统候选路径。若显示缺失，
先确认它们在容器里能跑：

```bash
docker compose exec downvid yt-dlp --version
docker compose exec downvid ffmpeg -version | head -1
docker compose exec downvid ffprobe -version | head -1
```

三条都正常但界面仍显示缺失，通常是 `PATH` 被 compose 里的 `environment` 覆盖了
（**不要**显式设置 `PATH`，镜像里已经包含 `/usr/local/bin`）。

### 5. 提示有新版本，但 pull 下来版本没变

最可能是「拉了镜像但没重建容器」——容器还在用旧镜像。用 compose 一条命令搞定：

```bash
docker compose pull downvid && docker compose up -d downvid
```

手工 pull 之后**必须** `up -d`（或 `docker rm -f` 重建），只 `docker pull` 不会影响正在跑的容器。

---

## 自己构建镜像

```bash
# 根目录下使用 compose 构建
docker compose build

# 或直接构建（多架构需要 buildx）
docker build -f docker/Dockerfile -t downvid:latest .

# arm64 机器上构建、amd64 机器上运行同一份镜像
docker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile -t downvid:local .
```

改完 Dockerfile / compose / entrypoint 后，本地先跑这两个静态检查（都很快，
不需要真的构建镜像）：

```bash
pnpm lint:docker   # 依赖版本是否仍来自清单、有没有退回 tsx、更新检查有没有退化
pnpm test:web      # WebUI 服务端回归（跑的是打包产物，与镜像里同一份）
```

---

## 架构设计说明

- **严格物理隔离**：Docker / Web 相关的所有实现集中收敛于 `docker/` 目录（`docker/server/`、`docker/web/`、`docker/Dockerfile`），桌面核心代码（`electron/` 与 `src/`）保持 **100% 官方原样，无任何代码侵入**；
- **前端同构复用**：`docker/web/bridge.ts` 结合独立的 `docker/web/index.html` 入口，在构建期加载桥接层并在浏览器中模拟完整的 `window.electronAPI`，实现对现有 Vue 3 组件及 Pinia 状态管理 100% 零修改复用；
- **核心逻辑共享**：通过 `docker/server/electron-shim.ts` 轻量适配层，Node 服务在无头环境下无缝复用 `electron/download/` 与 `electron/parsers/` 下经过实机检验的稳定下载调度逻辑；
- **服务端在构建期打包成单文件**（`docker/dist-server/index.js`）：运行期只有 `node` 直跑，镜像里没有 `tsx`、没有 `node_modules`，冷启动不再转译上百个模块；
- **镜像瘦身靠的是替换依赖而不是删功能**：用 ffmpeg-static 的静态二进制替代 `apt install ffmpeg`（后者会拖进 LLVM、Mesa、icu 等约 290MB 依赖），yt-dlp 用 PyInstaller 独立包（不需要 python3）。
