package probe

import "testing"

func TestCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"2026.08.19", "2026.10.10.233141", -1},
		{"2026.10.10.233141", "2026.10.10.233141", 0},
		{"2026.10.11", "2026.10.10.233141", 1},
		{"2025.12.31", "2026.01.01", -1},
		{"6.0", "4", 1},
		{"", "2026.01.01", -1}, // 空版本按最小处理；「未知不判定」的规则在 IsOlder
	}
	for _, c := range cases {
		if got := CompareVersions(c.a, c.b); got != c.want {
			t.Errorf("CompareVersions(%q,%q)=%d want %d", c.a, c.b, got, c.want)
		}
	}
	if !IsOlder("2026.08.19", "2026.10.10.233141") {
		t.Error("2026.08.19 应判为过旧")
	}
	if IsOlder("2026.10.10.233141", "2026.10.10.233141") {
		t.Error("同版本不应判为过旧")
	}
	// 版本未知时不判定为过旧（避免把探测失败误报成"版本太旧"）
	if IsOlder("", "2026.10.10") {
		t.Error("空版本不应判为过旧")
	}
	if IsOlder("2026.08.19", "") {
		t.Error("门槛为空时不应判为过旧")
	}
}
