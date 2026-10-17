package settings

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 设置层最重要的两组测试：
//   1. **字段兼容**：字段名/默认值必须与 TS 版一致，否则老用户设置静默失效
//   2. **不丢字段**：合并写入不能抹掉别的组件写的字段

// --- 默认值必须与 TS 的 DEFAULT_SETTINGS 逐字一致 ---

func TestDefaultsMatchTS(t *testing.T) {
	d := Defaults()

	// 这 13 个值都是从 src/stores/settings.ts 的 DEFAULT_SETTINGS 抄的。
	// 任何一项不一致，新用户的初始体验就与旧版不同。
	cases := map[string]struct{ got, want any }{
		"downloadDir":        {d.DownloadDir, ""},
		"filenameTemplate":   {d.FilenameTemplate, "%(title)s.%(ext)s"},
		"preferredQuality":   {d.PreferredQuality, "best"},
		"cookieMode":         {d.CookieMode, "auto"},
		"cookiesFile":        {d.CookiesFile, ""},
		"proxy":              {d.Proxy, ""},
		"autoCheckUpdate":    {d.AutoCheckUpdate, true},     // 默认开
		"autoDownloadUpdate": {d.AutoDownloadUpdate, false}, // 默认关
		"depMirror":          {d.DepMirror, "auto"},
		"updateSource":       {d.UpdateSource, "auto"},
		"language":           {d.Language, "auto"},
	}
	for name, c := range cases {
		if c.got != c.want {
			t.Errorf("%s 默认值 = %v，want %v（与 src/stores/settings.ts 不一致）", name, c.got, c.want)
		}
	}

	// acceleration 默认开启 8 连接（与 normalizeAcceleration 一致）
	if d.Acceleration.Enabled == nil || !*d.Acceleration.Enabled {
		t.Error("acceleration 默认应开启")
	}
	if d.Acceleration.MaxConnections != 8 {
		t.Errorf("acceleration 默认连接数 = %d，want 8", d.Acceleration.MaxConnections)
	}
	if len(d.DepPaths) != 0 {
		t.Errorf("depPaths 默认应为空，got %v", d.DepPaths)
	}
}

// 字段名必须与 TS 版一致：JSON 键名对不上会让老设置读不出来
func TestJSONFieldNamesMatchTS(t *testing.T) {
	data, err := json.Marshal(Defaults())
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}

	want := []string{
		"downloadDir", "filenameTemplate", "preferredQuality", "cookieMode",
		"cookiesFile", "proxy", "acceleration", "depPaths", "autoCheckUpdate",
		"autoDownloadUpdate", "depMirror", "updateSource", "language",
	}
	for _, k := range want {
		if _, ok := m[k]; !ok {
			t.Errorf("JSON 里缺字段 %q（与 AppSettings 不一致）", k)
		}
	}
	if len(m) != len(want) {
		t.Errorf("JSON 字段数 = %d，want %d —— 多了字段说明有人新增后忘了同步 TS 那边", len(m), len(want))
	}
}

// --- 清洗：非法值一律回退，绝不原样透传 ---

func TestNormalizeFallsBackOnInvalid(t *testing.T) {
	raw := Settings{
		FilenameTemplate: "   ",
		PreferredQuality: "",
		CookieMode:       "whatever",
		UpdateSource:     "github ",  // 尾部空格是最常见的「看起来对」的非法值
		DepMirror:        "jsdelivr", // 依赖源的合法值是 direct/ghproxy/ghfast/gitee
		Language:         "zh",       // 非法：必须是 auto/zh-CN/en-US
	}
	out := Normalize(raw)

	if out.FilenameTemplate != "%(title)s.%(ext)s" {
		t.Errorf("空模板应回退默认，got %q", out.FilenameTemplate)
	}
	if out.PreferredQuality != "best" {
		t.Errorf("got %q", out.PreferredQuality)
	}
	if out.CookieMode != "auto" {
		t.Errorf("got %q", out.CookieMode)
	}
	// 非法更新源回退 auto：回退成「一个源都不试」会让更新永久失灵
	if out.UpdateSource != "auto" {
		t.Errorf("非法更新源应回退 auto，got %q", out.UpdateSource)
	}
	if out.DepMirror != "auto" {
		t.Errorf("非法依赖源应回退 auto，got %q", out.DepMirror)
	}
	if out.Language != "auto" {
		t.Errorf("got %q", out.Language)
	}
}

// depPaths 清洗：只保留已知种类的非空字符串
func TestNormalizeDepPaths(t *testing.T) {
	out := normalizeDepPaths(map[string]string{
		"yt-dlp":  "  /usr/local/bin/yt-dlp  ", // 前后空格要去掉
		"ffmpeg":  "",                          // 空串丢弃
		"unknown": "/x",                        // 未知种类丢弃
		"aria2":   "/opt/aria2c",
	})
	if out["yt-dlp"] != "/usr/local/bin/yt-dlp" {
		t.Errorf("应去掉前后空格，got %q", out["yt-dlp"])
	}
	if _, ok := out["ffmpeg"]; ok {
		t.Error("空串应被丢弃")
	}
	if _, ok := out["unknown"]; ok {
		t.Error("未知种类应被丢弃")
	}
	if out["aria2"] != "/opt/aria2c" {
		t.Errorf("got %q", out["aria2"])
	}
}

// acceleration 清洗：未设置 = 开启；连接数 clamp 到 1..16
func TestNormalizeAcceleration(t *testing.T) {
	// 未设置 = 默认开启（TS: `enabled !== false`）
	got := normalizeAcceleration(Acceleration{})
	if got.Enabled == nil || !*got.Enabled {
		t.Error("未设置 enabled 时应默认开启")
	}
	if got.MaxConnections != 8 {
		t.Errorf("未设置连接数应为 8，got %d", got.MaxConnections)
	}

	// 显式关闭
	off := false
	got = normalizeAcceleration(Acceleration{Enabled: &off})
	if got.Enabled == nil || *got.Enabled {
		t.Error("显式 false 应保持关闭")
	}

	// clamp：手填 100 时给 16 比给 1 更符合意图
	got = normalizeAcceleration(Acceleration{MaxConnections: 100})
	if got.MaxConnections != 16 {
		t.Errorf("应 clamp 到 16，got %d", got.MaxConnections)
	}
	got = normalizeAcceleration(Acceleration{MaxConnections: -5})
	if got.MaxConnections != 8 {
		t.Errorf("负数应回退 8，got %d", got.MaxConnections)
	}
}

// --- 读写 ---

func TestLoadMissingReturnsDefaults(t *testing.T) {
	s := NewStore(filepath.Join(t.TempDir(), "nope.json"))
	got, err := s.Load()
	if err != nil {
		t.Fatalf("文件不存在不该报错（首次启动），got %v", err)
	}
	if got.Language != "auto" {
		t.Fatalf("应返回默认值，got %+v", got)
	}
	// 不该顺手创建文件：等用户真的改了才写
	if _, statErr := os.Stat(s.Path()); !os.IsNotExist(statErr) {
		t.Fatal("首次 Load 不该创建文件")
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(filepath.Join(dir, "settings.json"))

	next := Defaults()
	next.Proxy = "http://127.0.0.1:7890"
	next.Language = "en-US"
	next.DepPaths = map[string]string{"yt-dlp": "/x/yt-dlp"}
	if err := s.Save(next); err != nil {
		t.Fatal(err)
	}

	// 新实例读回（模拟重启）
	got, err := NewStore(filepath.Join(dir, "settings.json")).Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Proxy != next.Proxy || got.Language != next.Language {
		t.Fatalf("got %+v", got)
	}
	if got.DepPaths["yt-dlp"] != "/x/yt-dlp" {
		t.Fatalf("depPaths 丢了：%+v", got.DepPaths)
	}
}

// **最重要的用例**：合并写入不能抹掉别的字段。
//
// 历史事故：在设置面板点一次「保存」，`depPaths` 就没了
// （因为那次的 Settings 接口里没有这个字段）。
func TestUpdateDoesNotWipeOtherFields(t *testing.T) {
	dir := t.TempDir()
	s := NewStore(filepath.Join(dir, "settings.json"))

	// 先写入 depPaths（模拟 DepPanel 写的）
	if _, err := s.Update(func(st *Settings) {
		st.DepPaths = map[string]string{"yt-dlp": "/x/yt-dlp"}
	}); err != nil {
		t.Fatal(err)
	}

	// 再改代理（模拟 SettingsView 写的）——**不该碰 depPaths**
	if _, err := s.Update(func(st *Settings) {
		st.Proxy = "http://127.0.0.1:7890"
	}); err != nil {
		t.Fatal(err)
	}

	got, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Proxy != "http://127.0.0.1:7890" {
		t.Errorf("代理应被写入，got %q", got.Proxy)
	}
	if got.DepPaths["yt-dlp"] != "/x/yt-dlp" {
		t.Fatalf("depPaths 被抹掉了——这正是「点一次保存就丢手动路径」那个事故：%+v", got.DepPaths)
	}
}

// 损坏文件：报错 + 留备份，而不是静默回默认
func TestCorruptFileReported(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte(`{"language": "zh`), 0o644); err != nil {
		t.Fatal(err)
	}

	s := NewStore(path)
	got, err := s.Load()
	if err == nil {
		t.Fatal("损坏文件应报错——旧实现返回默认值，用户看到「设置全丢」却没有任何提示")
	}
	if !errors.Is(err, ErrCorrupt) {
		t.Fatalf("应返回 ErrCorrupt，got %v", err)
	}
	// 仍返回可用的默认值（不让调用方拿到零值）
	if got.Language != "auto" {
		t.Fatalf("应退回默认值，got %+v", got)
	}
	// 必须留备份：里面可能有用户手填的路径与代理
	backup, readErr := os.ReadFile(path + ".corrupt")
	if readErr != nil {
		t.Fatalf("应保留备份：%v", readErr)
	}
	if !strings.Contains(string(backup), "zh") {
		t.Fatal("备份内容应与原文件一致")
	}
}

// 写入必须原子：不能出现半截文件
func TestSaveIsAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	s := NewStore(path)

	if err := s.Save(Defaults()); err != nil {
		t.Fatal(err)
	}
	next := Defaults()
	next.Proxy = "http://x"
	if err := s.Save(next); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var parsed Settings
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("保存后必须是完整 JSON（半截文件会让用户设置全丢）：%v", err)
	}

	// 临时文件要清干净
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("临时文件未清理：%s", e.Name())
		}
	}
}

// 旧版本写的文件（缺字段）能读出来，缺的用默认值补齐
func TestLoadOldVersionFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	// 只有两个字段（模拟很早的版本）
	if err := os.WriteFile(path, []byte(`{"proxy":"http://old","language":"zh-CN"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := NewStore(path).Load()
	if err != nil {
		t.Fatal(err)
	}
	if got.Proxy != "http://old" {
		t.Errorf("已有字段应保留，got %q", got.Proxy)
	}
	if got.Language != "zh-CN" {
		t.Errorf("got %q", got.Language)
	}
	// 缺失的字段用默认值补齐——**这是「只增不删」的意义**
	if got.FilenameTemplate != "%(title)s.%(ext)s" {
		t.Errorf("缺失字段应补齐默认值，got %q", got.FilenameTemplate)
	}
	if got.Acceleration.Enabled == nil || !*got.Acceleration.Enabled {
		t.Error("缺失的 acceleration 应补齐为「开启」")
	}
}
