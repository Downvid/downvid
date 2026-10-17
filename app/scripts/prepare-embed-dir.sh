#!/usr/bin/env bash
# 为 `//go:embed all:frontend/dist` 准备一个**存在且非空**的目录。
#
# ## 它解的是什么死循环
#
#     wailsjs/ 是 wails generate module 生成的
#       → 它要先编译 Go 包
#       → main.go 里有 `//go:embed all:frontend/dist`
#       → dist 不存在 / 是空目录时编译直接失败：
#             pattern all:frontend/dist: no matching files found
#             pattern all:frontend/dist: contains no embeddable files
#       → 而 dist 又需要先构建前端
#       → 前端 import 的正是 wailsjs/            ← 回到起点
#
# 注意「空目录」也不行：Go 的 embed 要求目录里**至少有一个可嵌入文件**
# （`all:` 前缀只影响是否包含 `_`/`.` 开头的文件，不改变这条）。
#
# ## 为什么不把占位文件提交进 dist/
#
# `vite build` 会清空 dist（`emptyOutDir` 默认 true），提交进去的文件
# 在下一次构建后就消失，git 会一直显示「已删除」。
# 由脚本创建就不受构建工具影响。
#
# ## 为什么这个占位文件不会被用户看到
#
# 因为它会在真正的 `pnpm build` 之后被清掉；而且即使残留，
# 它也只是一个空的 `.gitkeep`，不影响 `index.html` 的加载。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p frontend/dist
touch frontend/dist/.gitkeep
echo "已准备 frontend/dist（含 .gitkeep 占位）"
