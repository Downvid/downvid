// Package download —— aria2 进度解析。
//
// 本文件是 electron/download/aria2-progress.ts 的 Go 移植（原实现 8 行，3 条用例）。
//
// aria2 的输出格式由 `--human-readable=false --enable-color=false` 固定住，
// 但它会用**回车**刷新同一行而不是换行，所以解析必须容忍行首的 `\r`。
package download

import "regexp"

// aria2ProgressPattern 匹配固定字节单位的进度行。
//
// 例：`[#abc123 1000/4000(25%) CN:8 DL:2000 ETA:1s]`
// 数字后的 `B` 后缀是可选的——不同 aria2 版本会带或不带。
var aria2ProgressPattern = regexp.MustCompile(
	`\[#\w+\s+(\d+)B?/(\d+)B?\([\d.]+%\)\s+CN:\d+\s+DL:(\d+)B?[^\]]*\]`,
)

// Aria2Progress 是一次进度快照。
type Aria2Progress struct {
	Downloaded int64
	Total      int64
	Speed      int64
}

// maxSafeInt 对应 TS 的 `Number.isSafeInteger`（2^53-1）。
//
// 为什么要这道限制：aria2 的输出来自外部进程，一个被截断或错位的行可能解出
// 天文数字。JS 侧超过 2^53 会静默失真（1000/90071992547409999 这样的行会被
// 当成合法进度），Go 的 int64 能装下但意义同样错误。两边都拒绝才一致。
const maxSafeInt = int64(1)<<53 - 1

// ParseAria2Progress 从一行输出里解析进度。
//
// 返回 ok=false 表示「这行不是可用的进度」，调用方应当忽略它。
// 会被拒绝的四类输入（都有对应用例）：
//   - 普通日志行（`download completed`）
//   - 被截断的半行（没有结尾的 `]`）
//   - 已下载 > 总大小（aria2 在部分场景会输出 125%）
//   - 数值超出安全整数范围（被改坏或错位的行）
func ParseAria2Progress(line string) (Aria2Progress, bool) {
	m := aria2ProgressPattern.FindStringSubmatch(line)
	if m == nil {
		return Aria2Progress{}, false
	}

	// 解析失败（理论上不会发生，正则已限定数字）按「不是进度」处理，
	// 不要用 0 顶替——0 会被当成「刚开始下载」，把进度条打回起点。
	var downloaded, total, speed int64
	if !parseSafeInt(m[1], &downloaded) || !parseSafeInt(m[2], &total) || !parseSafeInt(m[3], &speed) {
		return Aria2Progress{}, false
	}
	if downloaded > total {
		return Aria2Progress{}, false
	}
	return Aria2Progress{Downloaded: downloaded, Total: total, Speed: speed}, true
}

// parseSafeInt 解析并校验范围。
func parseSafeInt(s string, out *int64) bool {
	var v int64
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return false
		}
		d := int64(ch - '0')
		// 溢出检查：v*10+d 超过安全整数就拒绝
		if v > (maxSafeInt-d)/10 {
			return false
		}
		v = v*10 + d
	}
	*out = v
	return true
}
