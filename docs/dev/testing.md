# 验证与测试

> 从 `AGENTS.md` 拆出，内容未改动。

改完必须跑对应的一层。前端检查**已不在 CI 中运行**（见下文），改 UI 时自己跑；
Go 核心测试仍由 CI 的 backend job 覆盖，但本地 `go test` 更便宜。

```bash
# Go 核心（app/）
(cd app && gofmt -l . && go vet ./... && go test -shuffle=on ./...)

# Go 侧车（backend/）
cd backend && gofmt -l . && go vet ./... && go test -shuffle=on ./...

# 前端
pnpm --dir app/frontend check        # svelte-check
pnpm lint:i18n:app                   # 中英词条成对 + t() key 存在
pnpm --dir app/frontend test         # 前端纯逻辑单测

# 根目录纯逻辑单测（shared/ 与发布脚本）
pnpm test

# 静态校验
pnpm lint:boundaries                 # G1：app/internal 包之间不得互相 import
pnpm lint:icons                      # 图标名是否有效（写错会静默渲染成文字）
pnpm lint:website                    # 官网词条 / 资源 / 配色 / 产物名
pnpm lint:docs                       # 本文件 ↔ CLAUDE.md 一致 + 引用路径真实存在
pnpm lint:workflows                  # 「用了某工具」与「装该工具」成对
pnpm lint:attribution                # 上游版权声明未归零前不许删 LICENSE
pnpm audit:provenance                # 代码来源审计
pnpm sync:repo && pnpm sync:toolchain && pnpm sync:changelog
pnpm deps:manifest:check             # 依赖清单是否落后上游

# 端到端
pnpm test:e2e:real                   # 真实 yt-dlp / ffmpeg（缺依赖时明确跳过）
bash app/scripts/build.sh            # 单文件产物
```

## 关于测试

三层：**Go 核心**（`app/internal/*/**_test.go`）、**Go 侧车**（`backend/internal/*/**_test.go`）、
**前端纯逻辑**（`app/frontend/src/lib/*.test.ts` 与 `tests/*.test.ts`）。

- 纯逻辑单测只覆盖**纯函数**：格式选择、进度行、参数组装、更新源降级、设置归一化。
- 依赖 DOM 或需要真的起子进程 / 联网的逻辑**不写单测**——它们走集成回归（`app/e2e_*_test.go`、
  `scripts/test-e2e-real.mjs`），或靠 svelte-check 与真机验证拦。
- 新增测试请针对「曾经出过问题的分支」各留一个用例，**不追覆盖率数字**。
- **写完必须做变异验证**：把被测逻辑改坏，确认用例会失败。不会失败的测试等于没有测试。
- `app/frontend` 的单测刻意不引入 jsdom：`environment: 'node'`。

## CI 工作流分工

测试按**平台**拆成三个工作流（`.github/workflows/ci-linux.yml`、
`.github/workflows/ci-macos.yml`、`.github/workflows/ci-windows.yml`），每个工作流内部按职责拆 job：

| job | 内容 |
| --- | --- |
| `backend` | 侧车与核心的 gofmt / vet / `go test -shuffle=on` / 边车交叉编译 |
| `integration` / `build` | 仅 Linux：真实依赖端到端；三平台各有 `build` job 编译一次单文件产物 |

三个工作流都有前置的 `changes` job：**文档 / 官网 / Markdown-only 的 push** 跳过交叉编译、
三平台产物与真实依赖端到端。原先的 `frontend` job（图标 / 官网 / 文档 / 来源审计 / 边界 /
坐标 / 词条 / 工作流 / 根目录单测 / svelte-check / 前端单测）**已移除**：它频繁失败，反而挡住
无关改动。这些检查在改 UI 或发版前本地跑：`pnpm lint:*`、`pnpm test`、
`pnpm --dir app/frontend check`、`pnpm --dir app/frontend test`。`release.yml` 仍会跑它需要的
静态校验。

发布由 `.github/workflows/release.yml` 负责；`.github/workflows/release-audit.yml` 每天独立核对
「最新 tag ↔ Release 是否对得上」；`.github/workflows/update-deps.yml` 升级运行依赖清单；
`.github/workflows/triage.yml` 做 Issue 分类。

**新增测试脚本必须挂到对应平台的工作流上** —— 曾经 `test:acceleration` 加了脚本却没接进 CI，
加速逻辑长期没有自动化验证。同理，**新增工作流文件时必须先 `git add`**（`scripts/lint-docs.mjs`
会校验文档提到的 workflow 真实存在）。

## 关于格式化

没有 ESLint / Prettier，**不要引入**（格式化差异会污染历史 diff）。
前端靠 svelte-check 与 TypeScript 严格模式，Go 靠 `gofmt` + `go vet`。

---
