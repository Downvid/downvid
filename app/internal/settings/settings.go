// Package settings 管理用户设置。
//
// ## 这个包最重要的约束：不能删也不能改字段
//
// 设置字段是**跨版本承诺**。删除或重命名字段属于 MAJOR 变更
// （见 `docs/release.md` 的版本语义）——老用户的设置会静默失效，
// 表现为「升级后所有选项回到默认」，而且没有任何报错。
//
// 所以：
//   - 字段名与 TS 版 `AppSettings` **逐字一致**（JSON 键也一样）
//   - 默认值与 `DEFAULT_SETTINGS` 一致
//   - 只**新增**字段（读取时用默认值补齐），不删不改
//
// ## 落盘兼容
//
// 桌面端历史上存在 `localStorage['settings']`（浏览器侧）与
// `<dataDir>/settings.json`（本包）。两者**不互相覆盖**：
// 本包只负责后者，浏览器那侧由前端继续管。迁移期两边并存是刻意的——
// 一次性换存储会让老用户设置丢一次。
package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// DepKind 是依赖种类（与 `shared/acceleration.ts` 的 DEP_KINDS 一致）。
type DepKind = string

var DepKinds = []DepKind{"yt-dlp", "ffmpeg", "ffprobe", "aria2"}

// Acceleration 是加速设置。
//
// Enabled 用指针表达三态：TS 侧的语义是「只有显式 false 才关闭」
// （`enabled: raw.enabled !== false`）。Go 的 bool 零值是 false，
// 直接用会让「未设置」被误判成「关闭」——这个坑在 download 包已经踩过一次。
type Acceleration struct {
	Enabled        *bool  `json:"enabled,omitempty"`
	MaxConnections int    `json:"maxConnections,omitempty"`
	Aria2Path      string `json:"aria2Path,omitempty"`
}

// Settings 是全部用户设置。
//
// 13 个字段，与 TS 版 `AppSettings` 一一对应。**顺序也保持一致**——
// JSON 落盘时会按结构体字段顺序输出，顺序变了会让 diff 变得难读。
type Settings struct {
	DownloadDir        string            `json:"downloadDir"`
	FilenameTemplate   string            `json:"filenameTemplate"`
	PreferredQuality   string            `json:"preferredQuality"`
	CookieMode         string            `json:"cookieMode"` // auto / manual
	CookiesFile        string            `json:"cookiesFile"`
	Proxy              string            `json:"proxy"`
	Acceleration       Acceleration      `json:"acceleration"`
	DepPaths           map[string]string `json:"depPaths"`
	AutoCheckUpdate    bool              `json:"autoCheckUpdate"`
	AutoDownloadUpdate bool              `json:"autoDownloadUpdate"`
	DepMirror          string            `json:"depMirror"`
	UpdateSource       string            `json:"updateSource"`
	Language           string            `json:"language"` // auto / zh-CN / en-US
	// BypassProxy 让**解析与下载**不走上面那个代理。
	//
	// 为什么要它：开着 TUN/透明代理的机器上，再给 yt-dlp 传 `--proxy`
	// 等于双重代理——实测同一条 YouTube 视频，有代理时解析多花 1.6 秒、
	// 速度波动到 0.7 MB/s，而不传反而稳定在 6.8 MB/s。
	BypassProxy bool `json:"bypassProxy,omitempty"`
}

// boolPtr 取 *bool。
func boolPtr(v bool) *bool { return &v }

// Defaults 返回默认设置。
//
// 与 TS 的 `DEFAULT_SETTINGS` **逐字一致**。改这里等于改所有新用户的初始体验。
func Defaults() Settings {
	return Settings{
		DownloadDir:      "",
		FilenameTemplate: "%(title)s.%(ext)s",
		PreferredQuality: "best",
		CookieMode:       "auto",
		CookiesFile:      "",
		Proxy:            "",
		Acceleration: Acceleration{
			Enabled: boolPtr(true), // 默认开启
			// 8 与 shared/acceleration.ts 的 normalizeAcceleration 默认值一致
			MaxConnections: 8,
		},
		DepPaths:           map[string]string{},
		AutoCheckUpdate:    true,  // 默认开：不检查更新会让用户长期停在旧版本
		AutoDownloadUpdate: false, // 默认关：移动网络/计费流量下更友好
		DepMirror:          "auto",
		UpdateSource:       "auto",
		Language:           "auto",
	}
}

// Normalize 清洗一份可能被改坏的设置。
//
// 存档数据可能来自旧版本、被手工改过、或是别的程序写的。
// 每一项都要么落到合法值，要么回退默认——**绝不能原样透传**：
// 「一个非法值」的后果往往是功能静默不生效（比如 `updateSource: "github "`）。
func Normalize(raw Settings) Settings {
	def := Defaults()
	out := raw

	// 字符串字段：空串是合法的（downloadDir 空 = 用系统下载目录），
	// 只有模板为空时才回退默认——空模板会让文件名变成 "@/path/.mp4"
	if strings.TrimSpace(out.FilenameTemplate) == "" {
		out.FilenameTemplate = def.FilenameTemplate
	}
	if strings.TrimSpace(out.PreferredQuality) == "" {
		out.PreferredQuality = def.PreferredQuality
	}

	if out.CookieMode != "auto" && out.CookieMode != "manual" {
		out.CookieMode = def.CookieMode
	}

	// depPaths：只保留已知种类的**非空字符串**
	//
	// 存档里可能是数组、字符串、null。早先只判断 `typeof === 'object'`，
	// 于是 `[]` 会被当成合法值留下，后续按对象使用取不到任何路径——
	// 表现为「手动填的路径没生效」且无报错。
	out.DepPaths = normalizeDepPaths(raw.DepPaths)

	// acceleration：复刻 normalizeAcceleration 的规则
	out.Acceleration = normalizeAcceleration(raw.Acceleration)

	// 更新源 / 依赖源：非法值一律回退 auto
	//
	// 回退成「一个源都不试」会让更新永久失灵，而用户看不出原因
	if !knownUpdateSource(out.UpdateSource) {
		out.UpdateSource = def.UpdateSource
	}
	if !knownDepMirror(out.DepMirror) {
		out.DepMirror = def.DepMirror
	}

	if out.Language != "auto" && out.Language != "zh-CN" && out.Language != "en-US" {
		out.Language = def.Language
	}

	return out
}

func normalizeDepPaths(raw map[string]string) map[string]string {
	out := map[string]string{}
	if raw == nil {
		return out
	}
	for _, kind := range DepKinds {
		if v, ok := raw[kind]; ok {
			if trimmed := strings.TrimSpace(v); trimmed != "" {
				out[kind] = trimmed
			}
		}
	}
	return out
}

// normalizeAcceleration 复刻 shared/acceleration.ts 的 normalizeAcceleration。
//
// 规则：enabled 只有显式 false 才算关闭；maxConnections 非正数取默认 8，
// 超过 16 截到 16（clamp 而不是拒绝——用户手填 100 时给 16 比给 1 更符合意图）。
func normalizeAcceleration(raw Acceleration) Acceleration {
	out := Acceleration{MaxConnections: 8, Aria2Path: strings.TrimSpace(raw.Aria2Path)}

	// 未设置 = 默认开启
	if raw.Enabled == nil {
		out.Enabled = boolPtr(true)
	} else {
		out.Enabled = boolPtr(*raw.Enabled)
	}

	if raw.MaxConnections > 0 {
		n := raw.MaxConnections
		if n > 16 {
			n = 16
		}
		out.MaxConnections = n
	}
	return out
}

var updateSources = map[string]bool{
	"auto": true, "github": true, "jsdelivr": true,
	"ghproxy": true, "gitee": true, "website": true,
}

func knownUpdateSource(v string) bool { return updateSources[v] }

var depMirrors = map[string]bool{
	"auto": true, "direct": true, "ghproxy": true, "ghfast": true, "gitee": true,
}

func knownDepMirror(v string) bool { return depMirrors[v] }

// Store 负责读写设置文件。
type Store struct {
	path string

	mu    sync.Mutex
	cache *Settings
}

// NewStore 创建设置存储。
func NewStore(path string) *Store {
	return &Store{path: path}
}

// Path 返回设置文件路径（排障时用）。
func (s *Store) Path() string { return s.path }

// ErrCorrupt 表示设置文件损坏。
var ErrCorrupt = errors.New("设置文件损坏")

// Load 读取设置。文件不存在时返回默认值。
//
// ## 损坏时的处理（与 TS 版的关键差异之一）
//
// 旧实现 `catch {}` 之后返回默认值——用户会看到「所有设置回到默认」
// 而没有任何提示，也不知道备份在哪。
// 这里返回一个可识别的错误 + 留一份 `.corrupt` 备份，让调用方能提示用户。
func (s *Store) Load() (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	raw, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			// 首次启动：返回默认值，不创建文件（等用户真的改了才写）
			def := Defaults()
			s.cache = &def
			return def, nil
		}
		return Defaults(), err
	}

	var parsed Settings
	if err := json.Unmarshal(raw, &parsed); err != nil {
		// 留备份：设置文件里可能有用户手填的路径、代理地址，直接丢掉可惜
		backup := s.path + ".corrupt"
		_ = os.WriteFile(backup, raw, 0o644)
		return Defaults(), fmt.Errorf("%w（已备份到 %s）", ErrCorrupt, backup)
	}

	out := Normalize(parsed)
	s.cache = &out
	return out, nil
}

// Save 原子写入设置。
//
// 与历史一样用「临时文件 + rename」：写到一半崩溃会让设置文件变半截 JSON，
// 下次读取解析失败 → 用户所有设置回到默认。
func (s *Store) Save(next Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	clean := Normalize(next)

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(clean, "", "  ")
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".settings-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	// Sync 再 rename：否则内容可能还在 page cache，断电即丢
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return err
	}

	s.cache = &clean
	return nil
}

// Update 合并写入：只改传入的字段，其余保持不变。
//
// **这是唯一的写入入口**。整体覆盖（Save 一个刚构造的 Settings）会把
// 别的组件写的字段抹掉——历史事故：在设置面板点一次「保存」，
// `depPaths` 就没了（因为那次的 Settings 接口里没有这个字段）。
func (s *Store) Update(patch func(*Settings)) (Settings, error) {
	s.mu.Lock()
	current := Defaults()
	if s.cache != nil {
		current = *s.cache
	} else {
		// 没读过就先读一次（避免在空默认值上打补丁）
		s.mu.Unlock()
		loaded, err := s.Load()
		if err != nil && !errors.Is(err, ErrCorrupt) {
			return Defaults(), err
		}
		current = loaded
		s.mu.Lock()
	}

	patch(&current)
	s.mu.Unlock()

	// Save 自己会加锁，所以先释放
	if err := s.Save(current); err != nil {
		return Defaults(), err
	}
	return current, nil
}
