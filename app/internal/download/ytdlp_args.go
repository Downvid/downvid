// Package download 组装并执行 yt-dlp 下载。
//
// 本文件是 electron/download/ytdlp.ts 的 Go 移植，目前只包含**纯函数部分**
// （format selector 与参数组装）。它对应 24 个 vitest 用例，移植时逐条对照，
// 断言文字保持一致——这样「行为是否还是原来那个」可以直接看 diff。
//
// 为什么先移植这一块：参数组装是最容易被「顺手清理」改坏的地方，而改坏了
// 不会报错，只会让下载变慢或拿不到想要的格式。仓库里已有多个血泪注释
// （--http-chunk-size 让同一个文件从 109 秒降到 3 秒、--progress 必须与
// --progress-template 同时出现等），这些必须逐字保留。
package download

import (
	"fmt"
	"path/filepath"
	"strings"
)

// 进度输出前缀。与 electron/download/ytdlp.ts 的 PROGRESS_PREFIX / POSTPROCESS_PREFIX 一致，
// 前端按前缀分流：stdout 的 [dvp] 是下载进度，stderr 的 [dvpp] 是后处理进度。
const (
	ProgressPrefix    = "[dvp]"
	PostprocessPrefix = "[dvpp]"
	FilePrefix        = "[dvfile]"
	SubsPrefix        = "[dvsubs]"
)

// HTTPChunkSize 是 --http-chunk-size 的值。
//
// 这是下载速度的关键：YouTube 等站点的 CDN 会对长连接限速。同一个 17.6MB 文件实测
// 单连接 109 秒（0.16 MB/s），加上本参数后 3~5 秒（约 5 MB/s），快 30 倍以上。
// 原理是把一个长请求拆成多个短请求。
//
// 注意 --concurrent-fragments 解决不了这个问题：它只作用于 HLS/DASH 分片，
// 而那些站点给的往往是单个 mp4 直链，走的是单连接。
//
// 对不支持 Range 的服务器会自动退化为普通下载（已实测），因此不需要按站点开关。
const HTTPChunkSize = "10M"

// ProgressTemplate 与 PostprocessTemplate 交给 yt-dlp 的 --progress-template。
//
// 字段顺序与 electron 侧**必须逐字一致**：前端按 | 切分后按位置取值，
// 顺序变了会静默拿到错误数字（进度条乱跳），不会有任何报错。
const (
	ProgressTemplate = "download:" + ProgressPrefix +
		"%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|" +
		"%(progress.speed)s|%(progress.eta)s|%(progress.fragment_index)s|%(progress.fragment_count)s"
	PostprocessTemplate = "postprocess:" + PostprocessPrefix + "%(progress.postprocessor)s|%(progress.status)s"
)

// AudioTrack 是被选中的音轨（可能来自 YouTube 多音轨）。
type AudioTrack struct {
	FormatID string
	Language string
	IsM3U8   bool
}

// Options 是一次下载的参数。字段与 TS 侧 DownloadOptions 的对应子集保持一致，
// 命名差异只是为了符合 Go 习惯；**语义完全相同**。
type Options struct {
	TaskID string
	URL    string
	// FormatID 是用户选中的格式（yt-dlp 的 format_id）。
	FormatID string

	// DownloadMode 是 "video" / "audio" / "subtitle"。
	DownloadMode string

	HasAudio     bool
	AudioTrack   *AudioTrack
	Subtitles    []string
	Proxy        string
	FilenameTmpl string

	// Acceleration 对应 shared/acceleration.ts 的 AccelerationSettings。
	Acceleration *Acceleration
}

// Acceleration 是加速设置的最小形状（与 shared/acceleration.ts 对齐）。
//
// Enabled 用 *bool 而不是 bool：TS 侧语义是「只有显式 false 才关闭」
// （`enabled: raw.enabled !== false`）。Go 的 bool 零值是 false，
// 直接用会让「未设置」被误判成「关闭」——这正是交叉验证抓到的那个坑。
type Acceleration struct {
	Enabled        *bool
	MaxConnections int
}

// defaultMaxConnections 与 shared/acceleration.ts 的 normalizeAcceleration 默认值一致。
//
// 这是交叉验证抓出来的真实差异：TS 侧未配置 acceleration 时**默认开启且 8 连接**，
// 我第一版把 nil 当成「关闭」返回 1，导致同一份设置下 Go 与 TS 拼出不同的参数。
// 这类差异不会报错，只会让下载速度悄悄退回单连接。
const defaultMaxConnections = 8

// maxConnectionsLimit 是 normalizeAcceleration 的 clamp 上限（1..16）。
const maxConnectionsLimit = 16

func boolPtr(v bool) *bool { return &v }

// NormalizeAcceleration 复刻 shared/acceleration.ts 的 normalizeAcceleration。
//
// 规则（逐条对应 TS）：
//   - 非对象 / nil → 默认开启 + 8 连接
//   - enabled 只有显式 false 才算关闭（undefined 视为 true）
//   - maxConnections 非有限数 → 8；否则 clamp 到 [1, 16] 并取整
func NormalizeAcceleration(a *Acceleration) Acceleration {
	if a == nil || a.Enabled == nil {
		// 未设置 = 默认开启（TS: `enabled: raw.enabled !== false`）
		max := defaultMaxConnections
		if a != nil && a.MaxConnections > 0 {
			max = a.MaxConnections
			if max > maxConnectionsLimit {
				max = maxConnectionsLimit
			}
		}
		return Acceleration{Enabled: boolPtr(true), MaxConnections: max}
	}
	out := Acceleration{Enabled: a.Enabled, MaxConnections: a.MaxConnections}
	if out.MaxConnections <= 0 {
		out.MaxConnections = defaultMaxConnections
	}
	if out.MaxConnections > maxConnectionsLimit {
		out.MaxConnections = maxConnectionsLimit
	}
	return out
}

// AccelerationConnections 返回实际使用的连接数。
//
// 关闭加速时**恒为 1**：调用方据此判断是否启用 aria2（connections > 1 && aria2Path != ""）。
// 与 shared/acceleration.ts 的 accelerationConnections 一致。
func AccelerationConnections(a *Acceleration) int {
	n := NormalizeAcceleration(a)
	if n.Enabled == nil || !*n.Enabled {
		return 1
	}
	return n.MaxConnections
}

// JSRuntime 是 YouTube 需要的 JS 运行时。
//
// 必须有显式的 Kind：Electron 的可执行文件路径里没有 "node"，
// 靠 strings.Contains(path, "node") 会把它误标成 deno（实测会拉起一整个应用）。
type JSRuntime struct {
	Path string
	Kind string // "node" 或 "deno"
}

// BuildArgsContext 是组装参数时用到的外部状态。
//
// 依赖工具的路径与 JS 运行时都由调用方解析好再传进来：
// BuildArgs 保持纯函数，便于直接断言参数列表，不必真的起进程。
type BuildArgsContext struct {
	Aria2Path      string // 空字符串表示未发现 aria2
	FfmpegLocation string // 空字符串表示不需要（字幕模式或未解析到）
	JSRuntime      *JSRuntime
	// ExtractorArgs 是解析阶段额外使用的 extractor 参数（如 X/Twitter 回退到 syndication）
	ExtractorArgs []string
}

// BuildFormatSelector 组装 format selector。
//
// 已含音轨的格式直接下载；否则合并最佳音轨，找不到可合并的音轨时退回该格式本身
// （旧逻辑在无 m4a 音轨时会退化成 `bestaudio`，只下载到纯音频）。
func BuildFormatSelector(o Options) string {
	if o.DownloadMode == "audio" {
		return o.FormatID
	}
	if o.AudioTrack != nil && o.AudioTrack.IsM3U8 {
		return o.AudioTrack.FormatID
	}
	if o.HasAudio {
		return o.FormatID + "/bv*+ba/b"
	}
	audio := "bestaudio[ext=m4a]"
	if o.AudioTrack != nil && o.AudioTrack.Language != "" {
		audio = "bestaudio[language^=" + o.AudioTrack.Language + "]"
	}
	return o.FormatID + "+" + audio + "/" + o.FormatID + "+bestaudio/" + o.FormatID + "/bv*+ba/b"
}

// IsYouTube 判断是否 YouTube 链接。
//
// 与 TS 侧同样的宽松匹配：只认这两个域名片段，不解析 URL
// （yt-dlp 自己能处理各种变体，这里只用来决定是否加 JS 运行时）。
func IsYouTube(u string) bool {
	return strings.Contains(u, "youtube.com") || strings.Contains(u, "youtu.be")
}

// BuildArgs 组装 yt-dlp 参数。
//
// 单独导出是为了可测试：格式选择、字幕模式、音频转换的差异都只体现在这里，
// 而不必真的起一个进程去验证。
func BuildArgs(o Options, outputDir string, ctx BuildArgsContext) []string {
	isSubtitleOnly := o.DownloadMode == "subtitle"
	isAudioOnly := o.DownloadMode == "audio"
	isYoutube := IsYouTube(o.URL)

	connections := AccelerationConnections(o.Acceleration)

	userTemplate := o.FilenameTmpl
	if userTemplate == "" {
		userTemplate = "%(title)s"
	}
	completeTemplate := userTemplate
	if !strings.Contains(userTemplate, "%(ext)") {
		completeTemplate = userTemplate + ".%(ext)s"
	}

	// 启用 aria2 时输出模板不带目录：目录交给 --paths 分开指定（见下）。
	// 这是 aria2 稀疏片段隔离的一部分，改动会导致续传失败。
	useAria2 := !isSubtitleOnly && connections > 1 && ctx.Aria2Path != ""
	var outputTemplate string
	if useAria2 {
		outputTemplate = completeTemplate
	} else {
		outputTemplate = filepath.Join(outputDir, completeTemplate)
	}

	printSpec := "after_move:" + FilePrefix + "%(filepath)s"
	if isSubtitleOnly {
		// 字幕模式没有视频文件，改为输出字幕信息（语言代码可能含 '-'，不能直接写进字段路径）
		printSpec = "after_move:" + SubsPrefix + "%(requested_subtitles)j"
	}

	args := []string{
		"-o", outputTemplate, "--no-playlist", "--playlist-items", "1", "--encoding", "utf-8",
		// --print 隐含 --quiet，用 --progress 保留进度输出，最终路径由 after_move 精确给出
		"--newline", "--progress",
		"--progress-template", ProgressTemplate,
		"--progress-template", PostprocessTemplate,
		"--print", printSpec,
		// HLS/DASH 分片并发下载（仅对分片流生效，对单个 mp4 直链无效）
		"--concurrent-fragments", fmt.Sprint(connections),
		// 分块请求：规避"单连接被限速"。见 HTTPChunkSize 的说明。
		"--http-chunk-size", HTTPChunkSize,
	}

	// 传目录而不是文件路径：yt-dlp 会在该目录里同时找 ffmpeg 与 ffprobe
	if ctx.FfmpegLocation != "" {
		args = append(args, "--ffmpeg-location", ctx.FfmpegLocation)
	}

	if isSubtitleOnly {
		langs := "all"
		if len(o.Subtitles) > 0 {
			langs = strings.Join(o.Subtitles, ",")
		}
		args = append(args, "--skip-download", "--write-subs", "--sub-langs", langs, "--convert-subs", "srt")
	} else {
		args = append([]string{"-f", BuildFormatSelector(o)}, args...)
		if isAudioOnly {
			args = append(args, "-x", "--audio-format", "mp3", "--audio-quality", "0",
				// 写入 id3v1 标签：兼容旧播放器（实测部分车载/老播放器读不到 id3v2）
				"--postprocessor-args", "FFmpegMetadata:-write_id3v1 1")
		} else {
			args = append(args, "--merge-output-format", "mp4")
		}
		if len(o.Subtitles) > 0 {
			args = append(args, "--write-subs", "--sub-langs", strings.Join(o.Subtitles, ","), "--convert-subs", "srt")
		}
	}

	if o.Proxy != "" {
		args = append(args, "--proxy", o.Proxy)
	}

	if useAria2 {
		// 仅 HTTP 使用 aria2；直播/HLS/DASH 仍由 yt-dlp 处理鉴权、分片和合并。
		args = append(args,
			"--downloader", "http:"+ctx.Aria2Path,
			"--downloader", "dash,m3u8:native",
			"--downloader-args", fmt.Sprintf(
				"aria2c:--no-conf=true --max-connection-per-server=%d --split=%d --min-split-size=1M "+
					"--file-allocation=none --max-tries=3 --retry-wait=2 --connect-timeout=15 --timeout=30 "+
					"--auto-save-interval=1 --check-certificate=true --enable-color=false "+
					"--human-readable=false --truncate-console-readout=false --summary-interval=1",
				connections, connections),
		)
		// 隔离 aria2 稀疏片段；更换引擎时不能被原生顺序下载器误认为连续数据。
		args = append(args,
			"--paths", "home:"+outputDir,
			"--paths", "temp:"+filepath.Join(outputDir, ".downvid-aria2"))
	}

	if isYoutube && ctx.JSRuntime != nil {
		// 用显式的 kind 而不是从路径猜：Electron 的路径里没有 "node"，
		// 靠 strings.Contains 会把它误标成 deno（实测会拉起一整个应用）
		args = append(args, "--js-runtimes", ctx.JSRuntime.Kind+":"+ctx.JSRuntime.Path)
	}

	args = append(args, ctx.ExtractorArgs...)

	// **不拼 URL**：与 TS 的 buildYtdlpArgs 保持一致。
	// URL 由调用方在 spawn 时拼在 cookie 参数之后
	// （electron/download/ytdlp.ts: `spawn(ytdlpPath, [...args, ...cookieArgs, ...source])`）。
	// 拼在这里会让后续加 cookie 参数的调用方把 URL 放到错误位置——
	// yt-dlp 会把它当成又一个输入源，不报错但行为变了。
	return args
}
