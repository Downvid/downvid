package parse

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// IsDouyin 报告是否是抖音链接。
func IsDouyin(u string) bool {
	return strings.Contains(u, "douyin.com") || strings.Contains(u, "iesdouyin.com")
}

var douyinVideoIDRegexp = regexp.MustCompile(`/video/(\d+)`)

type douyinBitRateItem struct {
	GearName string `json:"gear_name"`
	Height   int    `json:"height"`
	Width    int    `json:"width"`
	FPS      int    `json:"fps"`
	DataSize int64  `json:"data_size"`
	PlayAddr struct {
		URLList []string `json:"url_list"`
		Height  int      `json:"height"`
		Width   int      `json:"width"`
	} `json:"play_addr"`
}

type douyinDetailResponse struct {
	AwemeDetail *struct {
		AwemeID string `json:"aweme_id"`
		Desc    string `json:"desc"`
		Author  struct {
			Nickname string `json:"nickname"`
		} `json:"author"`
		Video struct {
			Duration int64 `json:"duration"` // 毫秒
			Cover    struct {
				URLList []string `json:"url_list"`
			} `json:"cover"`
			DynamicCover struct {
				URLList []string `json:"url_list"`
			} `json:"dynamic_cover"`
			BitRate  []douyinBitRateItem `json:"bit_rate"`
			PlayAddr struct {
				URLList  []string `json:"url_list"`
				Height   int      `json:"height"`
				Width    int      `json:"width"`
				DataSize int64    `json:"data_size"`
			} `json:"play_addr"`
		} `json:"video"`
	} `json:"aweme_detail"`
}

func newHTTPClient(proxyStr string, timeout time.Duration) *http.Client {
	transport := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DisableKeepAlives:   false,
		MaxIdleConns:        10,
		IdleConnTimeout:     30 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	if proxyStr != "" {
		if u, err := url.Parse(proxyStr); err == nil {
			transport.Proxy = http.ProxyURL(u)
		}
	}
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}
}

// errDouyinDeadLink 表示短链已经打不开：抖音把失效的分享链接 302 到站点首页，
// 重定向结果里**不带任何视频 ID**。
//
// 打成 not-found 而不是让它继续落到 yt-dlp：yt-dlp 收到的是跳转后的
// `https://www.douyin.com/`，只会回一句 `Unsupported URL`，界面于是显示
// 「暂不支持该网站或链接类型」——链接失效被说成「不支持该网站」，用户会一直重试。
var errDouyinDeadLink = errors.New(
	"[[parse-error:not-found]]抖音短链已失效或视频不存在（平台把该链接重定向到了站点首页），请从 App 重新复制分享链接")

// errDouyinNeedsCookie 是同一个跳转结果，但**这次没带任何 Cookie**。
//
// 实测：匿名请求访问短链，抖音一律 302 到站点首页；浏览器里带着登录态点同一
// 条链接却能落到 /video/<id>。所以无 Cookie 时报「可能失效、也可能需要登录」，
// 别把缺登录态说成链接坏了。
var errDouyinNeedsCookie = errors.New(
	"[[parse-error:authentication]]抖音把该短链重定向到了站点首页：链接可能已失效，也可能需要登录 Cookie。" +
		"请先在浏览器里确认能打开，再到「设置 → Cookie」配置登录信息后重试")

// ParseDouyinAPI 用直接 HTTP API 快速解析抖音视频（耗时约 200ms）。
func ParseDouyinAPI(rawURL string, cookiesFile string, proxyStr string) (*VideoInfo, error) {
	client := newHTTPClient(proxyStr, 15*time.Second)

	// 解析 Cookies
	var cookieHeader string
	if cookiesFile != "" {
		cookies := ParseCookiesFile(cookiesFile)
		cookieHeader = BuildCookieHeader(cookies, DouyinCookieDomains)
	}

	videoID := ""
	if m := douyinVideoIDRegexp.FindStringSubmatch(rawURL); len(m) > 1 {
		videoID = m[1]
	}

	// 如果未直接匹配到（如短链接 https://v.douyin.com/...），通过重定向获取最终 URL
	if videoID == "" {
		req, err := http.NewRequest("GET", rawURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		if cookieHeader != "" {
			req.Header.Set("Cookie", cookieHeader)
		}

		resp, err := client.Do(req)
		if err == nil {
			finalURL := resp.Request.URL.String()
			resp.Body.Close()
			if m := douyinVideoIDRegexp.FindStringSubmatch(finalURL); len(m) > 1 {
				videoID = m[1]
			}
		}
	}

	if videoID == "" {
		if cookieHeader == "" {
			return nil, errDouyinNeedsCookie
		}
		return nil, errDouyinDeadLink
	}

	apiURL := fmt.Sprintf("https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=%s&aid=6383&channel=channel_pc_web&detail_list=1", videoID)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Referer", "https://www.douyin.com/")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	if cookieHeader != "" {
		req.Header.Set("Cookie", cookieHeader)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("抖音 API 请求失败：%w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取抖音 API 响应失败：%w", err)
	}

	var data douyinDetailResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, fmt.Errorf("解析抖音 API 响应失败：%w", err)
	}
	if data.AwemeDetail == nil {
		return nil, errors.New("抖音 API 返回未包含 aweme_detail")
	}

	detail := data.AwemeDetail
	v := detail.Video
	durationSec := float64(v.Duration) / 1000

	formats, directURL := buildDouyinFormats(v.BitRate, v.Duration, v.PlayAddr.URLList, v.PlayAddr.Height, v.PlayAddr.Width, v.PlayAddr.DataSize)
	if len(formats) == 0 {
		return nil, errors.New("未能解析出可用的抖音播放格式")
	}

	thumb := ""
	if len(v.Cover.URLList) > 0 {
		thumb = v.Cover.URLList[0]
	} else if len(v.DynamicCover.URLList) > 0 {
		thumb = v.DynamicCover.URLList[0]
	}

	title := detail.Desc
	if title == "" {
		title = "抖音视频"
	}

	return &VideoInfo{
		ID:          detail.AwemeID,
		Title:       title,
		Description: detail.Desc,
		Thumbnail:   thumb,
		Duration:    durationSec,
		Uploader:    detail.Author.Nickname,
		WebpageURL:  rawURL,
		Formats:     formats,
		DirectURL:   directURL,
	}, nil
}

func buildDouyinFormats(
	bitRate []douyinBitRateItem,
	durationMs int64,
	fallbackURLs []string,
	fallbackHeight, fallbackWidth int,
	fallbackDataSize int64,
) ([]Format, string) {
	gearMap := map[string]string{
		"超清": "1080P",
		"高清": "720P",
		"标清": "480P",
		"流畅": "360P",
		"4K": "2160P",
		"2K": "1440P",
	}

	qualityMap := make(map[string]struct {
		format Format
		url    string
	})

	digitReg := regexp.MustCompile(`(\d+)`)

	for idx, br := range bitRate {
		if len(br.PlayAddr.URLList) == 0 || br.PlayAddr.URLList[0] == "" {
			continue
		}
		playURL := br.PlayAddr.URLList[0]
		quality := "默认"
		qualityKey := "default"
		height := br.Height
		if height <= 0 {
			height = br.PlayAddr.Height
		}

		if height > 0 {
			quality = fmt.Sprintf("%dP", height)
			qualityKey = strconv.Itoa(height)
		} else if br.GearName != "" {
			if m := digitReg.FindStringSubmatch(br.GearName); len(m) > 1 {
				quality = m[1] + "P"
				qualityKey = m[1]
				height, _ = strconv.Atoi(m[1])
			} else if mapped, ok := gearMap[br.GearName]; ok {
				quality = mapped
				qualityKey = br.GearName
			} else {
				quality = br.GearName
				qualityKey = br.GearName
			}
		}

		filesize := br.DataSize
		if filesize <= 0 && durationMs > 0 {
			filesize = EstimateFileSize(height, durationMs)
		}

		width := br.Width
		if width <= 0 {
			width = br.PlayAddr.Width
		}
		fps := br.FPS
		if fps <= 0 {
			fps = 30
		}

		existing, exists := qualityMap[qualityKey]
		if !exists || filesize > existing.format.Filesize {
			qualityMap[qualityKey] = struct {
				format Format
				url    string
			}{
				format: Format{
					FormatID: fmt.Sprintf("hd_%d", idx),
					Quality:  quality,
					Ext:      "mp4",
					Filesize: filesize,
					Width:    width,
					Height:   height,
					FPS:      fps,
					HasAudio: true,
				},
				url: playURL,
			}
		}
	}

	var results []struct {
		format Format
		url    string
	}
	for _, item := range qualityMap {
		results = append(results, item)
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].format.Height > results[j].format.Height
	})

	if len(results) == 0 && len(fallbackURLs) > 0 && fallbackURLs[0] != "" {
		fs := fallbackDataSize
		if fs <= 0 && durationMs > 0 {
			fs = EstimateFileSize(fallbackHeight, durationMs)
		}
		results = append(results, struct {
			format Format
			url    string
		}{
			format: Format{
				FormatID: "normal",
				Quality:  "默认",
				Ext:      "mp4",
				Filesize: fs,
				Width:    fallbackWidth,
				Height:   fallbackHeight,
				FPS:      30,
				HasAudio: true,
			},
			url: fallbackURLs[0],
		})
	}

	formats := make([]Format, len(results))
	directURL := ""
	for i, r := range results {
		formats[i] = r.format
		if i == 0 {
			directURL = r.url
		}
	}

	return formats, directURL
}
