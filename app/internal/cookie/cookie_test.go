package cookie

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestCookieStatusManual(t *testing.T) {
	dir := t.TempDir()
	mgr := NewManager(dir)

	manualFile := filepath.Join(dir, "cookies.txt")
	if err := os.WriteFile(manualFile, []byte("# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t0\ta\tb\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	st := mgr.GetCookieStatus(manualFile)
	if !st.Manual {
		t.Errorf("应识别 manual=true")
	}
	if !st.CookieReady {
		t.Errorf("应识别 CookieReady=true")
	}

	attempts := mgr.GetAttempts(manualFile, false)
	if len(attempts) != 2 || attempts[0].Label != "manual" || attempts[1].Label != "none" {
		t.Errorf("手动模式尝试列表异常: %+v", attempts)
	}
	if attempts[0].Args[0] != "--cookies" || attempts[0].Args[1] != manualFile {
		t.Errorf("手动模式参数错误: %v", attempts[0].Args)
	}
}

func TestCookieStatusSnapshotAndFreshness(t *testing.T) {
	dir := t.TempDir()
	mgr := NewManager(dir)

	snapPath := mgr.SnapshotPath()
	if err := os.MkdirAll(filepath.Dir(snapPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(snapPath, []byte("cookie-data"), 0o600); err != nil {
		t.Fatal(err)
	}

	st := mgr.GetCookieStatus("")
	if !st.HasSnapshot {
		t.Errorf("应检测到快照存在")
	}
	if !st.CookieReady {
		t.Errorf("有快照时应为 CookieReady")
	}

	// preferSnapshot=true 时应优先尝试快照
	attempts := mgr.GetAttempts("", true)
	if len(attempts) == 0 {
		t.Fatalf("应有尝试项")
	}
	if attempts[0].Label != "snapshot" {
		t.Errorf("preferSnapshot 时首项应为 snapshot, 实际: %s", attempts[0].Label)
	}
}

func TestIsCookieErrorPatterns(t *testing.T) {
	cases := []struct {
		stderr   string
		expected bool
	}{
		{"ERROR: could not find Chrome cookie database", true},
		{"ERROR: failed to decrypt cookies with DPAPI", true},
		{"ERROR: [Errno 1] Operation not permitted: '/Users/mac/Library/Cookies/Cookies.binarycookies'", true},
		{"ERROR: unable to open database file: database is locked", true},
		{"ERROR: sqlite3.DatabaseError: file is not a database", true},
		{"ERROR: permission denied while accessing cookie profile", true},
		{"ERROR: [youtube] Use --cookies-from-browser or --cookies for the authentication", false},
		{"WARNING: could not parse date", false},
		{"ERROR: Video unavailable", false},
	}

	for _, c := range cases {
		got := IsCookieError(c.stderr)
		if got != c.expected {
			t.Errorf("IsCookieError(%q) = %v, want %v", c.stderr, got, c.expected)
		}
	}
}

func TestBrowserSuccessAndFailureLifecycle(t *testing.T) {
	dir := t.TempDir()
	mgr := NewManager(dir)

	tmpFile := filepath.Join(dir, "exported.txt")
	if err := os.WriteFile(tmpFile, []byte("browser-cookie-content"), 0o600); err != nil {
		t.Fatal(err)
	}

	att := Attempt{
		Label:     "chrome",
		Args:      []string{"--cookies-from-browser", "chrome"},
		TempFile:  tmpFile,
		IsBrowser: true,
		Browser:   "chrome",
	}

	mgr.OnAttemptSuccess(att)

	st := mgr.GetCookieStatus("")
	if st.LastGoodBrowser != "chrome" {
		t.Errorf("LastGoodBrowser = %q, want chrome", st.LastGoodBrowser)
	}
	if !st.HasSnapshot {
		t.Errorf("成功导出后应生成快照")
	}

	// 测试失败冷却
	mgr.OnAttemptFailure(att, "ERROR: database is locked")
	mgr.mu.Lock()
	failTime, failed := mgr.failures["chrome"]
	mgr.mu.Unlock()

	if !failed || time.Since(failTime) > 10*time.Second {
		t.Errorf("失败后应记录冷却时间")
	}
}

func TestCookieFailureHint(t *testing.T) {
	hint := CookieFailureHint([]string{"chrome", "safari"})
	if hint == "" {
		t.Errorf("应生成失败提示")
	}
	// 提示里得说清是哪个浏览器失败了，否则用户不知道该去登录哪一个
	if !strings.Contains(strings.ToLower(hint), "chrome") {
		t.Errorf("提示应点名失败的浏览器，got %q", hint)
	}
}

// 扩展导出的 JSON 必须被转成 Netscape 再交给 yt-dlp。
//
// 变异点：yt-dlp 的 `--cookies` 只认 Netscape，喂 JSON 不报错但一条 cookie 都不带，
// 界面表现为「配了 cookie 还是解析不了」，无从排查。
func TestNormalizeCookieFileConvertsJSON(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "cookies.json")
	raw := `[{"domain":".douyin.com","hostOnly":false,"name":"ttwid","path":"/","secure":true,"expirationDate":1793010826,"value":"1%7Cabc"}]`
	if err := os.WriteFile(src, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}

	out, converted, err := NormalizeCookieFile(src, dir)
	if err != nil {
		t.Fatalf("转换失败：%v", err)
	}
	if !converted || out == src {
		t.Fatalf("JSON 应被转换成新文件，got %q converted=%v", out, converted)
	}
	body, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	line := strings.TrimSpace(strings.Split(strings.TrimSpace(string(body)), "\n")[1])
	fields := strings.Split(line, "\t")
	if len(fields) != 7 {
		t.Fatalf("Netscape 行应为 7 列，got %d：%q", len(fields), line)
	}
	if fields[0] != ".douyin.com" || fields[1] != "TRUE" || fields[5] != "ttwid" || fields[6] != "1%7Cabc" {
		t.Errorf("转换结果不对：%q", line)
	}
}

// Netscape 文件不该被改写（否则每次解析都多一份临时文件）。
func TestNormalizeCookieFileLeavesNetscapeAlone(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "cookies.txt")
	if err := os.WriteFile(src, []byte("# Netscape HTTP Cookie File\n.douyin.com\tTRUE\t/\tFALSE\t0\ta\tb\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	out, converted, err := NormalizeCookieFile(src, dir)
	if err != nil || converted || out != src {
		t.Fatalf("Netscape 输入应原样返回，got %q converted=%v err=%v", out, converted, err)
	}
}

// 浏览器探测必须看「有没有可读的 Cookie 数据库」，不能只看装没装。
//
// 变异点：本机 Chrome 装了、进程也在跑，但 profile 目录是空的，于是
// `--cookies-from-browser chrome` 报 could not find chrome cookies database，
// 用户看到的是「自动读取 Cookie 失败」，却看不出是浏览器根本没登录过。
func TestGetInstalledBrowsersRequiresCookieDB(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("该断言只针对 macOS 的 profile 路径")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)

	// 只建「浏览器已安装」的外壳，不放 Cookies 数据库
	profile := filepath.Join(home, "Library", "Application Support", "Google", "Chrome", "Default")
	if err := os.MkdirAll(profile, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, b := range GetInstalledBrowsers() {
		if b == "chrome" {
			t.Fatal("没有 Cookies 数据库时不该把 chrome 列为可用")
		}
	}

	// 放一份非空 Cookies 后才应出现
	if err := os.WriteFile(filepath.Join(profile, "Cookies"), []byte("SQLite format 3\x00"), 0o600); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, b := range GetInstalledBrowsers() {
		if b == "chrome" {
			found = true
		}
	}
	if !found {
		t.Fatal("有 Cookies 数据库时应把 chrome 列为可用")
	}
}
