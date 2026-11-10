// Package pluginhost 让 DownVid 通过第三方插件解析站点。
//
// ## 为什么单独一个包
//
// 本包是 `app/internal/*` 里**唯一** import 第三方插件宿主
// （`github.com/yxxbc/mygo-plugin`，内含 moejs 运行时）的地方。抽出来是为了守住
// `pnpm lint:boundaries` 的 G1：各内部包互相零依赖，解析、下载、设置都能独立测试
// 与替换。把插件运行时塞进 `internal/parse` 会让「只想用解析器」的地方
// 被迫拖进一整个 JS 引擎。
//
// ## 边界：插件只回答「这是什么」，不碰字节
//
// 插件返回的是**元数据与直链**（标题、作者、格式、CDN 地址），实际下载仍由
// `internal/fetch` / `internal/download` 执行。这与 mygo-plugin 的
// `docs/trust-model.md` 第 4 条（「数据平面留在 Go」）是同一个决定：
//   - 插件拿不到解码后的内容，也就无从改写真假；
//   - 断点续传、限速、并发、进度这些既有能力一行都不用重写。
//
// ## 责任边界（重要）
//
// 插件由第三方编写，DownVid 只提供协议与安装入口。见 `docs/dev/plugins.md`。
package pluginhost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	plugin "github.com/yxxbc/mygo-plugin"
)

// Contract 是 DownVid 提供给插件的契约名。
//
// 插件 manifest 里写 `"contract": "downvid-parser"` 才会被加载；
// 写别的契约（例如 `mygo-music`）会被拒绝——那些插件的 `resolve` 语义不同。
const Contract = "downvid-parser"

// ContractVersion 是本包实现的契约版本。
//
// 只增不改语义：新增字段算向后兼容，仍用旧版本号；删字段或改含义才 +1。
// 由于宿主没有 contract 版本协商，这里通过 manifest 的 `minAppVersion`
// 间接约束（插件声明的宿主版本过高时加载失败，由上层显示原因）。
const ContractVersion = 1

// ResolveMethod 是插件必须导出的函数名。
const ResolveMethod = "resolve"

// rawFormat 是插件返回的一个可下载格式。
//
// 字段与 `parse.Format` 同名，但**故意不 import parse**（见包注释 G1）。
// 由调用方做一次转换，代价是十几行，换的是这个包不拖 dependency 到解析包。
type rawFormat struct {
	FormatID string `json:"formatId"`
	Quality  string `json:"quality"`
	Ext      string `json:"ext"`
	Filesize int64  `json:"filesize"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	FPS      int    `json:"fps"`
	HasAudio bool   `json:"hasAudio"`
}

// Result 是一次插件解析的结果。
type Result struct {
	ID          string      `json:"id"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Thumbnail   string      `json:"thumbnail"`
	Duration    float64     `json:"duration"`
	Uploader    string      `json:"uploader"`
	WebpageURL  string      `json:"webpageUrl"`
	Formats     []rawFormat `json:"formats"`
	// DirectURL 是**已签名**的 CDN 直链。有它时下载走直链路径，
	// 有效期通常只有几分钟，所以只能当次用。
	DirectURL string `json:"directUrl"`
	// Notice 是给用户看的一句说明（例如「无水印版本已选取」）。
	Notice string `json:"notice"`
}

// Formats 返回格式列表（导出给调用方转换用）。
func (r *Result) RawFormats() []rawFormat { return r.Formats }

// HostOptions 是构造 Host 的参数。
type HostOptions struct {
	// Dir 是插件根目录（每个插件一个子目录）。
	Dir string
	// DataDir 是插件的私有数据目录，一个插件一个子目录。
	DataDir string
	// AppVersion 是本应用版本，用于 minAppVersion 校验。
	AppVersion string
	// CallTimeout 是单次调用的时限。零值用宿主默认（30 秒）。
	CallTimeout time.Duration
	// Allowed 决定某个插件能否访问某个域名。
	//
	// **默认拒绝**：nil 不是「全都允许」，而是按插件 manifest 里
	// `permissions.network` 逐条判断。这一点必须显式，因为解析插件天然
	// 需要联网，而「联网」也是它能外传用户 Cookie 的唯一途径。
	Allowed func(pluginID, host string) bool
}

// Host 管理已安装的插件。
type Host struct {
	dir       string
	dataDir   string
	appVer    string
	callLimit time.Duration
	allowed   func(pluginID, host string) bool

	mu      sync.RWMutex
	plugins []loaded
	// lastErr 记录每个插件加载失败的原因，供界面显示「为什么没生效」
	lastErr map[string]string
}

type loaded struct {
	id string
	p  *plugin.Plugin
}

// New 创建插件宿主。dir 不存在时视为「没有装任何插件」，不是错误——
// 绝大多数用户不会装插件，启动路径不该因此报错。
func New(opts HostOptions) *Host {
	h := &Host{
		dir:       opts.Dir,
		dataDir:   opts.DataDir,
		appVer:    opts.AppVersion,
		callLimit: opts.CallTimeout,
		allowed:   opts.Allowed,
		lastErr:   map[string]string{},
	}
	h.Reload()
	return h
}

// Reload 重新扫描插件目录。
//
// 单个插件加载失败**不影响其他插件**：那是最常见的状态（插件要求更新的
// 应用版本、契约不匹配、语法错误），失败原因记在 lastErr 里给界面显示。
func (h *Host) Reload() {
	entries, err := os.ReadDir(h.dir)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			h.setErr("", reason(err))
		}
		h.mu.Lock()
		h.plugins = nil
		h.mu.Unlock()
		return
	}

	var found []loaded
	errs := map[string]string{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		dir := filepath.Join(h.dir, e.Name())
		// 先读 manifest 判断它是不是 DownVid 的解析插件。
		// 宿主自己不认识 contract，所以这道判断必须在这里做：否则一个
		// MyGo Music 的音源插件也会被加载，然后它的 `resolve` 语义对不上，
		// 表现为「插件装了但解析结果全错」。
		m, err := plugin.ReadManifest(dir)
		if err != nil {
			errs[e.Name()] = reason(err)
			continue
		}
		if m.Playback != Contract {
			errs[e.Name()] = fmt.Sprintf("插件声明 playback=%q，不是 DownVid 解析插件（需要 %q）", m.Playback, Contract)
			continue
		}
		p, err := plugin.Load(dir, plugin.Options{
			AppVersion:  h.appVer,
			DataDir:     filepath.Join(h.dataDir, e.Name()),
			CallTimeout: h.callLimit,
			Allowed:     h.allowed,
		})
		if err != nil {
			errs[e.Name()] = reason(err)
			continue
		}
		found = append(found, loaded{id: e.Name(), p: p})
	}

	h.mu.Lock()
	h.plugins = found
	h.lastErr = errs
	h.mu.Unlock()
}

func (h *Host) setErr(id, why string) {
	h.mu.Lock()
	h.lastErr[id] = why
	h.mu.Unlock()
}

// reason 把错误转成可以显示给用户的说明。
//
// **必须裁掉绝对路径**：`*os.PathError` 会把 `/Users/<名字>/Library/...`
// 整个带出来。这条字符串会显示在设置页，而用户截图提 Issue 时不会想到
// 先遮住用户名。
func reason(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	// PathError 拆开：操作 + 底层原因，丢掉路径
	var pe *os.PathError
	if errors.As(err, &pe) {
		msg = pe.Op + ": " + pe.Err.Error()
	}
	// 非 PathError 的错误也可能把路径写进正文（manifest 解析失败时
	// 上游会把 "<绝对路径>: invalid character ..." 整串带出来）。
	// 这里按分隔符砍掉路径前缀：保留最后一段冒号之后的说明。
	msg = stripPathPrefix(msg)
	if len(msg) > 200 {
		msg = msg[:200] + "…"
	}
	return msg
}

// IDs 返回已成功加载的插件 id（排序稳定，便于界面复现）。
func (h *Host) IDs() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]string, 0, len(h.plugins))
	for _, l := range h.plugins {
		out = append(out, l.id)
	}
	sort.Strings(out)
	return out
}

// Errors 返回加载失败的插件与原因（可直接显示给用户）。
func (h *Host) Errors() map[string]string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make(map[string]string, len(h.lastErr))
	for k, v := range h.lastErr {
		out[k] = v
	}
	return out
}

// HasPlugins 报告是否有可用插件（用于「跳过整条插件路径」的快速判断）。
func (h *Host) HasPlugins() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.plugins) > 0
}

// ErrNoPluginMatched 表示没有插件认领这个链接。
//
// 与「插件出错」必须分开：前者是正常情况（绝大多数链接都没有对应插件），
// 调用方应当继续走 yt-dlp；后者应当把原因报给用户。
var ErrNoPluginMatched = errors.New("没有插件认领这个链接")

// Resolve 依次询问每个插件。第一个返回非空结果的获胜。
//
// ## 为什么先问「认不认领」而不是直接调用
//
// 每个插件都实现同一个 `resolve(url)`，没有 `match` 的话，一个只支持 B 站的
// 插件会被要求解析抖音链接，只能返回 null 或抛错。约定：**返回 null 表示
// 不认领**，这是正常路径，不算失败；抛异常才算该插件出错，记下来但不打断
// 其他插件。
//
// 顺序按插件 id 排序，保证同一链接每次得到相同结果（便于复现与缓存）。
func (h *Host) Resolve(ctx context.Context, url string) (*Result, string, error) {
	h.mu.RLock()
	list := append([]loaded(nil), h.plugins...)
	h.mu.RUnlock()

	if len(list) == 0 {
		return nil, "", ErrNoPluginMatched
	}
	sort.Slice(list, func(i, j int) bool { return list[i].id < list[j].id })

	var failures []string
	for _, l := range list {
		if err := ctx.Err(); err != nil {
			return nil, "", err
		}
		// out 用指针的指针语义：js null 会解成 nil，需要区分「不认领」与「空对象」
		var out *Result
		err := l.p.CallWithin(h.callLimit, ResolveMethod, []any{url}, &out)
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", l.id, err))
			continue
		}
		if out == nil {
			continue // 不认领
		}
		if err := validate(out); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", l.id, err))
			continue
		}
		return out, l.id, nil
	}

	if len(failures) > 0 {
		return nil, "", fmt.Errorf("插件没能解析这个链接：%s", strings.Join(failures, "；"))
	}
	return nil, "", ErrNoPluginMatched
}

// validate 校验插件返回值。
//
// 必须做：插件是第三方代码，返回的形状不对（缺 title、formats 为空、
// 直链不是 http(s)）会让界面显示空白或让下载器去拉一个 `javascript:` 之类的
// 地址。这里**宁可报错也不猜**。
func validate(r *Result) error {
	if strings.TrimSpace(r.Title) == "" {
		return errors.New("插件没有返回标题")
	}
	if len(r.Formats) == 0 && r.DirectURL == "" {
		return errors.New("插件没有返回任何格式或直链")
	}
	for _, f := range r.Formats {
		if strings.TrimSpace(f.FormatID) == "" {
			return errors.New("格式缺少 formatId")
		}
	}
	if r.DirectURL != "" && !isHTTPURL(r.DirectURL) {
		return fmt.Errorf("直链不是 http(s) 地址：%.40s", r.DirectURL)
	}
	return nil
}

func isHTTPURL(u string) bool {
	l := strings.ToLower(u)
	return strings.HasPrefix(l, "http://") || strings.HasPrefix(l, "https://")
}

// stripPathPrefix 去掉错误开头形如 `<某路径>: ` 的前缀。
//
// 只处理「以路径开头」这一种形态：它出现在 os/json 的错误里最常见，
// 也是最容易漏到界面上的。不追求通用脱敏——过度替换会把正常的
// 错误说明也改坏，那时用户看不懂原因，反而更难排查。
func stripPathPrefix(msg string) string {
	// 形如 `/a/b/c.json: invalid character ...`
	if i := strings.Index(msg, ": "); i > 0 {
		head := msg[:i]
		if strings.HasPrefix(head, "/") || (len(head) > 1 && head[1] == ':') ||
			strings.Contains(head, string(os.PathSeparator)+string(os.PathSeparator)) {
			return msg[i+2:]
		}
	}
	return msg
}

// MarshalResult 把结果转成 JSON，供调用方转换时复用（也便于测试快照）。
func MarshalResult(r *Result) ([]byte, error) { return json.Marshal(r) }
