# 界面约定与前端

> 从 `AGENTS.md` 拆出，内容未改动。

- **所有界面文案走 `t('key')`**，不要写中文字面量；新增词条必须中英成对。
- **Tailwind v4**（CSS-first，**没有** `tailwind.config.js`）：Material-3 风格语义色 token
  定义在 `app/frontend/src/app.css` 的 `@theme`。**用语义 token，不要写 raw hex。**
- `app/frontend/src/design-system.test.ts` 钉住了主色、动效属性与时长。
- 图标：通用图标用 `app/frontend/src/components/Icon.svelte`（Material Symbols 字体名）；
  **品牌图标用专属 SVG 组件**（如 `GitHubIcon.svelte`），不要拿 Material 的通用图标凑
  （此前用 `code` 尖括号当 GitHub 图标）。
- 无路由：`App.svelte` 用条件渲染切换视图。

---
