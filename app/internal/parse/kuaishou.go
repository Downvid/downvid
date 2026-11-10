package parse

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// IsKuaishou 报告是否是快手链接。
func IsKuaishou(u string) bool {
	return strings.Contains(u, "kuaishou.com") || strings.Contains(u, "kwai.com")
}

var (
	ksShortVideoRegexp = regexp.MustCompile(`/short-video/([^?&#]+)`)
	// 快手的分享短链有两种写法，实测都指向真实视频：
	//   - `https://v.kuaishou.com/<code>`   → 302 到 `c.kuaishou.com/fw/photo/<id>`
	//   - `https://v.kuaishou.com/f/<code>` → 302 到 `c.kuaishou.com/fw/user/<id>`
	//
	// 早先只认 `/f/`，而 App 分享出来的是**不带 `/f/`** 的那种，于是
	// 短链一条都解析不出来，直接报「无法从 URL 提取快手视频 ID」。
	ksShortLinkRegexp = regexp.MustCompile(`(?:v|www)?\.?kuaishou\.com/(?:f/)?([A-Za-z0-9_-]+)`)
)

// KuaishouCookieDomains 是快手相关的 Cookie 域名。
//
// 快手 GraphQL 对无有效会话的请求直接返回 `Need captcha`，因此与抖音一样
// 需要把浏览器导出的 Cookie 一并带上（能否通过另说，见 KindPlatformBlocked）。
var KuaishouCookieDomains = []string{"kuaishou.com", "kwai.com", "gifshow.com"}

// ksUserAgent 是请求快手时使用的 UA。两个请求（短链跳转、GraphQL）必须一致：
// 站点会把 UA 与 Cookie 里的设备信息做比对。
const ksUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
	"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// extractKuaishouPhotoID 从跳转后的 URL 里取 photo id。
//
// 实测的落点有四种形态，缺一种就会「短链解析不出 id」：
//   - /short-video/<id>
//   - /fw/photo/<id>
//   - /fw/user/<id>     （主页分享，不是视频——取出来的 id 不是 photo id）
//   - /profile/<user>   （用户主页）
//
// 主页形态返回空串，让调用方报「不是视频链接」，而不是拿用户 id 去查 GraphQL
// 得到一句语焉不详的「未包含 photo 信息」。
func extractKuaishouPhotoID(u string) string {
	if m := ksShortVideoRegexp.FindStringSubmatch(u); len(m) > 1 {
		return m[1]
	}
	if m := ksPhotoPathRegexp.FindStringSubmatch(u); len(m) > 1 {
		return m[1]
	}
	return ""
}

var ksPhotoPathRegexp = regexp.MustCompile(`/fw/photo/([^?&#/]+)`)

type ksGraphQLRequest struct {
	OperationName string         `json:"operationName"`
	Variables     map[string]any `json:"variables"`
	Query         string         `json:"query"`
}

type ksRepresentation struct {
	ID         int    `json:"id"`
	URL        string `json:"url"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	AvgBitrate int    `json:"avgBitrate"`
	Size       int64  `json:"size"`
	Type       string `json:"type"`
}

type ksGraphQLResponse struct {
	Data struct {
		VisionVideoDetail *struct {
			Status int `json:"status"`
			Photo  *struct {
				ID           string `json:"id"`
				Duration     int64  `json:"duration"`
				Caption      string `json:"caption"`
				CoverURL     string `json:"coverUrl"`
				PhotoURL     string `json:"photoUrl"`
				PhotoH265URL string `json:"photoH265Url"`
				Manifest     struct {
					AdaptationSet struct {
						Duration       int64              `json:"duration"`
						Representation []ksRepresentation `json:"representation"`
					} `json:"adaptationSet"`
				} `json:"manifest"`
			} `json:"photo"`
		} `json:"visionVideoDetail"`
	} `json:"data"`
}

const ksGraphQLQuery = `query VisionVideoDetail($photoId: String!) {
  visionVideoDetail(photoId: $photoId) {
    status
    photo {
      id
      duration
      caption
      coverUrl
      photoUrl
      photoH265Url
      manifest {
        adaptationSet {
          id
          duration
          representation {
            id
            url
            width
            height
            avgBitrate
            size
            type
          }
        }
      }
    }
  }
}`

// ParseKuaishouAPI 用直接 GraphQL API 解析快手视频。
//
// cookiesFile 与抖音一样接收浏览器导出的 cookies.txt：快手的 GraphQL 对
// 无会话请求返回 `Need captcha`，带上会话至少不再被当成匿名流量。
func ParseKuaishouAPI(rawURL string, cookiesFile string, proxyStr string) (*VideoInfo, error) {
	client := newHTTPClient(proxyStr, 15*time.Second)

	// 解析 Cookies（与抖音同一套：支持 Netscape 与浏览器扩展导出的 JSON 数组）
	cookieHeader := ""
	if cookiesFile != "" {
		cookieHeader = BuildCookieHeader(ParseCookiesFile(cookiesFile), KuaishouCookieDomains)
	}

	videoID := ""
	if m := ksShortVideoRegexp.FindStringSubmatch(rawURL); len(m) > 1 {
		videoID = m[1]
	}

	if videoID == "" {
		if m := ksShortLinkRegexp.FindStringSubmatch(rawURL); len(m) > 1 {
			shortCode := m[1]
			// 短链会 302 到真实页面；`/fw/photo/<id>`、`/fw/user/<id>`、
			// `/short-video/<id>` 三种落点都要认，否则拿不到 id。
			fullURL := fmt.Sprintf("https://v.kuaishou.com/%s", shortCode)
			req, err := http.NewRequest("GET", fullURL, nil)
			if err == nil {
				req.Header.Set("User-Agent", ksUserAgent)
				if cookieHeader != "" {
					req.Header.Set("Cookie", cookieHeader)
				}
				if resp, err := client.Do(req); err == nil {
					finalURL := resp.Request.URL.String()
					resp.Body.Close()
					videoID = extractKuaishouPhotoID(finalURL)
				}
			}
		}
	}

	if videoID == "" {
		return nil, errors.New("无法从 URL 提取快手视频 ID")
	}

	queryPayload := ksGraphQLRequest{
		OperationName: "VisionVideoDetail",
		Variables:     map[string]any{"photoId": videoID},
		Query:         ksGraphQLQuery,
	}
	payloadBytes, err := json.Marshal(queryPayload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", "https://www.kuaishou.com/graphql", bytes.NewReader(payloadBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", ksUserAgent)
	req.Header.Set("Referer", "https://www.kuaishou.com/")
	req.Header.Set("Origin", "https://www.kuaishou.com")
	if cookieHeader != "" {
		req.Header.Set("Cookie", cookieHeader)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("快手 GraphQL 请求失败：%w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取快手 GraphQL 响应失败：%w", err)
	}

	var data ksGraphQLResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, fmt.Errorf("解析快手 GraphQL 响应失败：%w", err)
	}

	detail := data.Data.VisionVideoDetail
	if detail == nil || detail.Photo == nil {
		return nil, errors.New("快手 API 返回未包含 photo 信息")
	}

	photo := detail.Photo
	durationSec := float64(photo.Duration) / 1000

	type formatItem struct {
		format Format
		url    string
	}
	var items []formatItem

	reps := photo.Manifest.AdaptationSet.Representation
	for i, rep := range reps {
		if rep.URL == "" {
			continue
		}
		filesize := rep.Size
		if filesize <= 0 && photo.Duration > 0 && rep.AvgBitrate > 0 {
			filesize = int64(rep.AvgBitrate) * photo.Duration / 1000 / 8
		} else if filesize <= 0 && photo.Duration > 0 {
			h := rep.Height
			if h <= 0 {
				h = 720
			}
			filesize = EstimateFileSize(h, photo.Duration)
		}

		items = append(items, formatItem{
			format: Format{
				FormatID: fmt.Sprintf("ks_%d", i),
				Quality:  fmt.Sprintf("%dp", rep.Height),
				Ext:      "mp4",
				Filesize: filesize,
				Width:    rep.Width,
				Height:   rep.Height,
				FPS:      30,
				HasAudio: true,
			},
			url: rep.URL,
		})
	}

	if len(items) == 0 && photo.PhotoURL != "" {
		fs := int64(0)
		if photo.Duration > 0 {
			fs = EstimateFileSize(720, photo.Duration)
		}
		items = append(items, formatItem{
			format: Format{
				FormatID: "default",
				Quality:  "默认",
				Ext:      "mp4",
				Filesize: fs,
				Width:    0,
				Height:   0,
				FPS:      30,
				HasAudio: true,
			},
			url: photo.PhotoURL,
		})
	}

	if len(items) == 0 {
		return nil, errors.New("未能解析出可用的快手播放格式")
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].format.Height > items[j].format.Height
	})

	formats := make([]Format, len(items))
	directURL := ""
	for i, item := range items {
		formats[i] = item.format
		if i == 0 {
			directURL = item.url
		}
	}

	title := photo.Caption
	if title == "" {
		title = "快手视频"
	}

	return &VideoInfo{
		ID:          photo.ID,
		Title:       title,
		Description: photo.Caption,
		Thumbnail:   photo.CoverURL,
		Duration:    durationSec,
		Uploader:    "",
		WebpageURL:  fmt.Sprintf("https://www.kuaishou.com/short-video/%s", videoID),
		Formats:     formats,
		DirectURL:   directURL,
	}, nil
}
