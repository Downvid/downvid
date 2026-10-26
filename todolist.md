术语
三端：windows、macos、linux
双语：英语和中文

# 修复
- [x] 作者的话 有时候会弹出固定话语而非远程文档，删除硬编码的文案
      清理 `app/frontend/src/announcements/author.zh.md` 与 `author.en.md` 中的旧硬编码文案并同步最新走向内容；
      重构 `AnnouncementDialog.svelte` 与 `store.svelte.ts`，未获取远端前展示加载骨架屏，杜绝闪烁弹出旧固定文案。
- [x] release note自动化的模板用md语法中表格形式展示双语版本
      重构 `scripts/gen-release-notes.mjs`，构建双语对照下载矩阵表（Platform / Arch / Type / Package / Description）
      与平台双语注意事项对照表（中文说明 ↔ English Notes），一键直链自动识别实际存在的安装器与便携包。

# 增加
- [x] 忽略文件全量覆盖，包含三端
      `.gitignore` 覆盖三端操作系统文件（macOS `.DS_Store`/`._*`/`*.dmg`、Windows `Thumbs.db`/`Desktop.ini`/`*.msi`/`*.exe`、Linux `*~`/`*.deb`/`*.rpm`）与 Wails/Go 构建产物目录。
- [x] 增加三端打包的构建产物为对应的机器
      `.github/workflows/release.yml` 完善三端打包与发布矩阵：macOS 生成 `.dmg` 安装器（带 Applications 快捷方式）+ `.zip`；Windows 生成 `-installer.exe`（Wails NSIS 安装向导）+ `.zip`；Linux 生成 `.deb` 安装包 + `.tar.gz`；同步更新官网 `website/app.js` 下载分发逻辑。

# 变更
- [x] 依赖下载功能会让下载的产物后放在固定位置（三端都放～/.downvid），只扫描固定位置，防止各种问题导致的下载失败
      `app/bindings_download.go` 引入 `resolveManagedDir`，三端统一固定放置与扫描路径在 `~/.downvid/runtime/bin`，并兼容旧目录自动平滑迁移。
- [x] 前端检测也走后端，后端返回布尔值，前端来判断是否检测到
      后端 `DetectDependencies` 返回带 `Found: bool` 字段的规范切片，前端 `store.svelte.ts` 依此响应式更新并判定缺失依赖数与提示状态。
- [x] 依赖下载失败问题，需要结合新架构和上述改动来调整，确保测试能过
      前后端与边车全链路对齐，单元测试与变异测试全部通过。

# 删除（已完成）
- [x] 全量舍弃旧版本代码，改为全新架构
      `electron/`、`src/`、`docker/`（旧 TS 服务端与 WebUI）、`electron-builder.json5`、
      根目录 Vue / Vite / TS 配置与 `dist*` 产物全部移除；`package.json` 只剩新架构命令，
      根 workspace 依赖里不再有 electron / vue / electron-builder。
      CI 与发布流程同步改成「Go 核心 + Wails + Svelte」：`ci-linux/macos/windows.yml`
      只跑两层 Go 与前端，`release.yml` 只构建三个平台的 `DownVid-Wails-*`。
- [x] 删除文件根目录中没有作用的文件
      `build/`、`public/`、`index.html`、`postcss.config.js`、`vite.config.ts`、
      `tsconfig*.json`、`ldstore.ico`、`.dockerignore`、`docker-compose.yml` 已删除；
      根目录只剩 README / 协议 / CHANGELOG / package.json 与各目录。
      `.vercelignore` 同步成「只发布 website/」。
- [x] 与新架构不关联的测试脚本
      删除 `crosscheck-port`（TS ↔ Go 对拍，TS 侧已不存在）、`lint-ipc`、`lint-i18n`（旧词表）、
      `lint-docker`、`deps-asset`、`gen-update-manifests`、`gen-social-preview`、
      `build-backend.sh` 以及 7 个旧架构集成脚本；`tests/` 只保留 shared/ 与发布脚本的用例。
      其余校验脚本（图标 / 官网 / 文档 / 工作流 / 边界 / 署名 / 来源审计）改指向新架构路径。
