package update

// 自更新安装脚本（Windows）。
//
// 单独放在无平台约束的文件里：脚本内容只是字符串拼接，属于**纯逻辑**，
// 可以在任何平台上断言。真正的启动逻辑在 install_windows.go。

import "strings"

// windowsUpdateScript 生成安装批处理的内容。
//
// 三件事缺一不可：
//   - **等本进程退出**：安装器要覆盖正在运行的 downvid.exe，文件被占用时
//     NSIS 会直接写入失败；
//   - **start /wait**：批处理里直接调用 GUI 程序不会等待，安装还没结束就
//     启动了旧版本，文件又被锁回去；
//   - **重新启动**：Wails 的 NSIS 模板装完不会自动打开应用，不补这一步，
//     用户看到的是「点了重启并安装，应用没了」。
func windowsUpdateScript(installerPath, exePath string) string {
	// cmd 会展开 `%VAR%`；路径里出现 `%` 时必须写成 `%%`。
	escape := func(p string) string {
		return strings.ReplaceAll(p, "%", "%%")
	}
	return "@echo off\r\n" +
		// 等本进程退出。ping 比 timeout 稳：没有控制台或输入被重定向时
		// timeout 会直接报错（不会真的等）。
		"ping -n 4 127.0.0.1 >nul\r\n" +
		// 批处理里直接调用 GUI 程序不会等待，必须 start /wait。
		"start \"\" /wait \"" + escape(installerPath) + "\" /S\r\n" +
		"start \"\" \"" + escape(exePath) + "\"\r\n"
}
