// Package parse —— 调 yt-dlp 解析视频信息。
//
// 这是 electron/parsers/ytdlp.ts 的执行部分移植。`formats.go` 已有格式列表的
// 纯逻辑，这里补上「跑进程 → 拿 JSON → 组装结果」。
//
// ## 与 TS 版的三个关键对齐点
//
//  1. **重试在同一次 Cookie 生命周期内完成**：临时 cookie 快照只在整轮重试
//     结束后清理。中途清理会让第二轮拿着一份已删除的文件去请求。
//  2. **成功路径上不跑 `--version`**：PyInstaller 构建一次 8~12 秒，为诊断用的
//     版本号多跑一次等于把解析时间翻倍。只在失败时才取。
//  3. **只取第一行 JSON**：多视频推文等播放列表会逐行输出多个 JSON，
//     取第一个才是用户点的那条。
package parse

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// VideoInfo 是一次解析的结果。
//
// 字段名与 TS 侧 `VideoInfo` **逐字一致**（JSON 键也一样）：
// 前端直接读这些键，改名不会有类型错误，只会让界面显示空白。
type VideoInfo struct {
	ID           string        `json:"id"`
	Title        string        `json:"title"`
	Description  string        `json:"description"`
	Thumbnail    string        `json:"thumbnail"`
	Duration     float64       `json:"duration"`
	Uploader     string        `json:"uploader"`
	WebpageURL   string        `json:"webpageUrl"`
	Formats      []Format      `json:"formats"`
	AudioTracks  []AudioTrack  `json:"audioTracks,omitempty"`
	Subtitles    []Subtitle    `json:"subtitles,omitempty"`
	AudioFormats []AudioFormat `json:"audioFormats,omitempty"`
	IsYoutube    bool          `json:"isYoutube"`
	ParseNotice  string        `json:"parseNotice"`
	// CacheFile 是原始 info JSON 的落盘路径，下载时用 --load-info-json 跳过二次提取
	CacheFile string `json:"cacheFile,omitempty"`
}

// AudioTrack 是 YouTube 的多音轨。
type AudioTrack struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Language string `json:"language"`
	FormatID string `json:"formatId"`
	IsM3U8   bool   `json:"isM3u8,omitempty"`
}

// Subtitle 是一条字幕。
type Subtitle struct {
	Language string `json:"language"`
	Name     string `json:"name"`
	URL      string `json:"url"`
}

// AudioFormat 是纯音频格式。
type AudioFormat struct {
	FormatID string  `json:"formatId"`
	Quality  string  `json:"quality"`
	Ext      string  `json:"ext"`
	Filesize int64   `json:"filesize"`
	ABR      float64 `json:"abr"`
	Acodec   string  `json:"acodec"`
}

// ParseOptions 是一次解析的参数。
type ParseOptions struct {
	// YtdlpPath 是 yt-dlp 可执行文件
	YtdlpPath string
	URL       string
	// Proxy 可选
	Proxy string
	// CookieArgs 是 cookie 相关参数（由调用方解析好再传入）
	CookieArgs []string
	// CacheDir 是原始 info JSON 的落盘目录（空则用系统临时目录）
	CacheDir string
	// Timeout 是单次解析的总时限
	Timeout time.Duration
}

// Parser 负责解析，并缓存结果（含条数上限）。
type Parser struct {
	mu    sync.Mutex
	cache map[string]*cacheEntry
}

type cacheEntry struct {
	info *VideoInfo
	at   time.Time
}

const (
	// cacheTTL 与 TS 版一致：30 分钟
	cacheTTL = 30 * time.Minute
	// cacheMax 是**条数**上限。
	//
	// 只按 TTL 清理不够：每条缓存持有一份完整 info JSON（长视频可到几 MB），
	// 「粘贴一批链接逐个看」30 分钟能攒到几百 MB，全部留在内存里。
	// 表现是「用久了越来越卡」，很难归因。
	cacheMax = 60
)

// NewParser 创建解析器。
func NewParser() *Parser {
	return &Parser{cache: map[string]*cacheEntry{}}
}

// --- yt-dlp 的 info JSON 形状（只取用到的字段）---

type rawInfo struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Thumbnail   string         `json:"thumbnail"`
	Duration    float64        `json:"duration"`
	Uploader    string         `json:"uploader"`
	WebpageURL  string         `json:"webpage_url"`
	Ext         string         `json:"ext"`
	Formats     []rawFormat    `json:"formats"`
	Subtitles   map[string]any `json:"subtitles"`
}

type rawFormat struct {
	FormatID   string  `json:"format_id"`
	FormatNote string  `json:"format_note"`
	Ext        string  `json:"ext"`
	AudioExt   string  `json:"audio_ext"`
	Vcodec     string  `json:"vcodec"`
	Acodec     string  `json:"acodec"`
	Protocol   string  `json:"protocol"`
	Language   string  `json:"language"`
	Height     int     `json:"height"`
	Width      int     `json:"width"`
	FPS        float64 `json:"fps"`
	ABR        float64 `json:"abr"`
	TBR        float64 `json:"tbr"`
	Filesize   int64   `json:"filesize"`
	FilesizeAp int64   `json:"filesize_approx"`
}

// Parse 解析一个 URL。
//
// 失败时返回的错误消息带 `[[parse-error:kind]]` 标记（与 TS 版同一份契约），
// 前端据此显示可行动的提示，而不是把 yt-dlp 的英文原文丢给用户。
func (p *Parser) Parse(opts ParseOptions) (*VideoInfo, error) {
	if opts.YtdlpPath == "" {
		return nil, errors.New("[[deps-missing:yt-dlp]]未找到可用的 yt-dlp，请在「设置 → 运行依赖」中下载后重试")
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 90 * time.Second
	}

	key := opts.URL + "|" + opts.Proxy
	if cached := p.fromCache(key); cached != nil {
		return cached, nil
	}

	isYoutube := IsYouTube(opts.URL)
	state := RetryState{}
	allowManifests := false
	retries := 0

	// 解析阶段的参数：与 electron/parsers/ytdlp.ts 的 buildBaseArgs 对齐
	base := []string{
		"--ignore-config", "--no-playlist", "--playlist-items", "1",
		"--no-check-certificates", "--quiet",
		"--socket-timeout", "10", "--extractor-retries", "1",
		"--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"--add-header", "Accept-Language:en-US,en;q=0.9",
	}
	if !isYoutube {
		base = append(base, "--no-warnings")
	}
	if opts.Proxy != "" {
		base = append(base, "--proxy", opts.Proxy)
	}
	base = append(base, "--dump-json")

	var stdout, stderr string
	var lastErr error

	for {
		args := append([]string{}, base...)
		if isYoutube {
			args = append(args, YoutubeExtractorArgs(state)...)
		}
		args = append(args, opts.CookieArgs...)
		args = append(args, opts.URL)

		stdout, stderr, lastErr = runYtdlp(opts, args)
		if lastErr == nil {
			break
		}
		// 有上限：没有上限时「格式不可用 → 换客户端 → 又不可用」会来回重试，
		// 把一次解析拖成几十秒
		if !isYoutube || retries >= 2 {
			break
		}
		next := NextYoutubeRetry(stderr, state, "")
		if next == nil {
			break
		}
		state = *next
		retries++
		allowManifests = state.Manifests
	}

	if lastErr != nil {
		kind := ClassifyParseError(stderr)
		return nil, fmt.Errorf("[[parse-error:%s]]%s", kind, ParseDiagnostic(stderr, Versions{}))
	}

	// 多视频推文等播放列表会逐行输出多个 JSON，只取第一个条目
	line := ""
	sc := bufio.NewScanner(strings.NewReader(stdout))
	sc.Buffer(make([]byte, 0, 64*1024), 64<<20) // info JSON 可能很大
	for sc.Scan() {
		if strings.HasPrefix(strings.TrimSpace(sc.Text()), "{") {
			line = sc.Text()
			break
		}
	}
	if line == "" {
		return nil, errors.New("[[parse-error:unknown]]解析响应格式无效")
	}

	var raw rawInfo
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return nil, errors.New("[[parse-error:unknown]]解析响应格式无效")
	}

	info := p.buildInfo(&raw, isYoutube, allowManifests, opts)

	// 保存原始 JSON：下载时用 --load-info-json 跳过二次提取
	info.CacheFile = p.writeCacheFile(opts, raw, line)

	p.toCache(key, info)
	return info, nil
}

// buildInfo 把 yt-dlp 的原始 JSON 组装成前端要的形状。
func (p *Parser) buildInfo(raw *rawInfo, isYoutube, allowManifests bool, opts ParseOptions) *VideoInfo {
	// 格式列表走纯逻辑（有 16 条用例与 TS 对拍）
	fi := FmtInfo{
		Formats:  make([]RawFormat, 0, len(raw.Formats)),
		Duration: raw.Duration,
		Ext:      raw.Ext,
	}
	for _, f := range raw.Formats {
		acodec := f.Acodec
		fi.Formats = append(fi.Formats, RawFormat{
			FormatID:    f.FormatID,
			URL:         "",
			Vcodec:      f.Vcodec,
			Acodec:      &acodec,
			Height:      f.Height,
			Width:       f.Width,
			FPS:         f.FPS,
			Ext:         f.Ext,
			Protocol:    f.Protocol,
			Filesize:    f.Filesize,
			FilesizeApp: f.FilesizeAp,
			Tbr:         f.TBR,
			Abr:         f.ABR,
			QualityLbl:  "",
			FormatNote:  f.FormatNote,
		})
	}
	formats := BuildVideoFormatsWithManifests(fi, isYoutube, allowManifests)

	info := &VideoInfo{
		ID:          raw.ID,
		Title:       raw.Title,
		Description: raw.Description,
		Thumbnail:   raw.Thumbnail,
		Duration:    raw.Duration,
		Uploader:    raw.Uploader,
		WebpageURL:  raw.WebpageURL,
		Formats:     formats,
		IsYoutube:   isYoutube,
	}
	if info.Title == "" {
		info.Title = "未知标题"
	}
	if info.WebpageURL == "" {
		info.WebpageURL = opts.URL
	}

	if isYoutube {
		info.AudioTracks = buildAudioTracks(raw.Formats)
		info.AudioFormats = buildAudioFormats(raw.Formats)
	}

	info.Subtitles = buildSubtitles(raw.Subtitles)

	return info
}

// buildAudioTracks 提取 YouTube 的多音轨。
//
// 两种形态（与 TS 版一致）：
//   - 多个语言的 m3u8 音轨 → 每种语言取最高分辨率的那条
//   - 否则从纯音频格式里按语言取码率最高的
func buildAudioTracks(formats []rawFormat) []AudioTrack {
	m3u8Best := map[string]rawFormat{}
	for _, f := range formats {
		if !strings.Contains(f.Protocol, "m3u8") || f.Language == "" {
			continue
		}
		if cur, ok := m3u8Best[f.Language]; !ok || f.Height > cur.Height {
			m3u8Best[f.Language] = f
		}
	}

	if len(m3u8Best) > 1 {
		out := make([]AudioTrack, 0, len(m3u8Best))
		for lang, f := range m3u8Best {
			out = append(out, AudioTrack{
				ID: lang, Name: langName(lang), Language: lang,
				FormatID: f.FormatID, IsM3U8: true,
			})
		}
		return sortTracks(out)
	}

	langBest := map[string]rawFormat{}
	for _, f := range formats {
		if f.Vcodec != "none" || f.Acodec == "" || f.Acodec == "none" || f.Language == "" {
			continue
		}
		if cur, ok := langBest[f.Language]; !ok || f.ABR > cur.ABR {
			langBest[f.Language] = f
		}
	}
	out := make([]AudioTrack, 0, len(langBest))
	for lang, f := range langBest {
		out = append(out, AudioTrack{ID: lang, Name: langName(lang), Language: lang, FormatID: f.FormatID})
	}
	return sortTracks(out)
}

// sortTracks 按语言排序：map 迭代顺序随机，不排序会让界面每次刷新都换顺序
func sortTracks(t []AudioTrack) []AudioTrack {
	for i := 1; i < len(t); i++ {
		for j := i; j > 0 && t[j].Language < t[j-1].Language; j-- {
			t[j], t[j-1] = t[j-1], t[j]
		}
	}
	return t
}

// buildAudioFormats 提取纯音频格式（按码率降序，最多 6 条）。
func buildAudioFormats(formats []rawFormat) []AudioFormat {
	var out []AudioFormat
	seenAbr := map[float64]bool{}
	for _, f := range formats {
		if f.Vcodec != "none" || f.Acodec == "" || f.Acodec == "none" {
			continue
		}
		if seenAbr[f.ABR] {
			continue
		}
		seenAbr[f.ABR] = true

		quality := f.FormatNote
		if f.ABR > 0 {
			quality = fmt.Sprintf("%.0fkbps", f.ABR)
		}
		ext := f.Ext
		if ext == "" {
			ext = f.AudioExt
		}
		if ext == "" {
			ext = "m4a"
		}
		size := f.Filesize
		if size == 0 {
			size = f.FilesizeAp
		}
		out = append(out, AudioFormat{
			FormatID: f.FormatID, Quality: quality, Ext: ext,
			Filesize: size, ABR: f.ABR, Acodec: f.Acodec,
		})
	}
	// 按码率降序
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].ABR > out[j-1].ABR; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	if len(out) > 6 {
		out = out[:6]
	}
	return out
}

// buildSubtitles 把 yt-dlp 的 subtitles 对象转成列表。
func buildSubtitles(subs map[string]any) []Subtitle {
	if len(subs) == 0 {
		return nil
	}
	langs := make([]string, 0, len(subs))
	for lang := range subs {
		langs = append(langs, lang)
	}
	// 排序：map 迭代随机，不排序会每次刷新都换顺序
	for i := 1; i < len(langs); i++ {
		for j := i; j > 0 && langs[j] < langs[j-1]; j-- {
			langs[j], langs[j-1] = langs[j-1], langs[j]
		}
	}

	out := make([]Subtitle, 0, len(langs))
	for _, lang := range langs {
		name, url := lang, ""
		switch v := subs[lang].(type) {
		case []any:
			if len(v) > 0 {
				if m, ok := v[0].(map[string]any); ok {
					if n, ok := m["name"].(string); ok && n != "" {
						name = n
					}
					if u, ok := m["url"].(string); ok {
						url = u
					}
				}
			}
		case map[string]any:
			if n, ok := v["name"].(string); ok && n != "" {
				name = n
			}
			if u, ok := v["url"].(string); ok {
				url = u
			}
		}
		out = append(out, Subtitle{Language: lang, Name: name, URL: url})
	}
	return out
}

// langName 把语言代码转成可读名称。
//
// 只覆盖常见语言：完整的映射表在 electron/constants.ts 的 LANG_NAMES 里，
// 后续移植。未命中时用大写代码——总比空白好。
func langName(code string) string {
	names := map[string]string{
		"ja": "日本語", "en": "English", "zh": "中文(原始)", "zh-Hans": "中文(简体)",
		"zh-Hant": "中文(繁體)", "zh-CN": "中文(简体)", "zh-TW": "中文(繁體)",
		"zh-HK": "中文(香港)", "ko": "한국어", "fr": "Français", "de": "Deutsch",
		"es": "Español", "pt": "Português", "ru": "Русский",
	}
	if n, ok := names[code]; ok {
		return n
	}
	return strings.ToUpper(code)
}

// ===== 进程执行 =====

// runYtdlp 跑一次 yt-dlp 并返回 stdout/stderr。
//
// 超时从 **opts.Timeout** 来而不是固定值：解析的时限与下载不同
// （解析要等站点响应，下载要等字节）。
func runYtdlp(opts ParseOptions, args []string) (stdout, stderr string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), opts.Timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, opts.YtdlpPath, args...)
	if dir := filepath.Dir(opts.YtdlpPath); dir != "" {
		cmd.Dir = dir
	}
	hideWindowParse(cmd)

	var outBuf, errBuf strings.Builder
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf

	err = cmd.Run()
	return outBuf.String(), errBuf.String(), err
}

// ===== 缓存 =====

func (p *Parser) fromCache(key string) *VideoInfo {
	p.mu.Lock()
	defer p.mu.Unlock()

	e, ok := p.cache[key]
	if !ok {
		return nil
	}
	if time.Since(e.at) > cacheTTL {
		delete(p.cache, key)
		return nil
	}
	return e.info
}

func (p *Parser) toCache(key string, info *VideoInfo) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.cache[key] = &cacheEntry{info: info, at: time.Now()}

	// 超过条数上限时淘汰最旧的。
	// **必须有上限**，只按 TTL 清理不够——见 cacheMax 的注释。
	for len(p.cache) > cacheMax {
		var oldestKey string
		var oldest time.Time
		for k, v := range p.cache {
			if oldestKey == "" || v.at.Before(oldest) {
				oldestKey, oldest = k, v.at
			}
		}
		if oldestKey == "" {
			break
		}
		if e := p.cache[oldestKey]; e != nil && e.info.CacheFile != "" {
			_ = os.Remove(e.info.CacheFile)
		}
		delete(p.cache, oldestKey)
	}
}

// writeCacheFile 把原始 info JSON 落盘（下载时 --load-info-json 用）。
func (p *Parser) writeCacheFile(opts ParseOptions, raw rawInfo, line string) string {
	dir := opts.CacheDir
	if dir == "" {
		dir = os.TempDir()
	}
	id := raw.ID
	if id == "" {
		id = fmt.Sprintf("%d", time.Now().UnixNano())
	}
	// ID 可能有非法字符，只保留字母数字与连字符
	safe := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, id)

	// 目录可能不存在（首次运行 / 用户清过数据目录）。
	// 不 MkdirAll 的话 WriteFile 会失败，而失败被静默返回空串——
	// 表现是「下载时二次提取」而不是报错：解析能用，只是慢一倍，极难归因。
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return ""
	}

	path := filepath.Join(dir, "downvid-"+safe+".json")
	if err := os.WriteFile(path, []byte(line), 0o644); err != nil {
		return ""
	}
	return path
}

// CleanupTempFiles 清理缓存里记录的临时文件（退出时调用）。
//
// 不清理的话，`/tmp` 里会堆积几十上百个 `downvid-*.json`（每个几百 KB），
// 系统重启前不会回收。
func (p *Parser) CleanupTempFiles() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, e := range p.cache {
		if e.info != nil && e.info.CacheFile != "" {
			_ = os.Remove(e.info.CacheFile)
		}
	}
	p.cache = map[string]*cacheEntry{}
}

var _ = io.Discard
