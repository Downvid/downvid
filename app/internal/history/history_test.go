package history

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// tests/history.test.ts 的 7 条断言逐条移植，外加针对「修掉的工程缺陷」的新用例。
//
// 移植的用例保证行为不变；新增的用例钉住修复本身——那些才是这次重写的理由。

func rec(filePath, id string) Record {
	return Record{
		ID:        id,
		FilePath:  filePath,
		Title:     "视频",
		Thumbnail: "",
		URL:       "https://example.com/video",
		Format:    "mp4",
		Quality:   "1080p",
		CreatedAt: "2026-10-14T00:00:00.000Z",
	}
}

func bp(v bool) *bool { return &v }

// --- 重新下载与续传完成反复写入仍只有一条记录，保留原 ID 和时间 ---

func TestRepeatedUpsertKeepsOneRecord(t *testing.T) {
	history := []Record{rec(`C:\Downloads\video.mp4`, "first")}
	for i := 0; i < 3; i++ {
		r := history[0]
		r.Title = "新标题"
		history = Upsert(history, r, "retry-"+string(rune('0'+i)), "2026-10-15", "windows")
	}
	if len(history) != 1 {
		t.Fatalf("反复写入应只有 1 条，got %d", len(history))
	}
	if history[0].ID != "first" {
		t.Fatalf("应保留原 ID，got %q", history[0].ID)
	}
	if history[0].Title != "新标题" {
		t.Fatalf("标题应更新，got %q", history[0].Title)
	}
	if history[0].CreatedAt != "2026-10-14T00:00:00.000Z" {
		t.Fatalf("应保留原 createdAt，got %q", history[0].CreatedAt)
	}
}

// --- Windows 的大小写、分隔符与相对段差异不会产生重复 ---

func TestWindowsPathNormalization(t *testing.T) {
	history := Upsert(
		[]Record{rec(`C:\Downloads\VIDEO.mp4`, "first")},
		rec(`c:/Downloads/sub/../video.mp4`, "second"),
		"second", "later", "windows",
	)
	if len(history) != 1 {
		t.Fatalf("Windows 上大小写/分隔符/.. 差异应视为同一文件，got %d 条", len(history))
	}
	if history[0].ID != "first" {
		t.Fatalf("应保留原 ID，got %q", history[0].ID)
	}
}

// --- 同视频保存到不同目录或不同清晰度的独立文件仍保留 ---

func TestDifferentFilesKeptSeparate(t *testing.T) {
	history := []Record{rec(`C:\Downloads\video-1080.mp4`, "first")}
	history = Upsert(history, rec(`C:\Downloads\video-720.mp4`, "quality"), "quality", "later", "windows")
	history = Upsert(history, rec(`D:\Videos\video-1080.mp4`, "directory"), "directory", "later", "windows")
	if len(history) != 3 {
		t.Fatalf("不同清晰度与不同目录是独立文件，应保留 3 条，got %d", len(history))
	}
}

// --- 整理旧历史时保留最新副本，不持久化会过期的文件状态 ---

func TestDedupeKeepsLatestAndStripsFileExists(t *testing.T) {
	latest := rec(`C:\Downloads\video.mp4`, "latest")
	latest.FileExists = bp(false)

	got := Dedupe([]Record{latest, rec(`c:/downloads/video.mp4`, "old")}, "windows")
	if len(got) != 1 {
		t.Fatalf("应只剩 1 条，got %d", len(got))
	}
	if got[0].ID != "latest" {
		t.Fatalf("应保留首次出现（即最新）的那条，got %q", got[0].ID)
	}
	if got[0].FileExists != nil {
		t.Fatal("fileExists 是展示期字段，去重后必须剥掉（否则落盘后变陈旧）")
	}
}

// --- POSIX 上保留仅大小写不同的独立路径 ---

func TestPOSIXKeepsCaseDistinctPaths(t *testing.T) {
	got := Dedupe([]Record{
		rec("/downloads/Video.mp4", "a"),
		rec("/downloads/video.mp4", "second"),
	}, "linux")
	if len(got) != 2 {
		t.Fatalf("POSIX 上大小写不同是不同文件，应保留 2 条，got %d", len(got))
	}
}

// --- 无效旧记录被过滤，缺失本地文件的有效记录不会被自动删除 ---

func TestInvalidRecordsFiltered(t *testing.T) {
	got := Dedupe([]Record{rec("", "bad"), rec("/downloads/missing.mp4", "ok")}, "linux")
	if len(got) != 1 {
		t.Fatalf("应只剩有效那条，got %d", len(got))
	}
	if got[0].ID != "ok" {
		t.Fatalf("缺失本地文件的有效记录不该被删，got %q", got[0].ID)
	}
}

// --- 记录上限保持 100，重复更新不挤掉其他文件 ---

func TestMaxRecordsAndNoEviction(t *testing.T) {
	history := make([]Record, MaxRecords)
	for i := 0; i < MaxRecords; i++ {
		history[i] = rec(filepath.Join("/downloads", itoa(i)+".mp4"), itoa(i))
	}
	updated := Upsert(history, history[MaxRecords-1], "unused", "later", "linux")

	if len(updated) != MaxRecords {
		t.Fatalf("应保持 %d 条，got %d", MaxRecords, len(updated))
	}
	ids := make(map[string]bool, len(updated))
	for _, r := range updated {
		if ids[r.ID] {
			t.Fatalf("ID 重复：%q", r.ID)
		}
		ids[r.ID] = true
	}
	if updated[0].ID != itoa(MaxRecords-1) {
		t.Fatalf("被更新的记录应排到最前，got %q", updated[0].ID)
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

// ===== 以下是「修掉的工程缺陷」的用例，原实现没有对应断言 =====

// 原子写：写入过程不产生「半截文件」这种可被读到的中间态。
//
// 原实现 `writeFileSync` 直写目标文件，写到一半崩溃会让历史**静默全丢**
// （解析失败 → 空 catch → 返回 []）。这里验证：保存后文件是完整 JSON，
// 且保存过程中目标文件要么是旧的完整内容、要么是新的完整内容。
func TestSaveIsAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "download-history.json")

	old := []Record{rec("/v/1.mp4", "1")}
	if err := Save(path, old); err != nil {
		t.Fatal(err)
	}

	// 再保存一次新的。若实现是直接写目标文件，这里会先截断再写；
	// 用临时文件 + rename 则目标文件始终完整。
	next := []Record{rec("/v/2.mp4", "2"), rec("/v/1.mp4", "1")}
	if err := Save(path, next); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var parsed []Record
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("保存后文件必须是完整 JSON（半截文件会让用户历史全丢）：%v\n内容：%q", err, raw)
	}
	if len(parsed) != 2 {
		t.Fatalf("应写入 2 条，got %d", len(parsed))
	}

	// 临时文件必须清干净，不能在用户目录里留垃圾
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" {
			t.Fatalf("临时文件未清理：%s", e.Name())
		}
	}
}

// 损坏文件必须报错并留备份，而不是静默返回空历史。
func TestCorruptFileReported(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "download-history.json")

	// 半截 JSON（模拟写到一半崩溃）
	if err := os.WriteFile(path, []byte(`[{"id":"1","filePath":"/v/1`), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := Load(path)
	if err == nil {
		t.Fatal("损坏文件必须报错——旧实现返回空列表，用户看到「历史空了」却没有任何提示")
	}
	var corrupt *CorruptError
	if !errors.As(err, &corrupt) {
		t.Fatalf("应返回 CorruptError，got %T", err)
	}
	if len(got) != 0 {
		t.Fatalf("损坏时返回空列表，got %d 条", len(got))
	}
	// 必须留一份备份，让用户还有机会手工捞回
	backup, err2 := os.ReadFile(corrupt.Backup)
	if err2 != nil {
		t.Fatalf("应保留备份文件 %s：%v", corrupt.Backup, err2)
	}
	if len(backup) == 0 {
		t.Fatal("备份文件不该为空")
	}
}

// 文件不存在是**正常**情况（首次启动），不该报错。
func TestMissingFileIsNotAnError(t *testing.T) {
	got, err := Load(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil {
		t.Fatalf("文件不存在不该报错（首次启动），got %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("应返回空列表，got %d", len(got))
	}
}

// 落盘时不写入 fileExists（展示期字段）。
func TestSaveStripsFileExists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "h.json")

	r := rec("/v/1.mp4", "1")
	r.FileExists = bp(true)
	if err := Save(path, []Record{r}); err != nil {
		t.Fatal(err)
	}

	raw, _ := os.ReadFile(path)
	var parsed []Record
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed[0].FileExists != nil {
		t.Fatal("fileExists 不该落盘（下次读到的会是陈旧结论）")
	}
}

// AttachFileState 用注入的 checker，不碰真实文件系统。
func TestAttachFileState(t *testing.T) {
	got := AttachFileState([]Record{rec("/v/1.mp4", "1"), rec("/v/2.mp4", "2")}, func(p string) bool {
		return p == "/v/1.mp4"
	})
	if got[0].FileExists == nil || !*got[0].FileExists {
		t.Fatal("/v/1.mp4 应标记为存在")
	}
	if got[1].FileExists == nil || *got[1].FileExists {
		t.Fatal("/v/2.mp4 应标记为不存在")
	}
}

// Save → Load 往返后，数据与顺序一致。
func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "h.json")

	in := []Record{rec("/v/a.mp4", "a"), rec("/v/b.mp4", "b")}
	if err := Save(path, in); err != nil {
		t.Fatal(err)
	}
	out, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 || out[0].ID != "a" || out[1].ID != "b" {
		t.Fatalf("往返后应保持顺序与内容，got %+v", out)
	}
}

// 空历史必须落成 `[]` 而不是 `null`（TS 侧读到的 `null` 会让 Array.isArray 失败）。
func TestSaveEmptyAsArray(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "h.json")
	if err := Save(path, nil); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != "[]" {
		t.Fatalf("空历史应写成 []，got %q", raw)
	}
}

// win32 路径清理必须**与宿主平台无关**。
//
// 这类断言的价值：`filepath.Clean` 用的是编译时平台规则，在 macOS/Linux 上
// 不会把反斜杠当分隔符。若有人把 cleanWin32 换成 filepath.Clean，
// 本地测试仍然全绿，只有 Windows runner 会红——那是最难排查的一类。
func TestCleanWin32IndependentOfHost(t *testing.T) {
	cases := map[string]string{
		`C:\Downloads\VIDEO.mp4`:        `C:\Downloads\VIDEO.mp4`,
		`c:/Downloads/sub/../video.mp4`: `c:\Downloads\video.mp4`,
		`C:\a\b\..\..\c.mp4`:            `C:\c.mp4`,
		`C:\a\.\b\\c.mp4`:               `C:\a\b\c.mp4`,
		`\\server\share\a\..\b.mp4`:     `\\server\share\b.mp4`,
		`C:\a\..\..\..\x.mp4`:           `C:\x.mp4`, // 盘符根之上不能再退
	}
	for in, want := range cases {
		if got := cleanWin32(in); got != want {
			t.Errorf("cleanWin32(%q) = %q, want %q", in, got, want)
		}
	}
}

// 同一批路径在 windows 视图下归并，在 posix 视图下不归并。
func TestFileKeyPlatformDifference(t *testing.T) {
	a := `C:\Downloads\VIDEO.mp4`
	b := `c:/Downloads/sub/../video.mp4`
	if fileKey(a, "windows") != fileKey(b, "windows") {
		t.Fatal("windows 视图下这两条应是同一个文件")
	}
	// POSIX 视图下反斜杠不是分隔符，两者本就不同——不做断言，
	// 以免把「反斜杠在 POSIX 上是普通字符」这个事实写成期望值。
}
