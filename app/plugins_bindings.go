package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Downvid/downvid/app/internal/netx"
	"github.com/Downvid/downvid/app/internal/pluginhost"
)

// PluginEntryView 是插件列表里的一条，供界面渲染。
//
// 与 pluginhost.Entry 分开：这一层要带上**本机状态**（装了没有、加载是否成功），
// 而那些不是索引的一部分。前端只读这个结构，不必自己 merge 两份数据。
type PluginEntryView struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Repo        string   `json:"repo"`
	Author      string   `json:"author,omitempty"`
	Sites       []string `json:"sites,omitempty"`
	// Icon 是 emoji 或 http(s) 图片地址；空则界面用名称首字。
	Icon string `json:"icon,omitempty"`
	// Version 是索引里记录的最新版本。
	Version string `json:"version,omitempty"`
	// InstalledVersion 是本机已安装的版本（未装时为空）。
	InstalledVersion string `json:"installedVersion,omitempty"`
	// Installed 表示本机 plugins/<id> 目录存在且含 plugin.json。
	Installed bool `json:"installed"`
	// LoadError 非空表示目录在但加载失败（契约不符、语法错误等），
	// 界面据此显示「已安装但未生效」而不是让用户以为装成功了。
	LoadError string `json:"loadError,omitempty"`
}

// PluginListView 是插件页的完整数据。
type PluginListView struct {
	Entries []PluginEntryView `json:"entries"`
	// IndexError 非空表示拉取索引失败（离线、限流、仓库还没建）。
	// 此时 Entries 仍然带上**已安装的插件**——断网时用户至少要能看见装了什么。
	IndexError string `json:"indexError,omitempty"`
	// Dir 是插件目录，界面用来提示用户「手动放到这里」。
	Dir string `json:"dir"`
}

// ListPlugins 返回插件列表：索引里的条目 + 本机已安装的那些。
//
// 合并策略：以索引为主，再把「装了但索引里没有」的插件补在后面。
// 后者是常见的开发态（作者本地试装），不该因为还没被收录就从界面消失。
func (a *App) ListPlugins() PluginListView {
	view := PluginListView{Dir: a.pluginHostDir()}

	installed := a.installedPluginDirs()

	// 拉索引：走代理设置，与依赖探测同一套（否则需要代理的网络下永远空列表）
	client, err := netx.Client(a.currentProxy(), 20*time.Second)
	if err != nil {
		view.IndexError = err.Error()
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if idx, err := pluginhost.FetchIndex(ctx, client, pluginhost.IndexURL); err != nil {
			view.IndexError = err.Error()
		} else {
			for _, e := range idx.Plugins {
				view.Entries = append(view.Entries, PluginEntryView{
					ID: e.ID, Name: e.Name, Description: e.Description,
					Repo: e.Repo, Author: e.Author, Sites: e.Sites,
					Icon:      e.Icon,
					Version:   e.Version,
					Installed: installed[e.ID],
				})
			}
		}
	}

	// 索引里没有、但本机装了的：补上（开发态与索引滞后都能覆盖）
	seen := map[string]bool{}
	for _, e := range view.Entries {
		seen[e.ID] = true
	}
	for id := range installed {
		if seen[id] {
			continue
		}
		view.Entries = append(view.Entries, PluginEntryView{
			ID: id, Name: id, Installed: true,
			Description: "本机已安装（不在索引中）",
		})
	}

	// 本机已装版本的版本号：界面用它判断「可更新」
	for i := range view.Entries {
		if view.Entries[i].Installed {
			view.Entries[i].InstalledVersion = readInstalledPluginVersion(a.pluginHostDir(), view.Entries[i].ID)
		}
	}

	// 加载失败的原因填进去，让「已安装但没生效」可见
	if host, err := a.pluginHost(); err == nil && host != nil {
		errs := host.Errors()
		for i := range view.Entries {
			if why, ok := errs[view.Entries[i].ID]; ok {
				view.Entries[i].LoadError = why
			}
		}
	}
	return view
}

// installedPluginDirs 返回本机 plugins 目录下已有的插件 id。
//
// 只列目录不看内容：能列出目录就说明「装过」，至于能不能加载由 host 判断。
func (a *App) installedPluginDirs() map[string]bool {
	out := map[string]bool{}
	entries, err := os.ReadDir(a.pluginHostDir())
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() && e.Name()[0] != '.' {
			out[e.Name()] = true
		}
	}
	return out
}

// ReloadPlugins 重新扫描插件目录，返回最新列表。
//
// 安装/卸载之后必须调用：宿主在首次使用时初始化并把插件列表缓存在内存里，
// 不重扫的话用户装完看不到变化。
func (a *App) ReloadPlugins() PluginListView {
	if host, err := a.pluginHost(); err == nil && host != nil {
		host.Reload()
	}
	return a.ListPlugins()
}

// UninstallPlugin 删除一个已安装的插件。
//
// 只删 plugins/<id>，**不动 plugin-data/<id>**：那里面是插件自己的数据，
// 用户可能还想留着（例如登录态）。要清数据得单独做，不能让卸载顺手删掉。
func (a *App) UninstallPlugin(id string) error {
	if !pluginhost.ValidPluginID(id) {
		return fmt.Errorf("插件 id 不合法：%q", id)
	}
	dir := filepath.Join(a.pluginHostDir(), id)
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("卸载插件失败：%w", err)
	}
	return nil
}

// readInstalledPluginVersion 读本机插件的版本号。
//
// 读失败返回空串而不是报错：版本号只用于「能否更新」的提示，
// 读不到时界面显示「已安装」，不影响使用。
func readInstalledPluginVersion(pluginsDir, id string) string {
	if !pluginhost.ValidPluginID(id) {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(pluginsDir, id, "plugin.json"))
	if err != nil {
		return ""
	}
	var m struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	return strings.TrimSpace(m.Version)
}
