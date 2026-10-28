// Package update 的更新源契约与版本比较。
//
// 实际的网络检查/下载由 wml.go（wmlUpdate）负责；这里只保留设置页与
// 迁移判定还需要的最小类型，避免再维护一份旧的降级链实现。
package update

import (
	"regexp"
	"strconv"
	"strings"
)

// SourceID 是用户可选的更新源。
type SourceID string

const (
	SourceAuto   SourceID = "auto"
	SourceGitHub SourceID = "github"
	SourceGitee  SourceID = "gitee"
	SourceCNB    SourceID = "cnb"
)

// SourceIDs 是用户可选的源（`auto` 排第一，是默认值）。
var SourceIDs = []SourceID{
	SourceAuto, SourceGitHub, SourceGitee, SourceCNB,
}

// AutoChain 是 `auto` 的降级顺序：GitHub → Gitee → CNB。
//
// Gitee / CNB 都是完整镜像（清单 + 资产），所以任一条都能独立完成
// 检查与下载。
var AutoChain = []SourceID{
	SourceGitHub, SourceGitee, SourceCNB,
}

// NormalizeSource 校验设置里的源 id。
//
// 旧版本可能存着 jsdelivr / ghproxy / website；这些值现在一律回退 `auto`，
// 而不是原样保留——否则界面显示一个不存在的源，用户永远收不到更新。
func NormalizeSource(value any) SourceID {
	s, ok := value.(string)
	if !ok {
		return SourceAuto
	}
	for _, id := range SourceIDs {
		if string(id) == s {
			return id
		}
	}
	return SourceAuto
}

// Release 是迁移判定需要的最小版本信息。
type Release struct {
	Version string   `json:"version"`
	Assets  []string `json:"assets,omitempty"`
}

var compareSplit = regexp.MustCompile(`[.-]`)

// CompareVersions 按「数字段逐个比较」判断 a 与 b 的先后，返回 -1 / 0 / 1。
func CompareVersions(a, b string) int {
	parse := func(v string) []int {
		v = strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V")
		parts := compareSplit.Split(v, -1)
		out := make([]int, len(parts))
		for i, p := range parts {
			n, _ := strconv.Atoi(p)
			out[i] = n
		}
		return out
	}
	pa, pb := parse(a), parse(b)
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		var x, y int
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		if x != y {
			return x - y
		}
	}
	return 0
}
