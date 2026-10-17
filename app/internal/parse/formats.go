// Package parse 把 yt-dlp 的 info JSON 转成界面可选的格式列表。
//
// 本文件是 electron/parsers/formats.ts 的 Go 移植。它是纯函数，对应 16 个 vitest 用例。
//
// 为什么不提供 vcodec 也要保留：X/Twitter 等站点的 mp4 直链格式不带编解码信息
// （vcodec 为空），早期按「必须有 vcodec」过滤后格式列表直接为空，用户无从选择。
package parse

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Format 是界面上的一个可选项。
//
// 字段名与 TS 侧 result 的键**逐字一致**（formatId / quality / ext / ...），
// 因为前端直接读这些键。改名不会有类型错误，只会让界面显示空白。
type Format struct {
	FormatID string `json:"formatId"`
	Quality  string `json:"quality"`
	Ext      string `json:"ext"`
	Filesize int64  `json:"filesize"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	FPS      int    `json:"fps"`
	HasAudio bool   `json:"hasAudio"`

	// 内部排序用，输出前去掉
	tbr       float64
	codecRank int
}

// FmtInfo 是 info JSON 里本函数用到的字段子集。
type FmtInfo struct {
	Formats  []RawFormat `json:"formats"`
	Duration float64     `json:"duration"`
	Ext      string      `json:"ext"`
	Filesize int64       `json:"filesize"`
	Width    int         `json:"width"`
	Height   int         `json:"height"`
	FPS      float64     `json:"fps"`
	URL      string      `json:"url"`
}

// RawFormat 是 info.formats 的单项。
//
// Acodec 用 *string 而不是 string：TS 侧靠 `acodec == null` 判断「字段缺失」，
// 缺失时视为音视频一体（渐进式 mp4 通常如此），而把字符串置为 "none" 才表示无音轨。
// 用 string 会丢掉「缺失」与「none」的区别，导致所有无 acodec 的格式都被当成有音轨。
type RawFormat struct {
	FormatID    string  `json:"format_id"`
	URL         string  `json:"url"`
	Vcodec      string  `json:"vcodec"`
	Acodec      *string `json:"acodec"`
	Height      int     `json:"height"`
	Width       int     `json:"width"`
	FPS         float64 `json:"fps"`
	Ext         string  `json:"ext"`
	VideoExt    string  `json:"video_ext"`
	Protocol    string  `json:"protocol"`
	Filesize    int64   `json:"filesize"`
	FilesizeApp int64   `json:"filesize_approx"`
	Tbr         float64 `json:"tbr"`
	Vbr         float64 `json:"vbr"`
	Abr         float64 `json:"abr"`
	QualityLbl  string  `json:"quality_label"`
	FormatNote  string  `json:"format_note"`
}

// commonFps 是归一化目标档位。
var commonFps = []int{24, 25, 30, 48, 50, 60, 120, 144}

// NormalizeFPS 把浮点帧率归到常见档位。
//
// 为什么必须归一化（真实 bug）：bilibili 同一清晰度会给三种编码（HEVC/AV1/AVC），
// 而 fps 是浮点——29.969 与 29.97 其实是同一个 30fps 档位，但两个数字不相等。
// 去重键带上原始 fps 时它们成了两个键，界面于是显示**两个 1080P**。
//
// 用「取整到常见档位」而不是简单四舍五入：23.976→24、29.97→30、59.94→60，
// 既保留「30fps 与 60fps 是两个不同选项」的能力，又不会因小数点抖动而分裂。
func NormalizeFPS(fps float64) int {
	if fps <= 0 {
		return 0
	}
	for _, target := range commonFps {
		// 容差 1：29.969 与 30 差 0.031，59.94 与 60 差 0.06
		if math.Abs(fps-float64(target)) <= 1 {
			return target
		}
	}
	return int(math.Round(fps))
}

// codecRank 是编码兼容性排序：越小越优先。
//
// 同一清晰度只能留一个时，选**兼容性最好**的而不是码率最高的：
//   - AVC (h264)：所有播放器、所有硬件都能解
//   - HEVC (h265)：省带宽，但老设备/浏览器可能不支持
//   - AV1：更省带宽，但支持面最窄
//
// 之前按码率排序取第一个，而 bilibili 上 AVC 恰好码率最高（3252 vs 2070），
// 结果「碰巧」是对的——那是运气不是规则。换个站点（AV1 码率更低但更不兼容）
// 就会把最不兼容的编码推给用户。
func codecRank(vcodec string) int {
	c := strings.ToLower(vcodec)
	switch {
	case strings.HasPrefix(c, "avc"), strings.HasPrefix(c, "h264"):
		return 0
	case strings.HasPrefix(c, "hev"), strings.HasPrefix(c, "hvc"), strings.HasPrefix(c, "h265"):
		return 1
	case strings.HasPrefix(c, "av01"), strings.HasPrefix(c, "av1"):
		return 2
	case strings.HasPrefix(c, "vp9"), strings.HasPrefix(c, "vp09"):
		return 3
	case strings.HasPrefix(c, "vp8"):
		return 4
	default:
		return 5
	}
}

var (
	reWxH     = regexp.MustCompile(`^\d{3,4}x\d{3,4}$`)
	reDigits  = regexp.MustCompile(`^\d+$`)
	reHeightP = regexp.MustCompile(`(?i)(\d{3,4})\s*p`)
	reFpsP    = regexp.MustCompile(`(?i)(\d{3,4})\s*p[_\s]*(\d+)\s*(?:fps)?`)
)

// resolutionLabel 把高度与帧率转成人看的标签。
func resolutionLabel(height int, fps float64) string {
	var label string
	switch {
	case height >= 2160:
		label = "4K"
	case height >= 1440:
		label = "2K"
	case height >= 1080:
		label = "1080P"
	case height >= 720:
		label = "720P"
	case height >= 480:
		label = "480P"
	case height >= 360:
		label = "360P"
	case height >= 240:
		label = "240P"
	default:
		label = fmt.Sprintf("%dP", height)
	}
	if fps > 30 {
		// 必须保留原始浮点（33.7 而不是 33）：quality 是**给人看的标签**，
		// 而 TS 侧 `getResolutionLabel` 直接拼原值。取整会让两边标签不一致——
		// 界面显示的 fps 与后端记录的对不上，交叉验证抓到了这一处。
		label += fmt.Sprintf(" %vfps", fps)
	}
	return label
}

// cleanQualityLabel 清洗站点自报的 quality_label / format_note。
//
// 只接受能解析出「高度 P」形态的文案；纯数字、纯 WxH 一律丢弃——
// 它们对用户没有意义，而且会让同一清晰度出现两种写法。
func cleanQualityLabel(raw string) string {
	if raw == "" {
		return ""
	}
	s := strings.TrimSpace(raw)
	if reWxH.MatchString(s) || reDigits.MatchString(s) {
		return ""
	}
	hm := reHeightP.FindStringSubmatch(s)
	if hm == nil {
		return ""
	}
	h, _ := strconv.Atoi(hm[1])
	var fps int
	if fm := reFpsP.FindStringSubmatch(s); fm != nil {
		fps, _ = strconv.Atoi(fm[2])
	}
	var label string
	switch {
	case h >= 2160:
		label = "4K"
	case h >= 1440:
		label = "2K"
	default:
		label = fmt.Sprintf("%dP", h)
	}
	if fps > 30 {
		label += fmt.Sprintf(" %dfps", fps)
	}
	return label
}

// BuildVideoFormats 把 info JSON 转成界面可选的格式列表（默认不放开 YouTube manifest）。
//
// 与 TS 侧 `buildVideoFormats(info, isYoutube, allowYoutubeManifests = false)` 的
// 默认参数对应。Go 没有默认参数，所以保留一个三参版本 + 这个二参包装，
// 让调用点与 TS 的写法保持一致——编译器不会提醒「少传了参数」，包装函数可以。
func BuildVideoFormats(info FmtInfo, isYoutube bool) []Format {
	return BuildVideoFormatsWithManifests(info, isYoutube, false)
}

// BuildVideoFormatsWithManifests 是带 manifest 开关的完整版本。
//
// allowYoutubeManifests：YouTube 仅在**流格式回退**时放开仅有的 m3u8 清晰度。
func BuildVideoFormatsWithManifests(info FmtInfo, isYoutube bool, allowYoutubeManifests bool) []Format {
	isM3U8 := func(f RawFormat) bool { return strings.Contains(f.Protocol, "m3u8") }

	// 不要求 vcodec 字段存在：X/Twitter 的 mp4 直链不带编解码信息
	var videoFormats []RawFormat
	for _, f := range info.Formats {
		if f.Vcodec != "none" && f.Height > 0 {
			videoFormats = append(videoFormats, f)
		}
	}

	// 同一高度有直链时去掉 m3u8（直链下载更快更稳）；
	// 只有 m3u8 的清晰度保留（部分 X 视频、直播回放）。
	directHeights := map[int]bool{}
	for _, f := range videoFormats {
		if !isM3U8(f) {
			directHeights[f.Height] = true
		}
	}

	// 必须初始化为**非 nil** 的空切片：Go 的 nil slice 序列化成 `null`，
	// 而 TS 返回的是 `[]`。前端拿到 null 会直接崩（`formats.length` 报错），
	// 而两边单测都绿——这个差异是交叉验证抓到的。
	formats := []Format{}
	for _, f := range videoFormats {
		if isM3U8(f) && !((!isYoutube || allowYoutubeManifests) && !directHeights[f.Height]) {
			continue
		}

		filesize := f.Filesize
		if filesize == 0 {
			filesize = f.FilesizeApp
		}
		if filesize == 0 && info.Duration > 0 {
			bitrate := f.Tbr
			if bitrate == 0 {
				audio := f.Abr
				if audio == 0 && f.Acodec != nil && *f.Acodec != "none" {
					audio = 128
				}
				bitrate = f.Vbr + audio
			}
			if bitrate > 0 {
				filesize = int64(math.Floor(bitrate * 1000 * info.Duration / 8))
			}
		}

		label := cleanQualityLabel(f.QualityLbl)
		if label == "" {
			label = cleanQualityLabel(f.FormatNote)
		}
		if label == "" {
			label = resolutionLabel(f.Height, f.FPS)
		}

		ext := f.Ext
		if ext == "" {
			ext = f.VideoExt
		}
		if ext == "" {
			ext = "mp4"
		}

		// acodec 缺失视为音视频一体（渐进式 mp4 通常如此），下载时不再额外合并音轨
		hasAudio := true
		if f.Acodec != nil && *f.Acodec == "none" {
			hasAudio = false
		}

		formats = append(formats, Format{
			FormatID:  f.FormatID,
			Quality:   label,
			Ext:       ext,
			Filesize:  filesize,
			Width:     f.Width,
			Height:    f.Height,
			FPS:       NormalizeFPS(f.FPS),
			HasAudio:  hasAudio,
			tbr:       f.Tbr,
			codecRank: codecRank(f.Vcodec),
		})
	}

	// 排序决定「同一清晰度留哪一个」：先分辨率/帧率降序（展示顺序），
	// 同档位内按编码兼容性升序（AVC 优先），最后才比码率
	sort.SliceStable(formats, func(i, j int) bool {
		a, b := formats[i], formats[j]
		if a.Height != b.Height {
			return a.Height > b.Height
		}
		if a.FPS != b.FPS {
			return a.FPS > b.FPS
		}
		if a.codecRank != b.codecRank {
			return a.codecRank < b.codecRank
		}
		return a.tbr > b.tbr
	})

	// 同一清晰度只留一个。
	//
	// 去重键用 height + **归一化** fps，而不是 quality 字符串：
	//   - quality 是给人看的标签，同一 height 可能被标成不同写法
	//   - 归一化 fps 让 29.969 与 29.97 落进同一个桶（「两个 1080P」的根因）
	seen := map[string]bool{}
	deduped := formats[:0]
	for _, f := range formats {
		key := fmt.Sprintf("%d_%d", f.Height, f.FPS)
		if seen[key] {
			continue
		}
		seen[key] = true
		deduped = append(deduped, f)
	}
	formats = deduped

	// 兜底：站点没有提供可识别的分辨率信息时，交给 yt-dlp 自动选择最佳格式
	if len(formats) == 0 && (len(info.Formats) > 0 || info.URL != "") {
		filesize := info.Filesize
		if filesize == 0 {
			filesize = 0
		}
		formats = []Format{{
			FormatID: "bv*+ba/b",
			Quality:  "最佳画质",
			Ext:      defaultStr(info.Ext, "mp4"),
			Filesize: filesize,
			Width:    info.Width,
			Height:   info.Height,
			FPS:      int(info.FPS),
			HasAudio: true,
		}}
	}

	return formats
}

func defaultStr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
