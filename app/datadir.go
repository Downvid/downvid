package main

// 路径规则在 internal/appdir：桌面壳与 CLI 必须看到同一份数据。
// 这里的薄包装保留给现有调用点与测试，真正的逻辑只有一份。

import "github.com/Downvid/downvid/app/internal/appdir"

func downvidHome() string { return appdir.Home() }

func resolveDataDir() string { return appdir.UserData() }

func resolveDownloadsDir() string { return appdir.DownloadsDir() }

func resolveHistoryPath(dataDir string) string { return appdir.HistoryPath(dataDir) }
