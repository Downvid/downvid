// Package pluginhost —— 插件仓库的风险声明校验。
//
// ## 为什么这是一道硬门槛
//
// 插件能联网、能读自己的数据目录。一旦用户因为某个插件出了事（被平台封号、
// 数据被外传、插件本身违法），第一反应会是找 DownVid——因为插件是从我们的
// 索引里装的。所以收录与安装都要求插件仓库**自己承担风险**，并且这句话必须
// 出现在那个仓库里，而不是只写在我们这边。
//
// ## 为什么检查 README 而不是靠人工看
//
// 人工看会漏：作者更新 README 删掉那句话，没人会发现，而下一次自动收录
// 又把它加回索引。所以把它变成每次收录/安装都跑一遍的机器检查。
package pluginhost

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DisclaimerVersion 是当前要求的声明版本。
//
// 作者在 README 里写 `DownVid-Plugin-Disclaimer: 1` 就表示同意第 1 版声明。
// 将来若要把责任范围写得更细（例如要求注明许可证），升这个版本号，
// 旧插件会立刻被要求更新声明——**这是有意的**：责任条款变了，
// 就不该默认沿用旧同意。
const DisclaimerVersion = 1

// disclaimerMarker 是 README 里必须出现的一行。
//
// 用 HTML 注释形式：渲染出来看不见，但机器能读到。要求写成注释是因为
// 它是一句**声明**，不是给用户读的介绍——放在正文里会显得突兀，
// 而作者往往还想在 README 顶部放演示图。
const disclaimerMarker = "DownVid-Plugin-Disclaimer:"

// ReadmeMaxBytes 限制读取的 README 大小。
//
// 有些 README 带几十张图与徽章，几 MB 很常见；这里只需要找一行标记。
const ReadmeMaxBytes = 512 << 10

// DisclaimerError 表示插件仓库没有满足风险声明要求。
//
// 单独一个类型（而不是普通 error）：调用方要能把它与「网络失败」区分开——
// 前者该显示成「作者需要补一句声明」，后者该显示成「稍后再试」。
type DisclaimerError struct {
	Repo   string
	Reason string
}

func (e *DisclaimerError) Error() string {
	return fmt.Sprintf("%s 不满足收录与安装要求：%s", e.Repo, e.Reason)
}

// DisclaimerHint 是给作者看的具体做法。
//
// 单独给一段而不是塞进 Error()：这句话要能直接复制到 Issue 回复里，
// 内容固定、不带任何动态值。
const DisclaimerHint = "请在插件仓库的 README.md 里加入下面这行（HTML 注释，渲染时不可见）：\n\n" +
	"<!-- DownVid-Plugin-Disclaimer: 1 -->\n\n" +
	"并在 README 正文里写明：本插件由插件作者独立开发与维护，使用本插件产生的一切风险与后果" +
	"（包括但不限于账号受限、数据丢失、内容合规）由插件作者与使用者承担，与 DownVid 项目无关。\n\n" +
	"加了之后重新运行收录即可。"

// CheckDisclaimer 检查 README 内容是否满足要求。
//
// 做两件事：
//  1. 必须有 `DownVid-Plugin-Disclaimer: <版本>` 且版本不小于要求
//  2. 正文必须出现「风险」与「无关」两类关键词——只写标记不写正文，
//     等于作者没真正向使用者交代，标记就退化成一张通行证
//
// 第 2 条刻意宽松（不匹配整句）：作者可以用自己的话讲，只要把这件事说到了。
// 卡死措辞会让正常作者被拒，而想钻空子的人抄一遍原文也就过了——真正的防线
// 是「这句话出现在他自己的仓库里」，而不是措辞一致。
func CheckDisclaimer(repo, readme string) error {
	if strings.TrimSpace(readme) == "" {
		return &DisclaimerError{Repo: repo, Reason: "仓库没有 README"}
	}

	lower := strings.ToLower(readme)
	if !strings.Contains(lower, strings.ToLower(disclaimerMarker)) {
		return &DisclaimerError{Repo: repo, Reason: "README 缺少风险声明标记"}
	}

	// 取标记后的版本号；形如 `DownVid-Plugin-Disclaimer: 1`
	idx := strings.Index(lower, strings.ToLower(disclaimerMarker))
	rest := readme[idx+len(disclaimerMarker):]
	rest = strings.TrimLeft(rest, " \t")
	// 必须先判断「有没有写数字」，再看数值大小。
	// 混在一起时，写成 `: 0` 的 README 会被报成「缺少版本号」——
	// 作者看着标记明明写了版本号，只会更困惑。
	digits := 0
	ver := 0
	for _, r := range rest {
		if r < '0' || r > '9' {
			break
		}
		digits++
		ver = ver*10 + int(r-'0')
	}
	if digits == 0 {
		return &DisclaimerError{Repo: repo, Reason: "声明标记缺少版本号"}
	}
	if ver < DisclaimerVersion {
		return &DisclaimerError{
			Repo:   repo,
			Reason: fmt.Sprintf("声明版本 %d 过旧，当前要求 %d", ver, DisclaimerVersion),
		}
	}

	// 正文必须自己讲到「风险」与「无关」——只有标记的 README 不算同意
	hasRisk := strings.Contains(readme, "风险") || strings.Contains(lower, "risk")
	hasScope := strings.Contains(readme, "无关") || strings.Contains(lower, "not affiliated") ||
		strings.Contains(lower, "not responsible") || strings.Contains(readme, "不承担")
	if !hasRisk || !hasScope {
		return &DisclaimerError{
			Repo:   repo,
			Reason: "README 正文没有写明风险由插件作者承担、与 DownVid 无关",
		}
	}
	return nil
}

// FetchReadme 取仓库默认分支的 README.md。
//
// 依次试 README.md / readme.md / README.markdown：GitHub 上这几种都常见，
// 只认一种会让一部分正常作者莫名被拒。
func FetchReadme(ctx context.Context, client *http.Client, repo string) (string, error) {
	if !ValidRepo(repo) {
		return "", &DisclaimerError{Repo: repo, Reason: "不是 owner/name 形态"}
	}
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}

	var lastErr error
	for _, name := range []string{"README.md", "readme.md", "README.markdown"} {
		url := fmt.Sprintf("https://raw.githubusercontent.com/%s/HEAD/%s", repo, name)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return "", err
		}
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode == http.StatusNotFound {
			resp.Body.Close()
			continue
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			lastErr = fmt.Errorf("取 README 失败：HTTP %d", resp.StatusCode)
			continue
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, ReadmeMaxBytes))
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		return string(body), nil
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", &DisclaimerError{Repo: repo, Reason: "仓库没有 README.md"}
}

// VerifyRepoDisclaimer 取 README 并检查声明。
//
// 安装与收录都调用它：收录时挡住，安装时再挡一次——索引可能收录之后
// 作者把 README 改了，而用户是在之后才点安装的。
func VerifyRepoDisclaimer(ctx context.Context, client *http.Client, repo string) error {
	readme, err := FetchReadme(ctx, client, repo)
	if err != nil {
		return err
	}
	return CheckDisclaimer(repo, readme)
}
