package main

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"time"

	"github.com/Downvid/downvid/app/internal/parse"
	"github.com/Downvid/downvid/app/internal/pluginhost"
)

// plugins 是插件宿主的惰性单例。
//
// 惰性而不是启动时创建：绝大多数用户没装插件，而扫描目录 + 读 manifest
// + 起 moejs 实例是有代价的。第一次调用 Parse 时才初始化，之后复用。
var (
	pluginsOnce sync.Once
	pluginsInst *pluginhost.Host
	pluginsErr  error
)

// pluginHostDir 返回插件根目录（userData/plugins）。
//
// 放在 userData 下而不是程序目录：程序目录在 macOS 的 .app 包里，
// 签名后写入会破坏签名；Windows 装在 Program Files 时普通用户也无权写。
func (a *App) pluginHostDir() string {
	return filepath.Join(a.dataDir, "plugins")
}

// pluginDataDir 返回插件私有数据目录（userData/plugin-data）。
func (a *App) pluginDataDir() string {
	return filepath.Join(a.dataDir, "plugin-data")
}

// pluginHost 返回插件宿主（首次调用时初始化）。
func (a *App) pluginHost() (*pluginhost.Host, error) {
	pluginsOnce.Do(func() {
		pluginsInst = pluginhost.New(pluginhost.HostOptions{
			Dir:        a.pluginHostDir(),
			DataDir:    a.pluginDataDir(),
			AppVersion: version,
			// 单次调用 20 秒：解析插件要联网，但超过 20 秒基本是挂住了。
			// 比解析器整体的 90 秒短得多，免得一个卡死的插件拖住整条链路。
			CallTimeout: 20 * time.Second,
			// nil 表示「按插件 manifest 的 permissions.network 逐条放行」。
			// 不给「全都允许」的捷径：插件是第三方代码，联网能力必须逐条声明。
			Allowed: nil,
		})
	})
	return pluginsInst, pluginsErr
}

// tryPlugins 询问已安装插件。
//
// 返回 (info, 插件id, err)：
//   - info 非 nil：解析成功，调用方直接用它
//   - info 为 nil 且 err 为 ErrNoPluginMatched：没有插件认领，**正常情况**
//   - info 为 nil 且 err 非 nil：插件出错，调用方应继续尝试其他解析路径
func (a *App) tryPlugins(url string) (*parse.VideoInfo, string, error) {
	host, err := a.pluginHost()
	if err != nil {
		return nil, "", err
	}
	if host == nil || !host.HasPlugins() {
		return nil, "", pluginhost.ErrNoPluginMatched
	}

	// 给一个略小于宿主的总时限：插件内部还有自己的单次调用超时，
	// 这里兜住「插件数量多、逐个超时」把整次解析拖到分钟级。
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	res, pluginID, err := host.Resolve(ctx, url)
	if err != nil {
		return nil, "", err
	}
	return pluginResultToInfo(res, url), pluginID, nil
}

// pluginResultToInfo 把插件结果转成界面认识的 VideoInfo。
//
// 转换是**显式逐字段**的，不用 JSON 往返：两边结构相似但语义不同
// （插件的 formats 没有 parse.Format 的内部排序字段，直链的语义也不一样）。
// 走反射式转换会在任一侧加字段时静默丢数据。
func pluginResultToInfo(r *pluginhost.Result, url string) *parse.VideoInfo {
	formats := make([]parse.Format, 0, len(r.RawFormats()))
	for _, f := range r.RawFormats() {
		formats = append(formats, parse.Format{
			FormatID: f.FormatID,
			Quality:  f.Quality,
			Ext:      f.Ext,
			Filesize: f.Filesize,
			Width:    f.Width,
			Height:   f.Height,
			FPS:      f.FPS,
			HasAudio: f.HasAudio,
		})
	}

	pageURL := r.WebpageURL
	if pageURL == "" {
		pageURL = url
	}
	title := r.Title
	if title == "" {
		title = "未知标题"
	}

	return &parse.VideoInfo{
		ID:          r.ID,
		Title:       title,
		Description: r.Description,
		Thumbnail:   r.Thumbnail,
		Duration:    r.Duration,
		Uploader:    r.Uploader,
		WebpageURL:  pageURL,
		Formats:     formats,
		// 直链原样带过去：有它时下载走 fetch 直连，不经过 yt-dlp
		DirectURL:   r.DirectURL,
		ParseNotice: r.Notice,
	}
}

// 编译期确认：插件宿主的「没匹配」是可直接 errors.Is 判断的哨兵错误。
var _ = errors.Is(pluginhost.ErrNoPluginMatched, pluginhost.ErrNoPluginMatched)
