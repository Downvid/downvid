package parse

// YouTube 的有限回退策略。
//
// 本文件是 electron/parsers/youtube-retry.ts 的 Go 移植（17 行，3 条用例）。
//
// 策略本身很短，但它决定「YouTube 解析失败后还能不能救回来」：
// 允许的回退次数有限（最多 2 轮），且**按 yt-dlp 版本选兼容客户端**——
// 版本判断错了会让新版本分支永远不可达（曾真实发生过，见 docs 里那条记录）。
import "strings"

// RetryState 是回退状态。
type RetryState struct {
	// Manifests 表示已经放开过 HLS/DASH 流格式
	Manifests bool
	// Client 是已设置的 player_client（空表示还没设）
	Client string
}

// 两个兼容客户端组合。
//
// 2026.10.10 起因 yt-dlp 改了 YouTube 提取器，老的 web_safari 组合不再有效。
// 两组都带 `-tv_downgraded`：排除 tv 客户端，避免拿到分辨率被降级的流。
const (
	clientLegacy  = "web_safari,web_embedded,-tv_downgraded"
	clientCurrent = "default,web_embedded,-tv_downgraded"
)

// versionThreshold 是切换客户端组合的版本分界（yt-dlp 的日期版本号）。
const versionThreshold = "2026.10.10"

// NextYoutubeRetry 根据错误决定下一轮的回退状态。
//
// 返回 nil 表示「没有可用的回退」——调用方应当直接报错，而不是无限重试。
// 两种可回退的情况：
//   - format-unavailable 且还没放开 manifest → 放开 HLS/DASH
//   - page-reload 且还没设 client → 按版本选一个兼容客户端
func NextYoutubeRetry(stderr string, state RetryState, version string) *RetryState {
	kind := ClassifyParseError(stderr)

	if kind == KindFormatUnavailable && !state.Manifests {
		next := state
		next.Manifests = true
		return &next
	}

	if kind == KindPageReload && state.Client == "" {
		next := state
		if isCurrentVersion(version) {
			next.Client = clientCurrent
		} else {
			next.Client = clientLegacy
		}
		return &next
	}

	return nil
}

// isCurrentVersion 判断 yt-dlp 版本是否 >= 2026.10.10。
//
// 版本是日期形式（`2026.10.10.233141`），按**前 10 位字符串比较**即可：
// 定长日期字符串的字典序与数值序一致，不需要解析成时间。
// 版本号为空或格式不对时返回 false —— 走老客户端组合是更保守的选择
// （新组合在旧版本上可能反而失败）。
func isCurrentVersion(version string) bool {
	if len(version) < 10 {
		return false
	}
	// 必须是 `YYYY.MM.DD` 开头
	if !(isDigit(version[0]) && isDigit(version[1]) && isDigit(version[2]) && isDigit(version[3]) &&
		version[4] == '.' && isDigit(version[5]) && isDigit(version[6]) && version[7] == '.' &&
		isDigit(version[8]) && isDigit(version[9])) {
		return false
	}
	return version[:10] >= versionThreshold
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

// YoutubeExtractorArgs 把回退状态转成 yt-dlp 的 `--extractor-args`。
//
// 返回空切片（而不是带空值的参数）时调用方不该传这个参数——
// 传一个空的 `--extractor-args ”` 会让 yt-dlp 报参数错误。
func YoutubeExtractorArgs(state RetryState) []string {
	values := make([]string, 0, 2)
	if !state.Manifests {
		values = append(values, "skip=hls,dash")
	}
	if state.Client != "" {
		values = append(values, "player_client="+state.Client)
	}
	if len(values) == 0 {
		return nil
	}
	return []string{"--extractor-args", "youtube:" + strings.Join(values, ";")}
}
