package parse

import (
	"strings"
	"testing"
)

func TestIsDouyin(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"https://www.douyin.com/video/7123456789012345678", true},
		{"https://v.douyin.com/iabcXYZ/", true},
		{"https://www.iesdouyin.com/share/video/123", true},
		{"https://www.bilibili.com/video/BV1xx411c7mD", false},
	}
	for _, c := range cases {
		if got := IsDouyin(c.url); got != c.want {
			t.Errorf("IsDouyin(%q) = %v, want %v", c.url, got, c.want)
		}
	}
}

func TestBuildDouyinFormats(t *testing.T) {
	bitRate := []douyinBitRateItem{
		{
			GearName: "超清",
			Height:   1080,
			Width:    1920,
			DataSize: 20000000,
			PlayAddr: struct {
				URLList []string `json:"url_list"`
				Height  int      `json:"height"`
				Width   int      `json:"width"`
			}{
				URLList: []string{"https://cdn.douyin.com/1080.mp4"},
			},
		},
		{
			GearName: "高清",
			Height:   720,
			Width:    1280,
			DataSize: 10000000,
			PlayAddr: struct {
				URLList []string `json:"url_list"`
				Height  int      `json:"height"`
				Width   int      `json:"width"`
			}{
				URLList: []string{"https://cdn.douyin.com/720.mp4"},
			},
		},
	}

	formats, direct := buildDouyinFormats(bitRate, 10000, nil, 0, 0, 0)
	if len(formats) != 2 {
		t.Fatalf("len(formats) = %d, want 2", len(formats))
	}
	if formats[0].Height != 1080 || formats[0].Quality != "1080P" {
		t.Errorf("formats[0] should be 1080P, got %+v", formats[0])
	}
	if direct != "https://cdn.douyin.com/1080.mp4" {
		t.Errorf("direct = %q, want 1080 url", direct)
	}
}

func TestIsKuaishou(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"https://www.kuaishou.com/short-video/3x8abcd", true},
		{"https://v.kuaishou.com/f/3x8abcd", true},
		{"https://www.kwai.com/short-video/123", true},
		{"https://www.douyin.com/video/123", false},
	}
	for _, c := range cases {
		if got := IsKuaishou(c.url); got != c.want {
			t.Errorf("IsKuaishou(%q) = %v, want %v", c.url, got, c.want)
		}
	}
}

// 失效短链必须报「视频不存在」而不是「暂不支持该网站」。
//
// 变异点：抖音把失效分享链接 302 到站点首页，重定向结果里没有视频 ID。
// 早先这里返回一条普通 error，被上层**吞掉**后继续交给 yt-dlp，而 yt-dlp
// 收到的是跳转后的首页地址，只回 `Unsupported URL` —— 用户看到「暂不支持
// 该网站或链接类型」，于是一直重试一个永远不会好的链接。
func TestDouyinDeadShortLinkClassified(t *testing.T) {
	if got := ClassifyParseError(errDouyinDeadLink.Error()); got != KindNotFound {
		t.Errorf("失效短链应归类为 %s，got %s", KindNotFound, got)
	}
	if !strings.Contains(errDouyinDeadLink.Error(), "短链已失效") {
		t.Error("错误文案应说清「短链失效」，而不是笼统的「无法解析」")
	}
}
