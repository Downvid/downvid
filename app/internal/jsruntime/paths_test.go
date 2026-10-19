package jsruntime

import "testing"

// win32Join 的期望值全部是 Node v22 `path.win32.join` 的实际输出（逐条跑过）。
//
// 交叉验证只覆盖候选表里真的会出现的组合；这里把容易分叉的边角单独钉住：
// 尾分隔符、正斜杠、UNC、`..` 越过根目录、相对路径、只有盘符。
func TestWin32JoinMatchesNode(t *testing.T) {
	cases := []struct {
		elems []string
		want  string
	}{
		{[]string{`C:\Program Files\nodejs\`, "node.exe"}, `C:\Program Files\nodejs\node.exe`},
		{[]string{`C:/Tools/bin/`, "node.exe"}, `C:\Tools\bin\node.exe`},
		{[]string{`D:\nvm\`}, `D:\nvm\`},
		{[]string{`D:/nvm4w/nodejs/`, "node.exe"}, `D:\nvm4w\nodejs\node.exe`},
		{[]string{`\\server\share\tools`, "node.exe"}, `\\server\share\tools\node.exe`},
		{[]string{`\\server\share`}, `\\server\share\`},
		{[]string{`//server/share`, "dir", "node.exe"}, `\\server\share\dir\node.exe`},
		{[]string{`\\\triple`, "x"}, `\triple\x`},
		{[]string{`C:\Users\tester`, "AppData", "Local", "..", "Roaming", "nvm"}, `C:\Users\tester\AppData\Roaming\nvm`},
		{[]string{`C:\a\..\..`, "b"}, `C:\b`},
		{[]string{`relative\bin`, "node.exe"}, `relative\bin\node.exe`},
		{[]string{"..", "x", "..", "..", "y"}, `..\..\y`},
		{[]string{"C:", "node.exe"}, `C:\node.exe`},
		{[]string{"C:..", "x"}, `C:..\x`},
		{[]string{`%USERPROFILE%\bin`, "node.exe"}, `%USERPROFILE%\bin\node.exe`},
		{[]string{"", "", "a"}, "a"},
		{[]string{`C:\x\.\y\`, ".", "z"}, `C:\x\y\z`},
	}
	for _, c := range cases {
		if got := win32Join(c.elems...); got != c.want {
			t.Errorf("win32Join(%q) = %q, Node 给出 %q", c.elems, got, c.want)
		}
	}
}
