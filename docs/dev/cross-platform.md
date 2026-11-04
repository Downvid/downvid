# 跨平台构建的坑

> 从 `AGENTS.md` 拆出，内容未改动。

本地是 macOS 不代表 Windows 上能过。CI 的 windows job 抓到过三类问题：

1. **`process.platform` ≠ `GOOS`**。Node 用 `win32`，Go 用 `windows`。直接透传会报
   `unsupported GOOS/GOARCH pair win32/amd64`。映射表在 `app/scripts/build.sh`。
2. **默认 shell 不同**。Windows runner 是 PowerShell：`/tmp` 会解析成 `D:\tmp`，
   `test -s` 等 POSIX 断言不成立。需要 POSIX 语义的步骤显式写 `shell: bash`。
3. **换行符**。Windows 默认 `core.autocrlf=true`，检出即 CRLF，而 CRLF 不是 `gofmt` 的输出，
   `gofmt -l` 会把**每个** Go 文件都判为未格式化。仓库根部的 `.gitattributes`
   （`* text=auto eol=lf`）统一为 LF，**不要删除该文件**。
4. **路径断言**。测试里不要写死 `/tmp/out/...`，生产代码用 `path.join`。
5. **Wails 的 `universal` 不是 Go 的 `GOARCH`**。`wails build -platform darwin/universal`
   由 Wails 自己 lipo 合并，但边车是我们自己编的：`app/scripts/build.sh` 必须为 arm64 与 amd64
   **各编一份**，否则用户下到 universal 包后依赖探测找不到二进制。
6. **Linux 的 Wails 构建要 webkit2gtk-4.0**。Wails v2.16 的 cgo 指令默认找 `webkit2gtk-4.0`
   开发包；只装 4.1 会编译失败（CI 已踩过）。
7. **Wails 前端不能用绝对资源路径**。`app/frontend/vite.config.ts` 的 `base` 保持 `'./'`；
   改成 `/` 后开发环境正常，打包进 `embed.FS` 就 404（图标变文字，构建不报错）。

**硬规则**：CI 里新增任何构建/检查步骤，必须先在本地以「非宿主平台语义」复现一遍
（交叉编译到 `win32`、用 `core.autocrlf=true` 检出），不能只核对 YAML 语法。

---
