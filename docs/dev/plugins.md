# 插件系统

第三方插件让 DownVid 在**不改主程序**的前提下扩展站点解析能力。本文是插件协议、
权限模型与索引规则的唯一说明。

## 一、边界：插件只回答「这是什么」

插件返回**元数据与直链**，不处理字节：

```
插件          resolve(url) → { 标题、作者、格式列表、CDN 直链 }
DownVid       按直链下载 / 或用格式列表交给 yt-dlp
```

这条边界是刻意的：

- **数据平面留在 Go**：插件拿不到解码后的内容，也就无从伪造或篡改；断点续传、
  并发分块、限速、进度这些既有能力一行都不用重写。
- **攻击面更小**：插件不需要文件系统、不需要起子进程，只需要网络。

## 二、协议

一个插件就是一个目录，至少两个文件：

```
my-plugin/
├── plugin.json
└── index.js
```

### plugin.json

```json
{
  "id": "bilibili",
  "name": "哔哩哔哩",
  "version": "1.0.0",
  "author": "someone",
  "main": "index.js",
  "playback": "downvid-parser",
  "minAppVersion": "1.12.0",
  "permissions": {
    "network": ["api.bilibili.com", "*.hdslb.com"]
  }
}
```

关键字段：

| 字段 | 说明 |
| --- | --- |
| `playback` | **必须是 `downvid-parser`**。宿主靠它区分本项目的解析插件与其他 MyGo 生态插件（那些是 `stream`，`resolve` 语义完全不同）。不匹配的插件会被拒绝加载并给出原因。 |
| `permissions.network` | 允许访问的域名，`*.example.com` 表示子域，`*` 表示任意。**留空 = 不能联网**。 |
| `minAppVersion` | 低于此版本的 DownVid 会拒绝加载，用于插件依赖新字段时避免静默出错。 |

> `playback` 借用了 MyGo 插件宿主的字段，因为宿主当前版本还没有通用的
> `contract` 字段。上游一旦提供，应迁移过去。

### index.js

只要求导出一个 `resolve`：

```js
export function resolve(url) {
  if (!url.includes('bilibili.com')) return null   // 不认领
  return {
    id: 'BV1xx',
    title: '标题',
    uploader: 'UP主',
    duration: 123.4,                                // 秒，浮点
    thumbnail: 'https://i0.hdslb.com/x.jpg',
    webpageUrl: 'https://www.bilibili.com/video/BV1xx',
    formats: [
      { formatId: '80', quality: '1080P', ext: 'mp4',
        filesize: 12345678, width: 1920, height: 1080, fps: 60, hasAudio: true }
    ],
    directUrl: 'https://cdn.example.com/signed.mp4', // 可选
    notice: '已选取无水印版本'                        // 可选，显示给用户
  }
}
```

**约定：返回 `null` 表示「这个链接我不认识」**，属于正常路径，宿主会继续问下一个
插件、再退到内置解析器与 yt-dlp。抛出异常才算插件出错：该插件会被跳过，不影响其他
插件，原因记在设置页的插件列表里。

### 返回值会被校验

以下任何一种都会让这次解析失败（并把原因显示给用户），而不是把残缺数据交给界面：

- `title` 为空
- `formats` 与 `directUrl` 都为空
- 任一条 `formatId` 为空
- `directUrl` 不是 `http(s)` 地址（防止 `javascript:` 之类被下载器照单全收）

## 三、运行时与权限

插件跑在独立的 JS 运行时里（每个插件一个堆、一个事件循环）：

| 项 | 值 |
| --- | --- |
| 内存上限 | 256 MiB |
| 单次调用超时 | 20 秒 |
| 网络 | 仅 `permissions.network` 列出的域名，重定向一并检查 |
| 文件系统 | 只能读写自己的数据目录 |
| 子进程 | 当前版本**不提供** |

## 四、安装与目录

| 位置 | 用途 |
| --- | --- |
| `<userData>/plugins/<id>/` | 插件本体 |
| `<userData>/plugin-data/<id>/` | 插件私有数据 |

放在 `userData` 而不是程序目录：程序目录在 macOS 是签过名的 `.app` 包，写入会破坏
签名；Windows 装在 `Program Files` 时普通用户也无权写。

## 五、索引与审核

### 提交：打一个 topic 就够了

插件在**你自己的仓库**里托管，无需把代码交给本项目。收录是**自动**的：

1. 在仓库的 `plugin.json` 里声明 `"playback": "downvid-parser"`
2. 给仓库打上 `downvid-plugin` topic
3. 等索引仓库的定时任务跑（每天一次），或用 `workflow_dispatch` 手动触发

做不了这步的（不想打 topic、或想改显示名/站点列表）可以发 Issue 手工收录。

索引仓库：[Downvid/plugins](https://github.com/Downvid/plugins)，
收录脚本在 `scripts/update-plugin-index.mjs`。

#### 自动收录只做机器可判的部分

| 检查 | 不通过时 |
| --- | --- |
| `plugin.json` 是合法 JSON | 跳过，日志写原因 |
| `playback` 为 `downvid-parser` | 同上 |
| `id` 匹配 `^[a-z0-9][a-z0-9-]{1,40}$` | 同上（它会拼进文件路径） |
| 有非空 `name` | 同上（否则界面显示空白） |
| `id` 不在 `removed.json` 里 | 跳过并记录——下架过的不会因为重新打 topic 就回来 |

`permissions.network` 含 `*` 时只提醒、不拒绝（那是合法配置，但值得人看一眼）。

**机器判不了的是真正的恶意行为**（外传 Cookie、劫持结果等）。所以
`removed.json` 是手写的：一旦某个插件被人工下架，自动收录永远不会把它加回来。

### 审核范围

只审**能不能装、会不会伤人**，不审功能强弱：

- [ ] `plugin.json` 合法，`playback` 为 `downvid-parser`
- [ ] `permissions.network` 是最小集合（不做「直接写 `*`」）
- [ ] 没有明显的数据外传：不把 Cookie、设置、历史发往与解析无关的域名
- [ ] 没有读取插件数据目录之外的文件（当前运行时不提供文件 API，主要查是否
      试图绕过）
- [ ] 仓库公开、可追溯，有实际可读的源码（不接受只有混淆产物的插件）

### 不审核什么

- 不保证插件长期可用（平台改接口就会失效）
- 不保证解析结果正确
- **不审核插件是否违反某平台的条款**——这由插件作者与使用者负责

### 下架

发现以下情况会从索引移除，并把 id 记入 `scripts/data/plugins/blocklist.json`：
恶意代码、窃取凭据、明显的数据外传。下架只影响索引，不删除用户已装的文件。

## 六、责任

- 插件**不是**本项目的组成部分，由第三方编写与发布。
- 本项目只做索引收录，不托管插件代码，也不对其行为负责。
- 收录不等于背书功能或合法性；安装前请自行判断。

## 七、实现位置

| 路径 | 内容 |
| --- | --- |
| `app/internal/pluginhost/` | 插件宿主：加载、校验、调用、错误脱敏。**唯一** import 第三方插件运行时的包 |
| `app/plugins.go` | 接到 `App.Parse`，把插件结果转成 `parse.VideoInfo` |
| `app/internal/parse/` | 内置解析器，**不**依赖插件包 |

架构约束（`pnpm lint:boundaries` 校验）：`internal` 各包互相零依赖。插件宿主因此
不能与 `internal/parse` 互相 import，转换层放在 `app` 包里。

## 八、写一个插件（最小可运行）

```bash
mkdir -p my-plugin && cd my-plugin
cat > plugin.json <<'EOF'
{
  "id": "example",
  "name": "示例",
  "version": "0.1.0",
  "main": "index.js",
  "playback": "downvid-parser",
  "permissions": { "network": ["example.com"] }
}
EOF
cat > index.js <<'EOF'
export function resolve(url) {
  if (!url.includes('example.com')) return null
  return {
    id: '1',
    title: '示例视频',
    formats: [{ formatId: 'hd', quality: '720P', ext: 'mp4', hasAudio: true }]
  }
}
EOF
cp -r . "<userData>/plugins/example"
```

重启应用后，粘贴一个 `example.com` 的链接即可看到插件生效。
