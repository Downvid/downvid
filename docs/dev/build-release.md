# 构建与发布

> 从 `AGENTS.md` 拆出，内容未改动。

```bash
bash app/scripts/build.sh                            # 当前平台
bash app/scripts/build.sh -platform darwin/arm64
bash app/scripts/build.sh -platform darwin/universal  # 边车会为 arm64 + amd64 各编一份
```

发布流程见 `docs/release.md`。要点：

1. `package.json` 升版本 → `CHANGELOG.md` 加 `## [x.y.z]` 段落 → 推 tag `v*`
   （或在 Actions 页面手动运行 `release.yml`，填与 `package.json` 一致的版本号）
2. `release.yml` 先跑发布门禁（Go 测试 + 静态校验 + 单测 + 边车交叉编译），再按
   macos-latest / windows-latest / ubuntu-22.04 三个矩阵构建产物，最后创建 Release、
   自检产物完整性、刷新官网版本号并显式触发 Vercel 部署。
3. Release 正文由 `scripts/gen-release-notes.mjs` 生成：顶部是「点徽章即下载」的引导区，
   下载链接**按实际产物扫描生成**，不会出现死链。

## 未发布的改动记在 `[Unreleased]`

没有发布计划时，`package.json` 的版本号**保持在最近一次已发布的版本**，
CHANGELOG 用 `## [Unreleased]` 段落累积改动。发布时再一次性改成 `## [x.y.z] - 日期` 并升版本号。

---
