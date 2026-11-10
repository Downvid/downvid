package pluginhost

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writePlugin 在 dir 下造一个插件目录。
func writePlugin(t *testing.T, root, name, manifest, module string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if manifest != "" {
		if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(manifest), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if module != "" {
		if err := os.WriteFile(filepath.Join(dir, "index.js"), []byte(module), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func manifestJSON(playback string) string {
	return `{"id":"demo","name":"Demo","version":"1.0.0","main":"index.js","playback":"` + playback + `"}`
}

// 目录不存在时不该报错：绝大多数用户不会装插件，启动路径必须无感。
func TestNewToleratesMissingDir(t *testing.T) {
	h := New(HostOptions{Dir: filepath.Join(t.TempDir(), "nope"), DataDir: t.TempDir()})
	if h.HasPlugins() {
		t.Error("目录不存在时不该有插件")
	}
	// **必须断言没有记录错误**：只断言「没有插件」拦不住变异——
	// 把「目录不存在」当错误上报时，界面会在每次启动时弹一条
	// 「插件加载失败」，而用户根本没装过插件。
	if errs := h.Errors(); len(errs) != 0 {
		t.Errorf("目录不存在不是错误，不该记录：%v", errs)
	}
	if _, _, err := h.Resolve(context.Background(), "https://example.com/v/1"); err != ErrNoPluginMatched {
		t.Errorf("应返回 ErrNoPluginMatched，got %v", err)
	}
}

// 声明了别的 playback 的插件必须被拒绝加载。
//
// 变异点：若不校验 playback，MyGo Music 的音源插件也会被当成解析插件加载，
// 它的 resolve 语义完全不同，表现为「插件装了但结果全错」——比不加载更难排查。
func TestRejectsForeignPlayback(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "music", manifestJSON("stream"), "export function resolve(){return null}")

	h := New(HostOptions{Dir: root, DataDir: t.TempDir()})
	if h.HasPlugins() {
		t.Fatal("playback=stream 的插件不该被当作解析插件")
	}
	errs := h.Errors()
	if len(errs) != 1 {
		t.Fatalf("应记录 1 条加载失败，got %v", errs)
	}
	var msg string
	for _, e := range errs {
		msg = e
	}
	if !strings.Contains(msg, "not") && !strings.Contains(msg, "不是") {
		t.Errorf("失败原因应说明契约不匹配，got %q", msg)
	}
}

// 加载失败的原因里不能出现用户的绝对路径。
//
// 这条字符串会显示在设置页，用户截图提 Issue 时不会想到先遮挡用户名。
func TestErrorReasonHidesPaths(t *testing.T) {
	root := t.TempDir()
	// manifest 写坏，触发 ReadManifest 报错（错误里带绝对路径）
	writePlugin(t, root, "broken", "{ not json", "")
	h := New(HostOptions{Dir: root, DataDir: t.TempDir()})
	errs := h.Errors()
	if len(errs) != 1 {
		t.Fatalf("应有 1 条错误，got %v", errs)
	}
	for _, msg := range errs {
		if strings.Contains(msg, root) {
			t.Errorf("错误里出现了绝对路径：%q", msg)
		}
		if strings.Contains(msg, os.TempDir()) {
			t.Errorf("错误里出现了临时目录：%q", msg)
		}
	}
}

// 只支持 B 站的插件遇到抖音链接要返回 null（不认领），而不是抛错。
//
// 这是协议的核心约定：没有 match 函数，全靠「返回 null = 我不认识」。
func TestResolveSkipsNonMatchingPlugin(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "bili", manifestJSON(Contract), `
export function resolve(url) {
  if (!url.includes("bilibili.com")) return null
  return { id: "1", title: "t", formats: [{ formatId: "f", quality: "720P", ext: "mp4" }] }
}`)

	h := New(HostOptions{Dir: root, DataDir: t.TempDir()})
	if !h.HasPlugins() {
		t.Fatalf("插件应加载成功，errors=%v", h.Errors())
	}
	_, _, err := h.Resolve(context.Background(), "https://www.douyin.com/video/1")
	if err != ErrNoPluginMatched {
		t.Fatalf("不认领应返回 ErrNoPluginMatched，got %v", err)
	}
}

// 认领时要把结果原样带回来，并告诉调用方是哪个插件给的。
func TestResolveReturnsResultAndPluginID(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "bili", manifestJSON(Contract), `
export function resolve(url) {
  return {
    id: "BV1", title: "测试视频", uploader: "up",
    duration: 12.5, thumbnail: "https://i0.hdslb.com/x.jpg",
    formats: [{ formatId: "80", quality: "1080P", ext: "mp4", filesize: 100, width: 1920, height: 1080, fps: 60, hasAudio: true }],
    directUrl: "https://cdn.example.com/v.mp4"
  }
}`)

	h := New(HostOptions{Dir: root, DataDir: t.TempDir()})
	got, id, err := h.Resolve(context.Background(), "https://www.bilibili.com/video/BV1")
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if id != "bili" {
		t.Errorf("应报告来源插件 id，got %q", id)
	}
	if got.Title != "测试视频" || got.Uploader != "up" || got.Duration != 12.5 {
		t.Errorf("元数据丢失：%+v", got)
	}
	if len(got.Formats) != 1 || got.Formats[0].Quality != "1080P" || got.Formats[0].FPS != 60 {
		t.Errorf("格式丢失：%+v", got.Formats)
	}
	if got.DirectURL != "https://cdn.example.com/v.mp4" {
		t.Errorf("直链丢失：%q", got.DirectURL)
	}
}

// 插件返回残缺数据必须报错，不能把空结果当成成功。
//
// 变异点：不校验时，缺 title 会让界面标题空白；formats 为空会让下载按钮
// 无格式可选；最危险的是直链不是 http(s)——下载器会照着它去请求。
func TestValidateRejectsBadResults(t *testing.T) {
	cases := map[string]string{
		"缺标题":       `return { formats: [{formatId:"f"}] }`,
		"无格式":       `return { title: "t" }`,
		"坏直链":       `return { title: "t", formats: [{formatId:"f"}], directUrl: "javascript:alert(1)" }`,
		"空formatId": `return { title: "t", formats: [{quality:"720P"}] }`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			writePlugin(t, root, "bad", manifestJSON(Contract), "export function resolve(url){"+body+"}")
			h := New(HostOptions{Dir: root, DataDir: t.TempDir()})
			if _, _, err := h.Resolve(context.Background(), "https://x/1"); err == nil {
				t.Fatalf("残缺结果应报错，但通过了")
			} else if err == ErrNoPluginMatched {
				t.Fatalf("这是插件出错，不该报成「没有插件认领」")
			}
		})
	}
}

// 一个插件抛错不能连累其他插件。
//
// 变异点：不 recover 单个插件的异常时，用户装了一个坏插件，
// 所有站点都会解析失败。
func TestBrokenPluginDoesNotBlockOthers(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "aaa-broken", manifestJSON(Contract), `
export function resolve(url) { throw new Error("boom") }`)
	writePlugin(t, root, "zzz-good", manifestJSON(Contract), `
export function resolve(url) {
  return { id: "1", title: "good", formats: [{formatId:"f", quality:"720P"}] }
}`)

	h := New(HostOptions{Dir: root, DataDir: t.TempDir()})
	got, id, err := h.Resolve(context.Background(), "https://example.com/v")
	if err != nil {
		t.Fatalf("好插件应仍能工作，got err=%v", err)
	}
	if id != "zzz-good" || got.Title != "good" {
		t.Errorf("应由 zzz-good 提供结果，got id=%q title=%q", id, got.Title)
	}
}

// 没有插件时 Resolve 必须快速返回 ErrNoPluginMatched，
// 让调用方继续走 yt-dlp，而不是报错给用户。
func TestNoPluginsIsNotAnError(t *testing.T) {
	h := New(HostOptions{Dir: t.TempDir(), DataDir: t.TempDir()})
	got, id, err := h.Resolve(context.Background(), "https://example.com/v")
	if err != ErrNoPluginMatched || got != nil || id != "" {
		t.Fatalf("got (%v,%q,%v)", got, id, err)
	}
}
