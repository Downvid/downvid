package pluginhost

import (
	"errors"
	"strings"
	"testing"
)

const goodReadme = `# my plugin

[![badge](https://img.shields.io/x)](https://example.com)

<!-- DownVid-Plugin-Disclaimer: 1 -->

本插件由插件作者独立开发与维护。使用本插件产生的一切风险与后果
（包括但不限于账号受限、数据丢失、内容合规）由插件作者与使用者承担，
与 DownVid 项目无关。

## 安装

把目录放进 plugins/ 即可。
`

func TestCheckDisclaimerAccepts(t *testing.T) {
	if err := CheckDisclaimer("a/b", goodReadme); err != nil {
		t.Fatalf("合规的 README 应通过：%v", err)
	}
}

// 没有标记就不能收录/安装。
//
// 变异点：只查正文关键词、不要求标记时，作者把声明写在 Issue 里也算过——
// 而我们要的是「这句话出现在**插件仓库**里」，标记是那件事的可校验凭据。
func TestCheckDisclaimerRequiresMarker(t *testing.T) {
	noMarker := strings.Replace(goodReadme, "<!-- DownVid-Plugin-Disclaimer: 1 -->", "", 1)
	err := CheckDisclaimer("a/b", noMarker)
	if err == nil {
		t.Fatal("缺少标记应被拒")
	}
	var de *DisclaimerError
	if !errors.As(err, &de) {
		t.Fatalf("应返回 DisclaimerError 供调用方区分网络失败，got %T", err)
	}
	// **必须锁定确切的 error 原因**：只断言「报错了」拦不住变异——
	// 去掉标记检查后，版本号会解析成 0，随后报「声明标记缺少版本号」，
	// 照样是 DisclaimerError，用例照样绿。
	if !strings.Contains(de.Reason, "缺少风险声明标记") {
		t.Errorf("原因应明确指出缺标记，got：%q", de.Reason)
	}
}

// 只有标记、正文没交代 → 不算同意。
//
// 变异点：只查标记时，作者复制一行注释就通过，而用户完全不知道风险由谁承担——
// 那行注释本来就是渲染不可见的。
func TestCheckDisclaimerRequiresBodyStatement(t *testing.T) {
	onlyMarker := "<!-- DownVid-Plugin-Disclaimer: 1 -->\n\n# plugin\n\n就是一个小工具。\n"
	err := CheckDisclaimer("a/b", onlyMarker)
	if err == nil {
		t.Fatal("只有标记、正文没写风险归属，应被拒")
	}
	var de *DisclaimerError
	if !errors.As(err, &de) || !strings.Contains(de.Reason, "正文") {
		t.Errorf("原因应指出正文缺失：%v", err)
	}
}

// 版本过旧要拒：责任条款变了，不该默认沿用旧同意。
func TestCheckDisclaimerRejectsOldVersion(t *testing.T) {
	old := strings.Replace(goodReadme, "DownVid-Plugin-Disclaimer: 1", "DownVid-Plugin-Disclaimer: 0", 1)
	if err := CheckDisclaimer("a/b", old); err == nil {
		t.Fatal("版本 0 应被拒")
	} else {
		var de *DisclaimerError
		// 必须锁定「版本过旧」这个原因：去掉版本比较后，ver=0 仍可能被
		// 「版本号缺失」兜住，用例照样绿，而真正的降级（接受旧版声明）没被发现。
		if !errors.As(err, &de) || !strings.Contains(de.Reason, "过旧") {
			t.Errorf("应说明版本过旧，got：%v", err)
		}
	}
	// 缺版本号也要拒
	noVer := strings.Replace(goodReadme, "DownVid-Plugin-Disclaimer: 1", "DownVid-Plugin-Disclaimer:", 1)
	if err := CheckDisclaimer("a/b", noVer); err == nil {
		t.Fatal("缺版本号应被拒")
	}
}

// 英文 README 也可以（作者不一定是中文作者）。
func TestCheckDisclaimerAcceptsEnglish(t *testing.T) {
	en := `# plugin
<!-- DownVid-Plugin-Disclaimer: 1 -->

This plugin is written and maintained by its author. Any risk from using it
is borne by the author and the user; this project is not responsible and
not affiliated with it.
`
	if err := CheckDisclaimer("a/b", en); err != nil {
		t.Fatalf("英文声明应被接受：%v", err)
	}
}

// 空 README 要有明确原因，而不是当成「没写关键词」。
func TestCheckDisclaimerEmpty(t *testing.T) {
	err := CheckDisclaimer("a/b", "   \n")
	var de *DisclaimerError
	if !errors.As(err, &de) {
		t.Fatalf("应返回 DisclaimerError，got %v", err)
	}
	if !strings.Contains(de.Reason, "README") {
		t.Errorf("应说清是缺 README：%q", de.Reason)
	}
}

// 给作者的做法要能直接复制，且必须包含可用的标记。
func TestDisclaimerHintIsActionable(t *testing.T) {
	if !strings.Contains(DisclaimerHint, "DownVid-Plugin-Disclaimer:") {
		t.Error("提示里必须给出可直接复制的标记")
	}
	if !strings.Contains(DisclaimerHint, "README.md") {
		t.Error("提示要说明写在哪个文件")
	}
}
