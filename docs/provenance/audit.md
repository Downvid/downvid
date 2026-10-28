# 代码来源审计

[issue #74](https://github.com/yxxbc/downvid/issues/74) 第一阶段（审计代码来源）的落地文档。
数字全部由 `pnpm audit:provenance` 现场重算，不靠人肉抄写。

## 快速结论

| 问题 | 结论 | 怎么复核 |
| --- | --- | --- |
| 从哪来 | `cshuangyy/videdown@0c620c1`（2026-08-22），分叉点 `1d7b041` | `scripts/data/provenance/upstream/_SOURCE.txt` |
| 上游代码还剩多少 | 上游 **2707** 条有效源码行中，**143** 行（**5.3%**）仍逐字存在 | `pnpm audit:provenance` |
| 谁在贡献这些行 | 全部落在界面外壳（`app/frontend/`）与文档里的 CSS/HTML 片段 | `--report` 的「活在哪」一列 |
| 还有没有「上游衍生文件」 | 没有：没有任何当前文件的上游成分达到 15% 阈值 | `--report` 最后一节 |

## 判定方法（为什么是「逐字行存活率」而不是 git blame）

上游 `electron/main.ts` 是 2756 行的单文件，DownVid 把它拆成多个模块，git blame 只能告诉你
「这行来自拆分那次提交」，无法告诉你「这行是上游写的」。

所以判定单位是**去掉空白差异的源码行**：

1. 上游保留一份逐字快照（`scripts/data/provenance/upstream/`）；
2. 对上游每个文件的「有效行」（归一化后 ≥12 字符、且不是纯括号/标签）统计它在**当前仓库任意文件**
   里的逐字命中数；
3. 同时反向统计每个当前文件有多少行能逐字命中上游——这就是「该文件的上游成分」，
   用于判断它是否需要登记。

**局限（必须照实写）**：逐字命中说明「这行与上游相同」，不说明「这行是抄来的」。
像 `import fs from 'node:fs'`、`export default {` 这类行任何项目都会出现，
所以阈值只用来**挑出需要人工复核的文件**，不是法律意义上的相似度判定。

## 上游文件存活情况

由 `node scripts/audit-provenance.mjs --report` 打印；下表是当前结果（只列有命中的上游文件）。

| 上游文件 | 有效行 | 逐字存活 | 比例 |
| --- | ---: | ---: | ---: |
| `electron/main.ts` | 1229 | 26 | 2.1% |
| `electron/electron-env.d.ts` | 34 | 4 | 11.8% |
| `electron/preload.ts` | 103 | 4 | 3.9% |
| `index.html` | 11 | 8 | 72.7% |
| `src/types/index.ts` | 48 | 20 | 41.7% |
| `src/style.css` | 84 | 27 | 32.1% |
| `src/App.vue` | 52 | 12 | 23.1% |
| `src/env.d.ts` | 40 | 9 | 22.5% |
| `src/components/icons/MaterialIcon.vue` | 35 | 13 | 37.1% |
| `src/components/SettingsView.vue` | 101 | 5 | 5% |
| `src/components/DownloadView.vue` | 615 | 5 | 0.8% |
| `src/components/AboutView.vue` | 123 | 1 | 0.8% |
| `src/components/HistoryView.vue` | 84 | 1 | 1.2% |
| `src/components/HelloWorld.vue` | 17 | 1 | 5.9% |
| `postcss.config.js` | 3 | 1 | 33.3% |
| `tailwind.config.js` | 72 | 1 | 1.4% |
| `src/vite-env.d.ts` | 1 | 1 | 100% |
| **合计** | **2707** | **143** | **5.3%** |

> 读这张表的正确姿势：`tailwind.config.js` 的 1.4% 与 `src/style.css` 的 32.1% 是同一件事——
> Tailwind v4 把配置搬进了 CSS 的 `@theme`，所以命中从旧的配置文件转移到了 `app/frontend/src/app.css`。
> 这些行是**颜色值、字体声明、主题变量**，属于产品设计而非算法实现。

## 当前文件的登记表

`scripts/data/provenance/registry.json` 是唯一入口：

- 某个当前文件的上游成分 ≥15%（且 ≥8 行）而**没有登记** → CI 红叉
- 登记的数字与实测不一致 → CI 红叉
- 已登记但实测已达不到阈值 → 提示可以移除（不红叉）

当前登记的是 18 个上游文件的「去向」记录（`upstream-relocated`）：它们本身已被删除，
但有效行仍在 `app/frontend/` 的界面外壳里逐字存活。没有任何当前文件达到需要按
「上游衍生」登记的比例。

## 为什么保留这份审计

- `LICENSE` 里写着「substantially modified」，这句话需要可复算的凭据；
- 只要还有上游行存活，MIT 就要求保留上游版权声明（`pnpm lint:attribution` 会拦）；
- 下次重写界面外壳时，这份表能直接回答「还剩多少可以删」。

## 怎么复核

```bash
pnpm audit:provenance                        # CI 跑这条
node scripts/audit-provenance.mjs --report   # 打印完整表格，不写文件
node scripts/audit-provenance.mjs --write    # 重算并写入登记表（改代码后）
```

改了代码后如果数字变了，**必须**同步本文件里的三个数（有效行数、存活行数、存活率）——
`pnpm audit:provenance` 会校验它们是否与实测一致。
