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

## 用 URL 直接打开某个状态

| 参数 | 值 |
| --- | --- |
| `state` | `parsing` / `parsed` / `error` / `busy` |
| `tab` | `download` / `history` / `settings` / `about` |
| `lang` | `zh` / `en` |
| `update` | `1`（打开更新弹窗） |
| `deps` | `1`（打开缺少依赖弹窗） |

示例：

```
http://localhost:5173/demo/?state=busy
http://localhost:5173/demo/?state=parsed&tab=history&lang=en
http://localhost:5173/demo/?state=parsed&update=1
```

## 结构

```
demo/
├─ index.html         独立入口
├─ app.css            设计系统（暖琥珀 + 墨色 + 纸感；不用玻璃拟态）
├─ lib/
│  ├─ mock.ts         假数据（平台、格式、历史、依赖）
│  ├─ store.svelte.ts 状态 + 模拟引擎（解析阶段、≤3 并发、进度、更新）
│  ├─ format.ts       纯展示格式化
│  └─ i18n.svelte.ts  演示自己的中英文词表
└─ components/        视图与组件
```

## 设计约束（有意为之）

- **不做玻璃 / backdrop-filter**：层次靠细线、实色面、排版与留白。
- 琥珀只承担信号：主操作、选中、进度；其余用墨色与灰阶。
- 动效只解释状态（160ms 左右），只动 transform / opacity，尊重 `prefers-reduced-motion`。
- 所有正文文案走 `t()`，中英文都在 `lib/i18n.svelte.ts` 里。
- 数据为模拟：缩略图来自 Unsplash，仅用于演示。

## 与正式 UI 的关系

演示验证通过后，组件可以逐个搬进 `app/frontend/src`，把 `lib/store.svelte.ts` 里的
模拟方法替换为 Wails 绑定（`wailsjs/go/main/App`）即可。演示里的 i18n key 命名与
`src/i18n/core.ts` 保持一致，新增 key 可直接并回。
