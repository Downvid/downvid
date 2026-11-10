package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	plugin "github.com/yxxbc/mygo-plugin"
)

// 库的英文错误必须翻成人话，且说清用户该做什么。
//
// 变异点：直接透传 err.Error() 时，用户看到的是
// 「示例解析器 needs this app 1.11.0 or later」——英文、还夹着插件名，
// 看不出该点哪里。
func TestHumanInstallErrorTranslates(t *testing.T) {
	got := humanInstallError(&plugin.NeedsNewerApp{Plugin: "示例解析器", Version: "99.0.0"})
	if strings.Contains(got, "needs this app") {
		t.Fatalf("不该把库的英文原文丢给用户：%q", got)
	}
	if !strings.Contains(got, "示例解析器") || !strings.Contains(got, "99.0.0") {
		t.Errorf("应说清是哪个插件、需要哪个版本：%q", got)
	}
	if !strings.Contains(got, "升级") {
		t.Errorf("应告诉用户下一步是升级应用：%q", got)
	}

	// 已安装要引导到「更新 / 卸载」，而不是一句英文
	got = humanInstallError(plugin.ErrInstalled)
	if strings.Contains(got, "already installed") {
		t.Errorf("不该透传英文：%q", got)
	}
	if !strings.Contains(got, "更新") {
		t.Errorf("应提示可以用「更新」：%q", got)
	}

	// 未知错误保留原文（便于排查），但要有中文前缀
	got = humanInstallError(errors.New("connection reset"))
	if !strings.Contains(got, "connection reset") || !strings.Contains(got, "安装失败") {
		t.Errorf("未知错误应保留原因并加前缀：%q", got)
	}
}

// 更新必须先清掉旧目录，否则宿主的 Install 返回 ErrInstalled。
//
// **必须调用真实的 UpdatePlugin**，不能自己 RemoveAll 再断言目录没了——
// 那样测的是测试自己，把 UpdatePlugin 改坏也照样绿（第一版就是这样写的，
// 变异验证当场发现它抓不住 bug）。
//
// 这里用一个指向不存在仓库的 id：它会在「找索引条目」这一步失败，
// 但那一步在清理之后——所以只要「旧目录被删掉」这个副作用发生了，
// 就说明清理逻辑真的在 UpdatePlugin 里。
func TestUpdateCleansOldDirBeforeInstalling(t *testing.T) {
	a := newTestApp(t)
	dir := a.pluginHostDir()
	if err := os.MkdirAll(filepath.Join(dir, "demo"), 0o755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(dir, "demo", "index.js")
	if err := os.WriteFile(marker, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}

	// 期望失败（索引里没有 demo），但清理必须已经发生
	_ = a.UpdatePlugin("demo")

	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Error("UpdatePlugin 没有清掉旧目录：宿主的 Install 会报「已安装」，用户永远更不了")
	}
}

// 更新不能碰 plugin-data/<id>：那是插件的登录态等数据。
func TestUpdateKeepsPluginData(t *testing.T) {
	a := newTestApp(t)
	plugins := filepath.Join(a.pluginHostDir(), "demo")
	data := filepath.Join(a.pluginDataDir(), "demo")
	if err := os.MkdirAll(plugins, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}

	_ = a.UpdatePlugin("demo")

	if _, err := os.Stat(data); err != nil {
		t.Error("插件数据目录不该被更新清掉：用户每次更新都要重新登录")
	}
}
