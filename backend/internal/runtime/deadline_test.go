package runtime

import (
	"testing"
	"time"
)

func TestScanExpiredZeroMeansUnlimited(t *testing.T) {
	b := &budget{} // scanDeadline 为零值
	if b.scanExpired(time.Now()) {
		t.Error("零值应视为无期限，否则扫描会静默不做任何事")
	}
	b.scanDeadline = time.Now().Add(-time.Second)
	if !b.scanExpired(time.Now()) {
		t.Error("已过期的时限应判定为超时")
	}
	b.scanDeadline = time.Now().Add(time.Hour)
	if b.scanExpired(time.Now()) {
		t.Error("未到期的时限不应判定为超时")
	}
}

// nil 预算视为无期限而不是已过期。
//
// 与零值同一个理由：nil 解引用会 panic，如果为了防 panic 在到处写
// `if b != nil`，迟早漏一处；让 nil 走「无期限」这条安全路径更稳。
func TestNilBudgetMeansUnlimited(t *testing.T) {
	var b *budget
	if b.scanExpired(time.Now()) {
		t.Error("nil 预算应视为无期限")
	}
	if b.probeBudgetExhausted() {
		t.Error("nil 预算应视为无期限")
	}
}

// setScanBudgetForTest 只调整目录数预算，**同时把时限设为有效值**。
//
// 这是被 CI 抓出来的教训：直接写 `b.scanDirsLeft = N` 而不碰时限时，
// 用例会继承上一个用例留下的过期时限，于是扫描静默不做任何事
// ——单跑通过、全量跑或 -shuffle 时随机失败（典型的状态泄漏）。
func setScanBudgetForTest(n int) *budget {
	return &budget{
		scanDirsLeft: n,
		scanDeadline: time.Now().Add(scanTimeLimit),
	}
}

// 预算必须是**每次探测私有**的对象，不能是包级共享状态。
//
// 回归背景（`go test -race` 抓到的真 DATA RACE）：`FindAllContext` 并行探测
// 四个依赖，早先 `scanDeadline` / `scanDirsLeft` / `probeDeadline` 都是包级变量，
// 四个 goroutine 互相 reset 对方的额度。表现是 Windows 回归里
// 「a-bad 是坏文件、应继续找到 b-valid」始终失败，单跑该用例又必过。
//
// 这里断言的是「两份预算互不影响」，而不是「某个全局变量被重置了」——
// 后者就是上一个版本的写法，它能过是因为它测的对象本身没有并发语义。
func TestBudgetIsPerCallNotGlobal(t *testing.T) {
	a := newBudget()
	b := newBudget()

	a.scanDirsLeft = 7
	a.scanDeadline = time.Now().Add(-time.Second) // 假装 a 已耗尽
	a.probeDeadline = time.Now().Add(-time.Second)

	if b.scanDirsLeft != scanMaxDirs {
		t.Errorf("b.scanDirsLeft = %d，期望满额 %d（预算被串了）", b.scanDirsLeft, scanMaxDirs)
	}
	if b.scanExpired(time.Now()) {
		t.Error("a 的过期时限串到了 b")
	}
	if b.probeBudgetExhausted() {
		t.Error("a 的耗尽的执行预算串到了 b")
	}

	// 反过来再 reset 一次 a，b 仍不受影响
	a.resetScan()
	if a.scanDirsLeft != scanMaxDirs || a.scanExpired(time.Now()) {
		t.Error("resetScan 没有把 a 的扫描预算恢复满额")
	}
	if b.scanDirsLeft != scanMaxDirs {
		t.Error("reset a 影响到了 b")
	}
}
