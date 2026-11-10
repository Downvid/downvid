package main

import (
	"testing"

	"github.com/Downvid/downvid/app/internal/pluginhost"
)

// 插件结果转 VideoInfo 时**每个字段都要落到**。
//
// 变异点：这类转换最容易出的错是「漏一个字段」——不报错、不崩，
// 只是界面上某处永远空白（比如封面、时长），而两边单测都绿。
// 所以这里逐字段断言，而不是只比对长度。
func TestPluginResultToInfoKeepsEveryField(t *testing.T) {
	res := &pluginhost.Result{
		ID:          "BV1xx",
		Title:       "标题",
		Description: "描述",
		Thumbnail:   "https://i0.hdslb.com/cover.jpg",
		Duration:    123.5,
		Uploader:    "UP主",
		WebpageURL:  "https://www.bilibili.com/video/BV1xx",
		DirectURL:   "https://cdn.example.com/v.mp4",
		Notice:      "已选取无水印版本",
	}
	// 借 validate 保证格式不为空：插件返回值必须过校验才会被转换
	info := pluginResultToInfo(res, "https://fallback.example.com/v")

	if info.ID != res.ID {
		t.Errorf("ID 丢了：%q", info.ID)
	}
	if info.Title != res.Title {
		t.Errorf("Title 丢了：%q", info.Title)
	}
	if info.Description != res.Description {
		t.Errorf("Description 丢了：%q", info.Description)
	}
	if info.Thumbnail != res.Thumbnail {
		t.Errorf("Thumbnail 丢了：%q", info.Thumbnail)
	}
	if info.Duration != res.Duration {
		t.Errorf("Duration 丢了：%v", info.Duration)
	}
	if info.Uploader != res.Uploader {
		t.Errorf("Uploader 丢了：%q", info.Uploader)
	}
	if info.WebpageURL != res.WebpageURL {
		t.Errorf("WebpageURL 丢了：%q", info.WebpageURL)
	}
	// 直链决定下载是否绕开 yt-dlp，丢了会让下载走错路径
	if info.DirectURL != res.DirectURL {
		t.Errorf("DirectURL 丢了：%q", info.DirectURL)
	}
	if info.ParseNotice != res.Notice {
		t.Errorf("Notice 丢了：%q", info.ParseNotice)
	}
}

// 插件没给 webpageURL 时回落到原始 url，不能留空。
//
// 变异点：留空会让「下载历史」按 URL 去重失效（每条都算新链接），
// 也会让界面上的域名显示成空。
func TestPluginResultFallsBackToInputURL(t *testing.T) {
	info := pluginResultToInfo(&pluginhost.Result{Title: "t"}, "https://example.com/v/1")
	if info.WebpageURL != "https://example.com/v/1" {
		t.Errorf("应回落到入参 url，got %q", info.WebpageURL)
	}
}

// 插件没给标题时不能留空串（界面会显示一块空白）。
func TestPluginResultFallsBackToDefaultTitle(t *testing.T) {
	info := pluginResultToInfo(&pluginhost.Result{WebpageURL: "https://x/1"}, "https://x/1")
	if info.Title == "" {
		t.Error("标题为空会让界面显示空白")
	}
}
