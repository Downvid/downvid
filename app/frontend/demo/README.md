# DownVid · UI 演示

这是新 UI 层的**独立预览入口**，与迁移中的 `app/frontend/src` 完全隔离：
不 import Wails 绑定、不依赖 Electron / Wails 运行时，所有数据来自 `lib/mock.ts`。

## 预览

在仓库根目录：

```bash
pnpm demo:ui
```

或者：

```bash
cd app/frontend
pnpm demo
```

浏览器会自动打开 `/demo/`。也可以手动访问 <http://localhost:5173/demo/>。

> 页面右上角的 **DEMO** 按钮是演示控制台，可切换下载页状态、页面、弹窗与语言。
> 它只在演示入口里存在，不是产品 UI 的一部分。

首页：命令条（含**与设置同步的下载加速滑块**）+ **最近 44 周下载热力图** +
最近下载主卡与索引列表。桌面窗口 1200×900 / 1000×700 都**不需要滚动**就能看完。
把链接拖进窗口任意位置会进入拖放解析；最近下载卡片 / 列表点击后进入**下载历史**。
解析结果顶部有「返回」；同一视频（标题或 URL 相同、且文件还在）会标记为已下载，
不会再次进入下载队列。右上角「作者的话」读取 `announcements/author.*.md`。

下载加速滑块对标 Codex 的 thinking effort：离散四档（轻量 4 / 均衡 8 / 快速 12 / 激进 16），
档位标签常驻，首页和设置共用同一个字段，任一端调整另一端立即同步。快速 / 激进档会进入
"hot" 状态：轨道升温渐变、白色星点飘动、设置页 thumb 上方浮出限流提示（参考 Codex 滑块的动效，
颜色按 DownVid 品牌收敛为琥珀 → 橙红，而不是直接搬蓝紫）。

主题：**设置 → 界面 → 主题**，支持浅色 / 深色 / 跟随系统，选择会保存。
圆角：**设置 → 界面 → 圆角**，默认 / 紧凑 / 圆润；圆润档沿用 `website/index.html` 的
`--radius-card / --radius-panel / --radius-media`（24 / 16 / 12）。`?radius=round` 可直接预览。

移动端（≤820px）：页面切换固定在**底部标签栏**，状态栏隐藏，传输队列改为底部浮层，
设置 / 历史 / 关于逐级堆叠。

关于页：
- 贡献者固定名单（旧版 AboutView 同款，不走 GitHub API，头像失败时回退首字母）
- 「更新日志」可按版本切换（v1.5.0 / v1.4.0 / v1.3.4），不是只显示最新三条
- 技术栈用 Go / Wails / Svelte / TypeScript 的官方品牌图标；「产品官网」用项目真实 logo
- 底部「支持 DownVid」沿用旧版交互：展开/收起赞赏码，以及赞助 / 商务合作的邮件入口

## 用 URL 直接打开某个状态

| 参数 | 值 |
| --- | --- |
| `state` | `parsing` / `parsed` / `error` / `busy` |
| `tab` | `download` / `history` / `settings` / `about` |
| `lang` | `zh` / `en` |
| `theme` | `auto` / `light` / `dark` |
| `radius` | `default` / `sharp` / `round` |
| `update` | `1`（打开更新弹窗） |
| `deps` | `1`（打开缺少依赖弹窗） |
| `announcement` | `1`（打开作者的话） |

示例：

```
http://localhost:5173/demo/?state=busy
http://localhost:5173/demo/?state=parsed&tab=history&lang=en
http://localhost:5173/demo/?theme=dark&tab=settings
http://localhost:5173/demo/?radius=round
http://localhost:5173/demo/?announcement=1
```

## 结构

```
demo/
├─ index.html                 独立入口
├─ app.css                    设计系统（暖琥珀 + 墨色 + 纸感；含深色主题）
├─ announcements/
│  ├─ author.zh.md            作者的话（中文）
│  └─ author.en.md            作者的话（英文）
├─ assets/donate.jpg          支持作者：微信赞赏码
├─ assets/tech/                官方技术栈图标（Simple Icons）
├─ lib/
│  ├─ mock.ts                 假数据（格式、历史、依赖）
│  ├─ activity.ts             按天确定性生成的下载热力数据
│  ├─ announcement.ts         读取 author.*.md + 镜像降级链（GitHub → jsDelivr → gh-proxy → 本地）
│  ├─ store.svelte.ts         状态 + 模拟引擎（解析阶段、≤3 并发、进度、更新、主题）
│  ├─ format.ts               纯展示格式化
│  └─ i18n.svelte.ts          演示自己的中英文词表
└─ components/                视图与组件（ActivityPanel / EffortSlider / ...）
```

## 公告（作者的话）

公告**不是更新日志**，内容来自 `announcements/author.zh.md` / `author.en.md`（frontmatter
里写 title / date / signature，正文支持段落、`##` 小标题和 `- ` 列表）。

`lib/announcement.ts` 里写清了正式实现的读取顺序：

1. `raw.githubusercontent.com`（GitHub 直连）
2. `cdn.jsdelivr.net/gh`（CDN 镜像）
3. `ghproxy.com`（公共反代）
4. 全部失败 → 构建时打包的本地 md（离线兜底）

国内直连 GitHub raw 经常超时，只留一条路会导致「用户永远看不到作者写了什么」。
演示为了离线可靠直接用本地文件；`fetchAnnouncement()` 保留给真实接入。替换作者的话
只需要改这两个 md 文件。

## 设计约束（有意为之）

- **不做玻璃 / backdrop-filter**：层次靠细线、实色面、排版与留白。
- 琥珀只承担信号：主操作、选中、进度、下载热力、effort 滑块；其余用墨色与灰阶。
- 浅色 / 深色共用同一套 token，固定深色面（照片角标 / toast / 演示面板）用 `--panel-dark`。
- 连接数滑块在首页和设置页共用 `EffortSlider` 与 `maxConnections`，四档：4 / 8 / 12 / 16。
- 圆角通过 `:root[data-radius]` 切换 `--radius-card/panel/media/control`，组件不写死半径。
- 动效只解释状态（160ms 左右），只动 transform / opacity，尊重 `prefers-reduced-motion`。
- 所有正文文案走 `t()`，中英文都在 `lib/i18n.svelte.ts` 里。
- 数据为模拟：缩略图来自 Unsplash，仅用于演示。

## 与正式 UI 的关系

演示验证通过后，组件可以逐个搬进 `app/frontend/src`，把 `lib/store.svelte.ts` 里的
模拟方法替换为 Wails 绑定（`wailsjs/go/main/App`）即可。演示里的 i18n key 命名与
`src/i18n/core.ts` 保持一致，新增 key 可直接并回。
