# app/ —— DownVid 的 Go 核心 + Wails 桌面壳

这个目录是重构后的**新实现**，与现有的 `electron/` + `src/` **并存**，验证通过后旧实现才会删除。

> 选型依据与实测数字见 [`docs/provenance/decisions.md`](../docs/provenance/decisions.md)。
> 迁移步骤见 [`docs/provenance/migration-plan.md`](../docs/provenance/migration-plan.md)。

## 为什么是 Go

- 与 `backend/` 的依赖边车同语言，将来合成一个二进制
- 交叉编译到 5 个平台（win32 / darwin ×2 / linux ×2）实测全部成功
- 桌面壳用 Wails v2：同机实测产物 **8.2 MB**，而 Electron 安装包 **128 MB**
- Linux 侧已实测可构建（webkit2gtk 4.0 与 4.1 两条路都通）

## 目录

```
app/
├── go.mod
└── internal/
    └── download/          yt-dlp 参数组装（首批移植，24 条用例 + 交叉验证）
```

## 移植纪律（比代码更重要）

1. **行为一致性先证明，再删旧实现。** 每移植一块，两边并存，用
   `pnpm crosscheck:port` 对同一批输入比对输出，逐字一致才算完成。
2. **用例逐条对照 TS 侧的 vitest 用例**，断言文字保持一致，失败时能直接对上。
3. **不「顺手清理」参数。** `--http-chunk-size` 让同一个文件从 109 秒降到 3 秒、
   `--progress` 必须与 `--progress-template` 同时出现——这些在 TS 注释里都写着原因，
   移植时逐字保留。

## 交叉验证抓到的两个真实差异（说明这套机制是必要的）

| 差异 | TS 行为 | Go 第一版 | 后果 |
| --- | --- | --- | --- |
| 未配置加速度时的连接数 | 默认 **8**（`enabled !== false`） | 当成关闭 → **1** | 下载悄悄退回单连接，无报错 |
| `BuildArgs` 是否含 URL | **不含**（调用方 spawn 时拼） | 拼在末尾 | 后续加 cookie 参数时位置错乱 |

两边的单测当时都是绿的。这类问题只有交叉验证能发现。

## 常用命令

```bash
cd app && go test ./...        # Go 侧单测
cd app && go vet ./... && gofmt -l .
pnpm crosscheck:port           # TS ↔ Go 逐字比对（移植期的核心守门）
```
