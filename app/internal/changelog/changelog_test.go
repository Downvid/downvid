package changelog

import (
	"strings"
	"testing"
)

const fixture = `# Changelog

本文件记录 DownVid 的所有版本更新。

## [Unreleased]

### 文档

- 新增架构治理文档
- 第二件事

## [1.4.0] - 2026-10-16

### 修复

- 修掉一个 bug
  它跨了两行
- 另一条

### 性能

- 解析从 11.1 秒降到 2.1 秒

## [1.3.9] - 2026-10-14

### 修复

- 旧版本的一条修复

## [1.3.10] - 2026-10-15

### 修复

- 版本号要按数字比，不能按字符串比
`

func TestParseSplitsVersions(t *testing.T) {
	entries := Parse(fixture)

	// 4 段：Unreleased + 3 个版本
	if len(entries) != 4 {
		t.Fatalf("解析出 %d 段，期望 4 段：%+v", len(entries), entries)
	}

	first := entries[0]
	if !first.Unreleased {
		t.Error("第一段应是 Unreleased")
	}
	if first.Version != "" {
		t.Errorf("Unreleased 的 Version 应为空串，实际 %q", first.Version)
	}

	v140 := entries[1]
	if v140.Version != "1.4.0" {
		t.Errorf("Version = %q，期望 1.4.0", v140.Version)
	}
	if v140.Date != "2026-10-16" {
		t.Errorf("Date = %q，期望 2026-10-16", v140.Date)
	}
	if len(v140.Sections) != 2 {
		t.Fatalf("1.4.0 应有 2 个小标题，实际 %d：%+v", len(v140.Sections), v140.Sections)
	}
	if v140.Sections[0].Title != "修复" {
		t.Errorf("第一个小标题 = %q，期望 修复", v140.Sections[0].Title)
	}
	// 跨行条目要接起来（CHANGELOG 里真实存在这种写法）
	if len(v140.Sections[0].Items) != 2 {
		t.Fatalf("修复段应有 2 条，实际 %d：%+v", len(v140.Sections[0].Items), v140.Sections[0].Items)
	}
	if !strings.Contains(v140.Sections[0].Items[0], "跨了两行") {
		t.Errorf("跨行条目没有接上：%q", v140.Sections[0].Items[0])
	}
}

func TestParseIgnoresPreamble(t *testing.T) {
	entries := Parse(fixture)
	// 文件头（`# Changelog` 与那句说明）不属于任何版本
	for _, e := range entries {
		if strings.Contains(e.Body, "# Changelog") {
			t.Fatalf("文件头被当成了版本正文：%q", e.Body)
		}
	}
}

// 版本号必须按**数字**比，不能按字符串比。
//
// 字符串比较下 `1.3.10 < 1.3.9`（因为 '1' < '9'），于是「历史版本」
// 列表会把新版本排在旧版本后面 —— 而这个错误在只有个位数版本号时
// 完全看不出来。
func TestCompareVersionsNumeric(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.4.0", "1.4.0", 0},
		{"1.4.0", "1.3.9", 1},
		{"1.3.10", "1.3.9", 1}, // 字符串比较会得出 -1
		{"1.10.0", "1.9.0", 1},
		{"2.0.0", "1.99.99", 1},
		{"1.4.0-rc1", "1.4.0", -1}, // 预发布低于正式版
		{"1.4.0", "1.4.0-rc1", 1},
		{"v1.4.0", "1.4.0", 0}, // v 前缀要归一化
	}
	for _, c := range cases {
		if got := CompareVersions(c.a, c.b); got != c.want {
			t.Errorf("CompareVersions(%q, %q) = %d，期望 %d", c.a, c.b, got, c.want)
		}
	}
}

// `v` 前缀与大小写不该影响查找：tag 带 v、package.json 不带。
func TestFindIgnoresVPrefix(t *testing.T) {
	entries := Parse(fixture)
	for _, query := range []string{"1.4.0", "v1.4.0", " v1.4.0 "} {
		e, ok := Find(entries, query)
		if !ok {
			t.Errorf("查 %q 没找到", query)
			continue
		}
		if e.Version != "1.4.0" {
			t.Errorf("查 %q 命中了 %q", query, e.Version)
		}
	}
	if _, ok := Find(entries, "9.9.9"); ok {
		t.Error("不存在的版本不该被找到")
	}
	// Unreleased 不该被当成某个版本命中
	if _, ok := Find(entries, "Unreleased"); ok {
		t.Error("Unreleased 不该被 Find 命中")
	}
}

// 历史列表必须从新到旧，且不含 Unreleased。
func TestHistorySortedDesc(t *testing.T) {
	entries := Parse(fixture)
	history := History(entries, "1.4.0")
	if len(history) != 3 {
		t.Fatalf("历史应有 3 条（不含 Unreleased），实际 %d", len(history))
	}
	if history[0].Version != "1.4.0" {
		t.Errorf("首条应是 1.4.0，实际 %q", history[0].Version)
	}
	// 1.3.10 必须排在 1.3.9 前面
	if history[1].Version != "1.3.10" || history[2].Version != "1.3.9" {
		t.Errorf("排序错了：%q, %q", history[1].Version, history[2].Version)
	}
	for _, e := range history {
		if e.Unreleased {
			t.Error("历史里不该出现 Unreleased")
		}
	}
}

// 内嵌的 CHANGELOG 必须能读出来，且至少包含一个版本。
//
// 这条是**构建配置的守门人**：`//go:embed CHANGELOG.md` 依赖仓库根部的
// 那份文件被拷到本包目录（见 scripts/sync-changelog.mjs）。漏了拷贝，
// 运行时会得到「更新日志为空」，而构建与类型检查都不会报错。
func TestEmbeddedLocalWorks(t *testing.T) {
	entries, err := Local()
	if err != nil {
		t.Fatalf("读不到内嵌 CHANGELOG：%v", err)
	}
	if len(entries) == 0 {
		t.Fatal("内嵌 CHANGELOG 解析出 0 个版本")
	}
	released := 0
	for _, e := range entries {
		if !e.Unreleased && e.Version != "" {
			released++
		}
	}
	if released == 0 {
		t.Fatal("内嵌 CHANGELOG 里一个已发布的版本都没有")
	}
}
