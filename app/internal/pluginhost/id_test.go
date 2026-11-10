package pluginhost

import (
	"os"
	"path/filepath"
	"testing"
)

// 插件 id 会被拼进 os.RemoveAll 的路径，必须严格白名单。
//
// 变异点：只做「不含 ..」这类粗略检查时，`a/b` 或带空格的名字仍能穿过，
// 而卸载一个恶意构造的 id 可能删掉插件目录之外的东西。
func TestValidPluginID(t *testing.T) {
	good := []string{"bilibili", "a1", "my-plugin", "x"}
	bad := []string{
		"", "-leading", "Upper", "a/b", "a\\b", "..", ".", "a b",
		"a.b", "a_b", "../../etc", "a\x00b", string(make([]byte, 80)),
	}
	for _, s := range good {
		if !ValidPluginID(s) {
			t.Errorf("%q 应合法", s)
		}
	}
	for _, s := range bad {
		if ValidPluginID(s) {
			t.Errorf("%q 应被拒绝（会拼进文件路径）", s)
		}
	}
}

// 卸载只删 plugins/<id>，绝不能碰 plugin-data/<id>。
//
// 变异点：顺手清数据会让用户丢掉插件的登录态；更糟的是路径拼错时
// 可能删到别的插件。这条用例直接在真实目录结构上验证。
func TestUninstallKeepsPluginData(t *testing.T) {
	root := t.TempDir()
	plugins := filepath.Join(root, "plugins")
	data := filepath.Join(root, "plugin-data")

	if err := os.MkdirAll(filepath.Join(plugins, "demo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(data, "demo"), 0o755); err != nil {
		t.Fatal(err)
	}
	// 另一个插件必须毫发无损
	if err := os.MkdirAll(filepath.Join(plugins, "other"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := os.RemoveAll(filepath.Join(plugins, "demo")); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(plugins, "demo")); !os.IsNotExist(err) {
		t.Error("插件目录应被删除")
	}
	if _, err := os.Stat(filepath.Join(data, "demo")); err != nil {
		t.Error("插件数据目录不该被删除（那是用户的数据）")
	}
	if _, err := os.Stat(filepath.Join(plugins, "other")); err != nil {
		t.Error("其他插件不该被牵连")
	}
}
