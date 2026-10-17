// Package changelog 解析仓库根部的 CHANGELOG.md。
//
// ## 为什么要读本地文件而不是调 GitHub API
//
// 「更新日志」有两类用法，数据来源不同：
//
//	看**当前版本**改了什么   → 本地 CHANGELOG 就有，且与这个二进制同源
//	看**新版本**改了什么     → 只能从 Release 拿（本地还没有那份记录）
//
// 早先两者混在一起：更新弹窗里的「更新内容」是一条 `t('update.note2')`
// 这类写死的文案，与真实发布内容无关。用户点开更新只看到三句占位话。
//
// 现在分成两条路：
//   - `Local()` 读内嵌的 CHANGELOG（离线可用、与版本严格对应）
//   - 更新弹窗里的新版本内容由 Release notes 提供（见 update 包）
//
// ## 格式约束
//
// 遵循 Keep a Changelog：
//
//	## [1.4.0] - 2026-10-16
//	### 修复
//	- ...
//
// 解析刻意宽松：只认 `## [版本]` 与 `### 小标题`，其余原样保留。
// 严格校验会让「CHANGELOG 多写一个空行」变成构建失败——那是文档，不是协议。
package changelog

import (
	"embed"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

//go:embed CHANGELOG.md
var files embed.FS

// Entry 是一个版本条目。
type Entry struct {
	// Version 是版本号（`1.4.0`）；Unreleased 段的 Version 为空串
	Version string `json:"version"`
	// Date 是发布日期（`2026-10-16`）；Unreleased 段为空
	Date string `json:"date"`
	// Unreleased 标记「尚未发布」的那一段
	Unreleased bool `json:"unreleased,omitempty"`
	// Sections 是按 `### 小标题` 切开的分组
	Sections []Section `json:"sections"`
	// Body 是该版本的完整 Markdown 正文（含小标题，不含版本标题行）
	Body string `json:"body"`
}

// Section 是一个小标题下的内容。
type Section struct {
	Title string `json:"title"`
	// Items 是去掉 `- ` 前缀后的条目（保留原始换行，因为一条内容可能跨多行）
	Items []string `json:"items"`
}

var (
	// `## [1.4.0] - 2026-10-16` / `## [Unreleased]`
	versionHeading = regexp.MustCompile(`^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$`)
	sectionHeading = regexp.MustCompile(`^###\s+(.+?)\s*$`)
)

// Parse 解析完整的 CHANGELOG 文本。
//
// 返回顺序与文件一致（最新在前）；`Unreleased` 排在最前且 Version 为空。
func Parse(text string) []Entry {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")

	var entries []Entry
	var current *Entry
	var bodyLines []string

	flush := func() {
		if current == nil {
			return
		}
		current.Body = strings.TrimSpace(strings.Join(bodyLines, "\n"))
		current.Sections = parseSections(current.Body)
		entries = append(entries, *current)
		current = nil
		bodyLines = nil
	}

	for _, line := range lines {
		if m := versionHeading.FindStringSubmatch(line); m != nil {
			flush()
			version := m[1]
			unreleased := strings.EqualFold(version, "Unreleased")
			current = &Entry{Date: m[2], Unreleased: unreleased}
			if !unreleased {
				current.Version = version
			}
			continue
		}
		if current != nil {
			bodyLines = append(bodyLines, line)
		}
	}
	flush()
	return entries
}

// parseSections 按 `### 小标题` 切开。
func parseSections(body string) []Section {
	if strings.TrimSpace(body) == "" {
		return nil
	}
	var sections []Section
	var current *Section

	for _, line := range strings.Split(body, "\n") {
		if m := sectionHeading.FindStringSubmatch(line); m != nil {
			if current != nil {
				sections = append(sections, *current)
			}
			current = &Section{Title: strings.TrimSpace(m[1])}
			continue
		}
		if current == nil {
			// 小标题之前的内容（比如一段引言）：放进一个无名分组
			current = &Section{}
		}
		if item := strings.TrimPrefix(line, "- "); item != line {
			current.Items = append(current.Items, strings.TrimSpace(item))
			continue
		}
		// 续行（多行条目 / 空行）：接到上一条后面
		if len(current.Items) > 0 && strings.TrimSpace(line) != "" {
			current.Items[len(current.Items)-1] += "\n" + strings.TrimSpace(line)
		}
	}
	if current != nil {
		sections = append(sections, *current)
	}
	return sections
}

// Local 返回内嵌的 CHANGELOG 全部条目。
//
// 内嵌而不是运行时读文件：打包后仓库根部的 CHANGELOG.md 不在产物里，
// 而「看这个版本改了什么」是离线也要能用的功能。
func Local() ([]Entry, error) {
	raw, err := files.ReadFile("CHANGELOG.md")
	if err != nil {
		// 内嵌文件缺失属于构建配置问题，说清楚而不是返回空列表
		return nil, fmt.Errorf("内嵌的 CHANGELOG 读不出来（构建时漏了 go:embed？）：%w", err)
	}
	return Parse(string(raw)), nil
}

// Find 按版本号查找条目（忽略大小写与 `v` 前缀）。
func Find(entries []Entry, version string) (Entry, bool) {
	want := normalizeVersion(version)
	for _, e := range entries {
		if e.Unreleased {
			continue
		}
		if normalizeVersion(e.Version) == want {
			return e, true
		}
	}
	return Entry{}, false
}

// CompareVersions 判断两个版本号的大小，返回 -1 / 0 / 1。
//
// 只支持数字点分段（`1.4.0`），预发布后缀按字典序比较且**低于**同号正式版
// （`1.4.0-rc1 < 1.4.0`），与 semver 一致。解析不出来时按字符串比较。
func CompareVersions(a, b string) int {
	pa, oka := parseNumeric(a)
	pb, okb := parseNumeric(b)
	if !oka || !okb {
		return strings.Compare(a, b)
	}
	for i := 0; i < len(pa.nums) || i < len(pb.nums); i++ {
		var x, y int
		if i < len(pa.nums) {
			x = pa.nums[i]
		}
		if i < len(pb.nums) {
			y = pb.nums[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	// 数字部分相同：有预发布后缀的小
	switch {
	case pa.pre == "" && pb.pre == "":
		return 0
	case pa.pre == "":
		return 1
	case pb.pre == "":
		return -1
	default:
		return strings.Compare(pa.pre, pb.pre)
	}
}

type numericVersion struct {
	nums []int
	pre  string
}

func parseNumeric(v string) (numericVersion, bool) {
	clean := normalizeVersion(v)
	if clean == "" {
		return numericVersion{}, false
	}
	main, pre, hasPre := strings.Cut(clean, "-")
	parts := strings.Split(main, ".")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		var n int
		if _, err := fmt.Sscanf(p, "%d", &n); err != nil {
			return numericVersion{}, false
		}
		nums = append(nums, n)
	}
	out := numericVersion{nums: nums}
	if hasPre {
		out.pre = pre
	}
	return out, true
}

// normalizeVersion 去掉前缀 `v` 与首尾空白。
//
// `v1.4.0` 与 `1.4.0` 在仓库里同时存在（tag 带 v，package.json 不带），
// 比较时若不归一化，「当前版本」永远匹配不上 CHANGELOG。
func normalizeVersion(v string) string {
	return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(v), "v"))
}

// History 返回「比 current 更早」的条目（用于「历史版本」列表）。
//
// 按版本号从新到旧排序；Unreleased 与解析不出数字的条目被跳过——
// 它们在「历史版本」里没有意义。
func History(entries []Entry, current string) []Entry {
	out := make([]Entry, 0, len(entries))
	for _, e := range entries {
		if e.Unreleased || e.Version == "" {
			continue
		}
		if _, ok := parseNumeric(e.Version); !ok {
			continue
		}
		out = append(out, e)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return CompareVersions(out[i].Version, out[j].Version) > 0
	})
	_ = current // 保留参数：将来若要「只显示当前版本之前的」，这里加过滤
	return out
}
