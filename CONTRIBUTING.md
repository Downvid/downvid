# 贡献指南

感谢你对 DownVid 的兴趣！本文档描述了如何参与贡献。

## 开发环境搭建

### 前置要求

- Node.js 22+
- pnpm >= 8
- Go 1.24+（编译依赖边车 `backend/cmd/downvid-deps`）
- Git

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/yxxbc/downvid.git
cd downvid

# 安装依赖
pnpm install

# 启动开发模式（yt-dlp / ffmpeg 无需预先安装：
# 运行时会自动识别系统里已有的版本，缺了可在应用内一键下载）
pnpm dev
```

### 构建

```bash
# 当前平台构建
pnpm build

# 指定平台
pnpm build:mac
pnpm build:win
pnpm build:linux
```

### 代码检查

```bash
pnpm vue-tsc --noEmit              # 前端类型检查（CI 必跑）
cd backend && go vet ./... && go test ./...   # Go 侧车
pnpm deps:manifest:check           # 依赖清单是否与上游一致
```

## Git 提交规范

本项目使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 规范。

### Commit Message 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档更新 |
| `style` | 代码格式（不影响功能，如空格、分号等） |
| `refactor` | 重构（既不是新增功能，也不是修复 bug） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建系统或外部依赖变更 |
| `ci` | CI 配置变更 |
| `chore` | 杂项（不修改 src 或测试文件） |
| `revert` | 回退提交 |

### Scope（可选）

影响范围，如：`updater`、`downloader`、`ui`、`parser`、`ci`、`docs` 等。

### Subject

简短描述，不超过 50 个字符，使用祈使句，不加句号。

### 示例

```
feat(parser): 支持抖音 Cookie 自动从浏览器读取

fix(updater): 修复 macOS ARM64 架构下更新包路径错误

refactor: 模块化拆分 electron/main.ts

docs: 更新 README 安装说明

chore: 升级 electron 到 30.0.1
```

## 分支管理

- `main`：主分支，保持稳定
- `feat/<功能名>`：新功能分支
- `fix/<问题描述>`：修复分支
- `docs/<内容>`：文档分支
- `chore/<内容>`：杂项分支

### 提交流程

1. 从 `main` 分支创建新分支
2. 进行开发，按规范提交
3. 推送分支到远程
4. 创建 Pull Request，目标分支为 `main`
5. 等待 Code Review 和 CI 通过
6. 合并到 `main`

## Pull Request 规范

### PR 标题

使用与 commit message 相同的 Conventional Commits 格式。

### PR 描述

请包含以下内容：

1. **变更类型**：新功能 / Bug 修复 / 重构 / 文档 / 其他
2. **变更描述**：简要说明做了什么
3. **关联 Issue**：如 `Closes #123`
4. **测试说明**：如何验证变更
5. **截图/录屏**：UI 变更请附上截图

## 代码规范

- TypeScript 严格模式（`strict` + `noUnusedLocals` + `noUnusedParameters`，未使用的 import 会导致构建失败）
- Go 代码用 `gofmt` 格式化并通过 `go vet`
- 组件使用 `<script setup>` 语法
- UI 文案、注释与 commit body 使用中文
- 遵循现有代码风格和目录结构

## 问题反馈

- Bug 报告：使用 Bug 报告模版
- 功能请求：使用功能请求模版
- 解析问题：使用平台解析问题模版

感谢你的贡献！🎉
