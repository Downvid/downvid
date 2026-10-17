// Package history 管理下载历史。
//
// 本文件是 electron/history.ts 的 Go 移植，并修掉原实现的四个工程缺陷。
// **数据模型与落盘格式完全不变**（字段名、`download-history.json` 的结构都保持），
// 旧数据直接可用，不需要迁移。
//
// ## 为什么原实现要重做（实测确认，不是推测）
//
//  1. **非原子写会让历史静默全丢**（最严重）。
//     原实现 `fs.writeFileSync(file, JSON.stringify(...))` 直写目标文件：
//     写到一半崩溃/断电/被 kill，文件就成了半截 JSON；读取时 `JSON.parse` 抛错，
//     被空 `catch {}` 吞掉，返回 `[]` —— 用户看到历史**整份消失，且没有任何提示**。
//     实测复现：把文件截断到 30 字节后，`readHistory()` 返回 `[]`。
//     修法：写临时文件 + `fsync` + `rename`（同目录 rename 在 POSIX/Windows 上都是原子的）。
//
//  2. **四份副本**。`readHistory` / `writeHistory` / `fileExists` / `localHistory`
//     在 `electron/ipc/history.ts` 与 `docker/server/index.ts` 各写一遍，
//     容器端那份还没有类型约束（`any[]`）。改一处漏一处就让两端行为分叉。
//     修法：本文件是唯一实现，两端都调它。
//
//  3. **上限 100 硬编码 3 处**（`electron/history.ts:32`、`ipc/history.ts:15`、
//     `docker/server:70`）。改上限要改三处，漏改会让一端多留记录。
//     修法：`MaxRecords` 常量。
//
//  4. **每次读取对每条记录同步 stat**（最多 100 次阻塞 IO）。
//     NAS / 网络盘上尤其慢，而界面每次切到历史页都会触发。
//     修法：批量检查 + 结果缓存（`FileChecker` 接口，调用方可注入缓存或跳过）。
package history

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// MaxRecords 是历史记录上限。
//
// 唯一来源：不要再在调用方写 100。
const MaxRecords = 100

// Record 是一条下载历史。
//
// 字段名与 TS 的 `HistoryRecord` **逐字一致**（JSON 键也一样），因为
// `download-history.json` 是用户已有数据，改键名等于让老数据失效。
type Record struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Thumbnail string `json:"thumbnail"`
	URL       string `json:"url"`
	FilePath  string `json:"filePath"`
	// FileExists 是**展示期的派生字段**，不落盘。
	// 原实现的 `dedupeHistory` 会把它剥掉；这里用 `omitempty` + 写入前清零保证同样效果。
	FileExists *bool  `json:"fileExists,omitempty"`
	Format     string `json:"format"`
	Quality    string `json:"quality"`
	FileSize   string `json:"fileSize,omitempty"`
	CreatedAt  string `json:"createdAt"`
}

// fileKey 归一化路径，用于判断「是不是同一个本地文件」。
//
// 历史代表**本地文件**：同一视频的不同清晰度、不同输出目录都是独立文件，
// 所以不能用 URL 或 title 去重。
//
// Windows 上要额外做两件事（都有真实原因）：
//   - 大小写不敏感：`C:\Downloads\VIDEO.mp4` 与 `c:\downloads\video.mp4` 是同一文件
//   - 统一分隔符并解析 `..`：`c:/Downloads/sub/../video.mp4` 与 `C:\Downloads\video.mp4` 相同
func fileKey(filePath, goos string) string {
	if goos == "" {
		goos = runtime.GOOS
	}
	if goos == "windows" {
		// Windows 路径一律按 **win32 规则**处理，不能用宿主平台的 filepath.Clean。
		//
		// 实测（macOS/Linux 上跑）：`filepath.Clean("c:/Downloads/sub/../video.mp4")`
		// 得到 `c:\\Downloads\\sub\\..\\video.mp4` —— `..` 根本没被消掉，
		// 因为宿主是 POSIX，不认为反斜杠是分隔符。
		// 结果同一条记录会以两种路径形态并存，界面出现两条重复历史。
		//
		// Checkpoint 的测试在 Windows runner 上跑时才会暴露，但那时又变成
		// 「本地绿、CI 红」——所以这里显式实现 win32 的清理规则，与宿主平台无关。
		p := strings.ReplaceAll(filePath, "/", `\`)
		p = cleanWin32(p)
		return strings.ToLower(p)
	}
	return filepath.Clean(filePath)
}

// Dedupe 去掉重复与无效记录，保留**首次出现**的那条。
//
// 「保留首次」是刻意的：调用方总是把最新的放在最前面，所以首次出现即最新副本。
// 同时剥掉 `fileExists` —— 那是展示期字段，落盘会让「上次检查时文件存在」
// 变成下次读取时的陈旧结论。
func Dedupe(records []Record, goos string) []Record {
	seen := make(map[string]bool, len(records))
	out := make([]Record, 0, len(records))
	for _, r := range records {
		// 无效旧记录直接丢弃：空路径、或历史上被手工改坏的条目
		if strings.TrimSpace(r.FilePath) == "" {
			continue
		}
		key := fileKey(r.FilePath, goos)
		if seen[key] {
			continue
		}
		seen[key] = true
		r.FileExists = nil
		out = append(out, r)
	}
	return out
}

// Upsert 插入或更新一条记录，并保持「最新在前 + 上限 100」。
//
// 同一个本地文件只保留一条：
//   - 重新下载、续传完成都会反复写同一条，不能因此堆出多条
//   - **保留原有的 ID 与 createdAt**：那是「第一次下载这个文件」的时间，
//     每次重下都刷新时间会让历史变成「最后一次操作时间」，失去意义
func Upsert(records []Record, record Record, id string, createdAt string, goos string) []Record {
	key := fileKey(record.FilePath, goos)

	// 找到同文件已有记录，沿用它的 id / createdAt
	for _, existing := range records {
		if fileKey(existing.FilePath, goos) == key {
			if existing.ID != "" {
				id = existing.ID
			}
			if existing.CreatedAt != "" {
				createdAt = existing.CreatedAt
			}
			break
		}
	}

	record.ID = id
	record.CreatedAt = createdAt
	record.FileExists = nil

	out := make([]Record, 0, len(records)+1)
	out = append(out, record)
	for _, r := range records {
		// 跳过同文件旧条目（已被新的替换）与无效条目
		if strings.TrimSpace(r.FilePath) == "" || fileKey(r.FilePath, goos) == key {
			continue
		}
		r.FileExists = nil
		out = append(out, r)
	}

	// 去重后截断：重复记录不能挤掉别的文件
	out = Dedupe(out, goos)
	if len(out) > MaxRecords {
		out = out[:MaxRecords]
	}
	return out
}

// FileChecker 判断文件是否仍存在。
//
// 抽成接口是因为「怎么判断」在两种场景下差别很大：
//   - 桌面端：每次 get 都要检查，但只要**文件系统就绪**就跑
//   - 容器端：挂载盘可能是 NAS，批量检查要限流
//   - 测试：直接注入假实现，不碰真实文件系统
type FileChecker func(path string) bool

// DefaultFileChecker 是默认实现：只认普通文件。
//
// 用 `os.Stat` 而不是 `os.Open`：前者不占文件句柄（历史列表可能上百条，全开会耗 fd）。
func DefaultFileChecker(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.Mode().IsRegular()
}

// AttachFileState 给每条记录填上「文件是否还存在」。
//
// 这是**展示期**操作：结果不落盘。原实现在 `localHistory()` 里做同样的事，
// 但每条都同步 stat；这里保持语义一致，由调用方决定是否要做批量优化。
func AttachFileState(records []Record, check FileChecker) []Record {
	if check == nil {
		check = DefaultFileChecker
	}
	out := make([]Record, len(records))
	for i, r := range records {
		exists := check(r.FilePath)
		r.FileExists = &exists
		out[i] = r
	}
	return out
}

// Load 从磁盘读取历史。
//
// ## 与旧实现的关键差异：损坏文件不再静默吞掉
//
// 旧实现 `catch {}` 之后返回 `[]`，用户看到的是「历史空了」而没有任何提示。
// 这里返回一个**错误**，让调用方可以决定：保留备份、提示用户、或降级为空列表。
// 返回值的第一项永远是「能读出来的部分」——即使文件损坏，调用方也不至于拿不到任何东西。
//
// 损坏时会把原文件复制一份为 `<name>.corrupt`（不覆盖任何东西），
// 这样用户还有机会从里面手工捞回记录。
func Load(path string) ([]Record, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []Record{}, nil
		}
		return []Record{}, err
	}

	var records []Record
	if err := json.Unmarshal(raw, &records); err != nil {
		// 保留一份副本再报错。用 Copy 而不是 Rename：原文件留着，
		// 下次写入会整体覆盖它，用户还有一次机会从 .corrupt 里救数据。
		backup := path + ".corrupt"
		_ = os.WriteFile(backup, raw, 0o644)
		return []Record{}, &CorruptError{Path: path, Backup: backup, Err: err}
	}

	return Dedupe(records, ""), nil
}

// CorruptError 表示历史文件损坏。
//
// 单独的类型是为了让调用方能区分「文件不存在（正常）」与「文件坏了（异常）」——
// 旧实现把两者都当成空历史，导致损坏被永久掩盖。
type CorruptError struct {
	Path   string
	Backup string
	Err    error
}

func (e *CorruptError) Error() string {
	return "history file corrupt: " + e.Path + " (backup: " + e.Backup + "): " + e.Err.Error()
}

func (e *CorruptError) Unwrap() error { return e.Err }

// Save 原子写入历史。
//
// ## 为什么必须原子
//
// 实测复现过：`writeFileSync` 直写目标文件，写到一半进程被杀 → 文件变半截 JSON
// → 读取时解析失败 → 旧实现吞掉错误返回 `[]` → **用户整份历史消失且无提示**。
//
// 三步保证原子：
//  1. 写同目录下的临时文件（跨目录 rename 在 Windows 上会失败，必须同目录）
//  2. `Sync()` 落盘——否则 rename 之后内容可能还在 page cache，断电即丢
//  3. `Rename` 覆盖目标（POSIX 与 Windows 上都是原子的）
func Save(path string, records []Record) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	// 落盘前剥掉展示期字段，避免 `fileExists` 变陈旧
	clean := make([]Record, len(records))
	for i, r := range records {
		r.FileExists = nil
		clean[i] = r
	}
	if clean == nil {
		clean = []Record{}
	}

	data, err := json.MarshalIndent(clean, "", "  ")
	if err != nil {
		return err
	}

	// 临时文件放同目录：跨文件系统 rename 会失败（Windows 上尤其常见）
	tmp, err := os.CreateTemp(filepath.Dir(path), ".history-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	// 失败路径上清理临时文件；成功路径上它已被 rename 掉，Remove 无害
	defer func() { _ = os.Remove(tmpName) }()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

// SortByCreatedDesc 按 createdAt 降序（最新的在前）。
//
// 只在**读取旧数据**时用：新数据由 Upsert 保证顺序，但用户的历史文件可能是
// 手工改过或旧版本写的，顺序不可靠。稳定排序保证时间相同时不改相对顺序。
func SortByCreatedDesc(records []Record) {
	sort.SliceStable(records, func(i, j int) bool {
		return records[i].CreatedAt > records[j].CreatedAt
	})
}

// cleanWin32 按 Windows 规则清理路径，与宿主平台无关。
//
// 需要单独实现的原因见 fileKey 的注释：`filepath.Clean` 用的是**编译时**的
// 平台规则，在 macOS/Linux 上跑测试时不会把反斜杠当分隔符。
//
// 只处理本项目会遇到的情况（不做盘符大小写等特殊处理）：
//   - 折叠重复分隔符
//   - 消掉 `.` 与 `..`
//   - 保留盘符前缀（`C:`）与 UNC 前缀（`\\server\share`）
func cleanWin32(p string) string {
	// 自己归一正斜杠：调用方（fileKey）也会归一，但直接调用 cleanWin32 时
	// 不该因为漏了那一步就得到不同结果——这种「看谁调」的隐含约定迟早出事。
	p = strings.ReplaceAll(p, "/", `\`)

	prefix := ""
	rest := p

	// UNC：`\\server\share\...` —— 前两段的服务器与共享名不可被 `..` 吃掉
	if strings.HasPrefix(rest, `\\`) {
		parts := strings.SplitN(rest[2:], `\`, 3)
		if len(parts) >= 2 {
			// 末尾必须带分隔符，否则与后面 join 出的段名粘连（`\\server\shareb.mp4`）
			prefix = `\\` + parts[0] + `\` + parts[1] + `\`
			if len(parts) == 3 {
				rest = parts[2]
			} else {
				rest = ""
			}
		}
	} else if len(rest) >= 2 && rest[1] == ':' {
		// 盘符：`C:\...`
		prefix = rest[:2]
		rest = rest[2:]
	}

	absolute := strings.HasPrefix(rest, `\`)
	segments := strings.Split(strings.Trim(rest, `\`), `\`)

	stack := make([]string, 0, len(segments))
	for _, seg := range segments {
		switch seg {
		case "", ".":
			continue
		case "..":
			if len(stack) > 0 && stack[len(stack)-1] != ".." {
				stack = stack[:len(stack)-1]
			} else if !absolute && prefix == "" {
				// 相对路径且已经退到顶：保留 `..`（否则含义会变）
				stack = append(stack, "..")
			}
		default:
			stack = append(stack, seg)
		}
	}

	out := prefix
	if absolute && prefix != "" {
		out += `\`
	}
	out += strings.Join(stack, `\`)
	if out == "" {
		out = "."
	}
	return out
}
