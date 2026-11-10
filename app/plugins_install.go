package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Downvid/downvid/app/internal/netx"
	"github.com/Downvid/downvid/app/internal/pluginhost"
	plugin "github.com/yxxbc/mygo-plugin"
)

// PluginProgress 是插件安装/更新的进度事件（通过 plugin:progress 广播）。
type PluginProgress struct {
	ID      string `json:"id"`
	Stage   string `json:"stage"` // resolving / downloading / installing / done / error
	Message string `json:"message,omitempty"`
}

// InstallPlugin 从索引里的一条安装插件。
//
// 走 mygo-plugin 的 GitHub.Install：它负责取 release zip（没有 release 时回落
// 到默认分支源码）、解包、校验 manifest。我们只补三件事：
//   - 用带代理的 HTTP 客户端（否则需要代理的网络下永远装不上）
//   - 装完立刻重扫，让界面马上能用
//   - 把 steps 通过事件推给界面，避免「点了没反应」
func (a *App) InstallPlugin(id string) error {
	entry, err := a.lookupPluginEntry(id)
	if err != nil {
		return err
	}
	client, err := netx.Client(a.currentProxy(), 5*time.Minute)
	if err != nil {
		return err
	}

	a.emitPluginProgress(PluginProgress{ID: id, Stage: "resolving", Message: "正在下载插件…"})

	dir := a.pluginHostDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("创建插件目录失败：%w", err)
	}

	gh := &plugin.GitHub{Client: client}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	a.emitPluginProgress(PluginProgress{ID: id, Stage: "downloading"})
	if _, err := gh.Install(ctx, entry.Repo, dir); err != nil {
		why := humanInstallError(err)
		a.emitPluginProgress(PluginProgress{ID: id, Stage: "error", Message: why})
		return errors.New(why)
	}

	// 装完必须重扫：宿主把插件列表缓存在内存里，不重扫界面看不到
	a.emitPluginProgress(PluginProgress{ID: id, Stage: "installing"})
	if host, err := a.pluginHost(); err == nil && host != nil {
		host.Reload()
	}

	// 装上了但加载失败（契约不符、语法错）要如实报，而不是显示「已安装」
	if host, err := a.pluginHost(); err == nil && host != nil {
		if why, bad := host.Errors()[id]; bad {
			a.emitPluginProgress(PluginProgress{ID: id, Stage: "error", Message: why})
			return fmt.Errorf("已下载但未生效：%s", why)
		}
	}

	a.emitPluginProgress(PluginProgress{ID: id, Stage: "done", Message: "已安装"})
	return nil
}

// UpdatePlugin 重新安装以获取最新版本。
//
// 不做「差量更新」：插件是几十 KB 的 JS，重装比对比版本、挑文件简单得多，
// 而且能顺带修好「本地文件被改坏」的情况。
func (a *App) UpdatePlugin(id string) error {
	// 更新 = 先删旧目录再装。
	//
	// 不能直接复用 InstallPlugin：宿主的 Install 在目标 id 已存在时返回
	// ErrInstalled（"a plugin with this id is already installed"），
	// 于是「点更新」永远失败，而且用户看到的是这句英文原文。
	//
	// 删的是 plugins/<id>，**不动 plugin-data/<id>**：那是插件自己的数据
	// （登录态等），更新不该把它清掉。
	if !pluginhost.ValidPluginID(id) {
		return fmt.Errorf("插件 id 不合法：%q", id)
	}
	dir := a.pluginHostDir()
	if err := os.RemoveAll(filepath.Join(dir, id)); err != nil {
		return fmt.Errorf("清理旧版本失败：%w", err)
	}
	return a.InstallPlugin(id)
}

// humanInstallError 把宿主库的英文错误翻成用户能懂的话。
//
// 实测用户看到的是「示例解析器 needs this app 1.11.0 or later」——
// 一句英文、还夹着插件名，看不出该做什么。这类错误**都是可预期的**
// （版本不够、已装、网络），值得逐条给中文说明；其余保持原文并加前缀，
// 免得把真正的意外吞成一句含糊的话。
func humanInstallError(err error) string {
	if err == nil {
		return ""
	}
	var newer *plugin.NeedsNewerApp
	if errors.As(err, &newer) {
		return fmt.Sprintf("「%s」需要 %s 或更新的 DownVid（当前 %s），请先升级应用",
			newer.Plugin, newer.Version, effectiveVersion())
	}
	if errors.Is(err, plugin.ErrInstalled) {
		// 正常路径不该出现（更新会先删旧目录），出现说明状态不一致
		return "该插件已安装。若要更新请点「更新」；若确认已损坏，请先卸载再装"
	}
	return "安装失败：" + err.Error()
}

// lookupPluginEntry 从索引里找一条。
//
// 找不到就报错而不是「随便装一个」：id 来自界面的列表，能对上索引说明数据是一致的；
// 对不上意味着索引变过或用户在乱传参数。
func (a *App) lookupPluginEntry(id string) (pluginhost.Entry, error) {
	if !pluginhost.ValidPluginID(id) {
		return pluginhost.Entry{}, fmt.Errorf("插件 id 不合法：%q", id)
	}
	client, err := netx.Client(a.currentProxy(), 20*time.Second)
	if err != nil {
		return pluginhost.Entry{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	idx, err := pluginhost.FetchIndex(ctx, client, pluginhost.IndexURL)
	if err != nil {
		return pluginhost.Entry{}, fmt.Errorf("拉取插件索引失败：%w", err)
	}
	for _, e := range idx.Plugins {
		if e.ID == id {
			return e, nil
		}
	}
	return pluginhost.Entry{}, fmt.Errorf("索引里没有 id 为 %q 的插件", id)
}

func (a *App) emitPluginProgress(p PluginProgress) {
	a.emit("plugin:progress", p)
}

// PluginIcon 返回插件的图标：优先 http(s) 地址，其次 emoji，最后用名称首字。
//
// 单独一个绑定而不是让前端从 repo 拼 URL：图标可能是作者放在仓库里的任意文件，
// 也可能是 emoji。前端只负责渲染，判断逻辑留在后端一处。
func (a *App) PluginIcon(id string) string {
	if e, err := a.lookupPluginEntry(id); err == nil && e.Icon != "" {
		return e.Icon
	}
	return ""
}

// pluginDirIsInstalled 报告某个 id 是否已装（目录存在且非空）。
func (a *App) pluginDirIsInstalled(id string) bool {
	if !pluginhost.ValidPluginID(id) {
		return false
	}
	entries, err := os.ReadDir(filepath.Join(a.pluginHostDir(), id))
	if err != nil {
		return false
	}
	for _, e := range entries {
		// manifest 存在才算「装了」：空目录是下载失败留下的
		if strings.EqualFold(e.Name(), "plugin.json") {
			return true
		}
	}
	return false
}
