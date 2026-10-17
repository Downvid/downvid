package main

// Wails 桌面壳的入口。
//
// 窗口参数与 Electron 版保持一致（1200×900，最小 1000×700）——用户升级后
// 窗口不该突然变形，那会让「换了个东西」的感觉比实际更强烈。
//
// ## 为什么资源用 //go:embed
//
// 单文件产物（实测 8 MB）的前提是前端已经打进二进制。若改成运行时读目录，
// 就会退化成「一个 exe + 一堆散文件」，反而比 Electron 更难分发。

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "DownVid",
		Width:     1200,
		Height:    900,
		MinWidth:  1000,
		MinHeight: 700,

		AssetServer: &assetserver.Options{Assets: assets},

		OnStartup:  app.startup,
		OnShutdown: app.shutdown,

		// 绑定对象的方法会被生成到 frontend/wailsjs/go/main/App.js。
		// 只绑一个对象：分组多了会让前端 import 路径变复杂，而方法名本身
		// 已经按 `HistoryGet` / `CheckUpdate` 这样分好组了。
		Bind: []any{app},

		// macOS 用隐藏式标题栏 + 内嵌红绿灯，与 Electron 版的外观一致
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
		},
	})
	if err != nil {
		log.Fatalf("[downvid] 启动失败：%v", err)
	}
}
