package update

import (
	"strings"
	"testing"
)

// 批处理的内容决定更新能不能装成功，而且一旦写错只会表现成
// 「点了重启并安装，应用没了」，没有报错可查。这里把关键三段钉住。
//
// 脚本生成本身是纯字符串拼接，所以这些用例在任何平台都能跑。
func TestWindowsUpdateScript(t *testing.T) {
	installer := `C:\Users\me\AppData\Roaming\downvid\pending-update\x-installer.exe`
	exe := `C:\Program Files\DownVid\downvid.exe`
	got := windowsUpdateScript(installer, exe)

	for _, want := range []string{
		// 先等本进程退出，否则 exe 被占用
		"ping -n 4 127.0.0.1 >nul",
		// 静默安装且等待结束
		`start "" /wait "` + installer + `" /S`,
		// 装完重新打开
		`start "" "` + exe + `"`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("批处理缺少 %q\n实际内容：\n%s", want, got)
		}
	}
}

// `%` 在批处理里会被当变量展开；路径含 `%` 时必须写成 `%%`。
func TestWindowsUpdateScriptEscapesPercent(t *testing.T) {
	got := windowsUpdateScript(`C:\100%\setup.exe`, `C:\apps\downvid.exe`)
	if !strings.Contains(got, `C:\100%%\setup.exe`) {
		t.Errorf("百分号没有转义：\n%s", got)
	}
}
