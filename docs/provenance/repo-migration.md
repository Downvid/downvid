# 仓库迁移手册：`yxxbc/downvid` → `Downvid/Downvid`

> **这份文档的唯一目的：让 9600+ 存量用户不丢更新。**
>
> 换仓库是本项目**唯一的 MAJOR 级操作**。做错的表现不是报错，而是那批用户
> 永远停在旧版本上、什么提示都收不到——而这是唯一一类「发新版也修不好」的故障
> （修好的代码要走的就是那条坏掉的通道）。

---

## 1. 先理解一件事：为什么「转移」和「新建」完全不同

**实测依据**（2026-10-17）：
`api.github.com/repos/Homebrew/homebrew` → **301** → `api.github.com/repositories/206084`；
release 资产下载跟随重定向后仍是 **200**。

GitHub 对**转移（Transfer）或改名**的仓库保留**永久 301 重定向**。这意味着：

| 做法 | 存量用户的 `app-update.yml`（烧死在 1.4.0 安装包里，指向 `yxxbc/downvid`） | 结果 |
| --- | --- | --- |
| ✅ **Transfer** 到 `Downvid/Downvid` | 301 → 新仓库 | **继续收到更新** |
| ❌ 在新组织下**新建**仓库，把旧仓库删掉 | 404 | **永久失联**，无法挽回 |

**所以：必须用 GitHub 的 Transfer 功能，不能用「新建 + 迁移代码 + 删旧仓库」。**

> 补充：即使 Transfer 生效，也**不要**把旧仓库改成一个只放 `latest.yml` 的空壳去「兼容」——
> 那会让两条发布路径并存，日后更难判断该往哪发。Transfer 的重定向已经够用。

---

## 2. 执行顺序（顺序错了就得回滚）

### 阶段 0：在旧仓库完成这次发布（**不要跳**）

```bash
# 1. 代码已在本仓库改完并通过全部校验
pnpm vue-tsc --noEmit && pnpm test
pnpm lint:ipc && pnpm lint:boundaries && pnpm sync:repo && pnpm audit:provenance

# 2. 用旧坐标发布一个版本（例如 1.5.0）
#    目的：这是最后一次从 yxxbc/downvid 发出更新。
#    1.4.0 的用户会通过这个版本升上来一次 —— 之后他们才可能拿到新坐标。
```

**为什么必须先发一版**：1.4.0 用户的 `app-update.yml` 指向旧仓库。如果在转移前不发版，
他们就只能等转移完成后靠 301 重定向去新仓库——能work，但**少了第一次验证**。
先发一版，可以确认「旧仓库这条链路仍然健康」再动手。

### 阶段 1：在 GitHub 上执行 Transfer

1. 旧仓库 `Settings → General → Danger Zone → Transfer ownership`
2. 目标：`Downvid/Downvid`
3. **确认目标组织里没有同名仓库**（有的话 Transfer 会失败，或覆盖）
4. Transfer 完成后，旧 URL 会 301；旧仓库的 stars / issues / releases **全部随之转移**

### 阶段 2：同步本地配置

```bash
# 预览（默认不写入）
node scripts/sync-repo-coords.mjs --target Downvid/Downvid

# 实际写入（实测会改 17 个文件、125 处）
node scripts/sync-repo-coords.mjs --target Downvid/Downvid --write
```

脚本覆盖的位置（每一处漏改都有后果）：

| 文件 | 为什么关键 |
| --- | --- |
| `shared/app.ts` | 坐标的唯一来源 |
| `electron-builder.json5` 的 `publish` | **打包时烧进 `app-update.yml`**，决定新用户去哪查更新 |
| `.github/workflows/release.yml` | 用 `GITHUB_TOKEN` 自动推断，**通常不需写坐标**（写死反而在改名后失配） |
| `.github/workflows/docker.yml` | GHCR 镜像坐标 |
| `scripts/gen-*.mjs` | 生成 Release 正文与更新清单时的硬编码 |
| `website/app.js` | 官网下载按钮运行时拼 API 地址 |
| `docker/docker-compose.yml` | 默认镜像坐标 |
| `tests/*.test.ts` | 快照，改了会红 |
| 两份 README + 若干 docs | 用户点进去的链接 |

### 阶段 3：验证（全部必须绿）

```bash
pnpm sync:repo            # 23 处镜像一致
pnpm lint:ipc             # IPC 三处同步 + 产物名 + 仓库坐标
pnpm lint:website         # 官网里的坐标与产物名模板
pnpm test                 # 334 个用例（含 about-contributors / update-sources 快照）
pnpm verify:release       # tag ↔ Release ↔ latest*.yml 对得上
```

**实测记录**：在临时副本上跑完整迁移后，`sync:repo`（23 处一致）、
`lint:ipc`（39 通道 / 6 事件 / 16 分组）、`lint:website` 全部通过。

### 阶段 4：发布验证（最关键的一步）

```bash
# 从新坐标发布 1.5.1（一个只改坐标的补丁版本）
# 然后验证两条链路都成立：
```

- [ ] **新装用户**：从 `Downvid/Downvid` 下载 1.5.0，能检查到 1.5.1
- [ ] **老用户（301 路径）**：装 1.4.0，能通过旧 URL 的 301 拿到 1.5.1 ← **这条必须真机验证**
- [ ] `curl -sIL https://github.com/yxxbc/downvid/releases/latest` 仍是 301
- [ ] `curl -sIL https://github.com/yxxbc/downvid/releases/latest/download/latest.yml` 能拿到文件
- [ ] GHCR 镜像 `docker pull ghcr.io/downvid/downvid:latest` 可用
- [ ] 官网下载按钮指向新仓库的产物

---

## 3. 这次迁移与 Wails 重构的关系

**不要同时做**。换仓库与换桌面壳都会动更新链，同时做的话出问题无法归因。

推荐顺序：

1. 先完成仓库迁移（本手册），发布一个仅改坐标的版本，验证 301 路径
2. 再推进 Wails 重构，**在同一个坐标上**发布
3. Wails 版本的产物名如果变化，按 `docs/release.md` 的产物命名契约处理——
   改名 = 老用户无法更新，属 MAJOR

> Wails 的自动更新机制与 `electron-updater` **不同**（后者读 `latest*.yml`）。
> 换壳之后必须重新设计更新链路，并保证旧版能升级到新版。这一条列在
> [decisions.md](./decisions.md) ADR-002 的「未验证风险」里。

---

## 4. 出问题时怎么办

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 老用户提示「已是最新」但明明发了新版 | 旧 URL 没有 301（用了新建仓库而非 Transfer） | **无法自动修复**，只能发公告让用户手动下载一次 |
| 新装用户收不到更新 | `electron-builder.json5` 的 `publish` 没改 | `pnpm sync:repo` 会报出来 |
| 官网下载按钮跳 404 | `website/app.js` 的 `REPO` 没改 | `pnpm lint:website` 会报 |
| CI 发布失败 | secrets / GHCR 坐标未同步 | 检查 `docker.yml` 与组织级 secrets |
| `verify:release` 失败 | 产物名或 `latest*.yml` 与坐标不匹配 | 见 `docs/release.md` 的产物命名契约 |

**唯一不可挽救的情况**：用「新建仓库 + 删旧仓库」替代 Transfer。
到那一步只能靠社区公告 + 用户手动下载，且永远丢失一批不活跃用户。
