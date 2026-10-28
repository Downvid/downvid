package update

import "testing"

func TestNormalizeSource(t *testing.T) {
	for _, id := range SourceIDs {
		if got := NormalizeSource(string(id)); got != id {
			t.Errorf("NormalizeSource(%q) = %q, want %q", id, got, id)
		}
	}
	for _, old := range []string{"jsdelivr", "ghproxy", "website", "", "not-a-source"} {
		if got := NormalizeSource(old); got != SourceAuto {
			t.Errorf("旧值 %q 应回退 auto，实际 %q", old, got)
		}
	}
	if got := NormalizeSource(nil); got != SourceAuto {
		t.Errorf("nil 应回退 auto，实际 %q", got)
	}
}

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.2.3", "1.2.3", 0},
		{"v1.2.3", "1.2.3", 0},
		{"1.2.3", "1.2.4", -1},
		{"1.10.0", "1.9.9", 1},
		{"2.0.0", "1.99.99", 1},
		{"1.0.0", "1.0.0-beta.1", -1},
	}
	for _, tc := range cases {
		if got := CompareVersions(tc.a, tc.b); got != tc.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
}
