# DownVid 前端

Svelte 5 + Vite + Tailwind v4。桌面端由 **Wails** 加载（同一份构建产物），
容器端由 Go 服务端托管（`dist/` 直接由 `cmd/downvid-server` 提供服务）。

## 开发

```bash
pnpm install
pnpm dev        # http://localhost:5173（浏览器里没有后端，只能看界面）
```

要**完整功能**（解析、下载、依赖、设置）必须跑在 Wails 里：

```bash
cd ..           # app/
wails dev       # 热重载 + 真实后端绑定
```

> 浏览器里 `pnpm dev` 能看界面与动效，但所有后端调用都会返回
> 「浏览器预览模式没有后端」。这是刻意的——不做假数据回退，
> 假数据会掩盖真实的错误处理路径。

## 构建

```bash
pnpm build      # → dist/（桌面与容器共用这一份）
```

`vite.config.ts` 的 `base: './'` **不能改**：Wails 用 `embed.FS` 从根加载，
绝对路径 `/assets/...` 在 `file://` 或反向挂子路径时会 404 ——
表现是**图标全变成文字**（字体没加载，liga 连字不生效），而构建完全不报错。

版本号由 `vite.config.ts` 从 `package.json` 注入 `__APP_VERSION__`，
前端不手写——手写的会在发版时忘记改。

## 结构

```
src/
├─ App.svelte          根壳：导航、弹窗挂载、全局快捷键
├─ main.ts             入口
├─ app.css             Tailwind v4 主题（@theme 色值与旧版一致）
├─ announcements/      公告文本（author.zh.md / author.en.md，编译期打进产物）
├─ assets/             图标、海报、技术栈 logo
├─ components/         视图与组件
│  ├─ DownloadView      首页 / 解析结果
│  ├─ HistoryView       下载历史
│  ├─ SettingsView      设置（6 个分区）
│  ├─ AboutView         关于
│  ├─ CaptureBar        链接输入（粘贴 / 拖放 / 快捷键）
│  ├─ ParseResult       解析结果与格式选择
│  ├─ TransferRail      传输队列（右侧栏）
│  ├─ TaskCard          单个下载任务
│  ├─ DepsDialog        缺依赖时的「一键下载」
│  ├─ UpdateDialog      更新弹窗
│  ├─ AnnouncementDialog 作者的话
│  ├─ EffortSlider      加速档位滑块（含能量辐射层）
│  └─ …
└─ lib/
   ├─ backend.ts        后端适配层（**唯一**与 Wails 绑定打交道的地方）
   ├─ store.svelte.ts   应用状态机（单例）
   ├─ settings.ts       设置模型（后端字段 ↔ 前端字段的映射）
   ├─ types.ts          类型契约
   ├─ constants.ts      常量与纯函数
   ├─ url.ts            URL 提取与平台识别
   ├─ format.ts         展示格式化
   ├─ radiation.ts      滑块的能量辐射（canvas）
   ├─ i18n.svelte.ts   界面文案（响应式）
   └─ activity.ts       下载热力图
```

## 数据流

```
组件 ──读状态/调方法──► store.svelte.ts
                              │
                              ▼
                        backend.ts（唯一出口）
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
             Wails 绑定            （浏览器里 null）
             wailsjs/go/main/App         │
                    │                   ▼
                    ▼              「没有后端」错误
              Go 主进程
```

**所有后端调用必须经 `backend.ts`**，不要在组件里直接 `import wailsjs/...`：
- 浏览器里那会直接抛 `Failed to resolve module`，整页白屏
- 换传输层（WebSocket / HTTP）时只改一处

## 设计约束（有测试钉住）

| 约束 | 为什么 | 测试 |
|---|---|---|
| `transition` 只动 transform / opacity / box-shadow | 其它属性触发 layout，低端机掉帧 | `design-system.test.ts` |
| `keyframes` 不得含 layout 属性 | 同上 | 同上 |
| 动效时长 ≤ 300ms | 超过会被感知为「卡」 | 同上 |
| `prefers-reduced-motion` 下彻底关掉 | 「减少动态」不是「慢一点」 | 同上 |
| 主色 `#8c5100` 不得换成渐变紫 | 换掉就变成「又一个 AI 生成的页面」 | 同上 |
| 滑块档位上限 16 与 Go 侧 clamp 一致 | 不一致时用户拖到最高档、存进设置会变回更小的值 | `effort.test.ts` |

## 已知缺口

- **更新下载/安装未实现**：Go 侧只有更新检查，没有 electron-updater 的下载与安装。
  `downloadUpdate()` 如实打开 Releases 页面，不假装成功。
- **代理探活未实现**：后端没有独立的代理测试接口，`testProxy()` 只做格式校验并说明。
- **任务不跨重启恢复**：任务列表只活在内存里。
- **暂停后恢复依赖 `.part`**：yt-dlp 从断点续传，但前端不保存已暂停任务的列表。
