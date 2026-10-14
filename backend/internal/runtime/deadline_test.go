package runtime

import (
	"testing"
	"time"
)

func TestScanExpiredZeroMeansUnlimited(t *testing.T) {
	scanDeadline = time.Time{} // 零值
	if scanExpired(time.Now()) {
		t.Error("零值应视为无期限，否则扫描会静默不做任何事")
	}
	scanDeadline = time.Now().Add(-time.Second)
	if !scanExpired(time.Now()) {
		t.Error("已过期的时限应判定为超时")
	}
	scanDeadline = time.Now().Add(time.Hour)
	if scanExpired(time.Now()) {
		t.Error("未到期的时限不应判定为超时")
	}
}

// setScanBudgetForTest 只调整目录数预算，**同时把时限设为有效值**。
//
// 这是被 CI 抓出来的教训：直接写 `scanDirsLeft = N` 而不碰时限时，
// 用例会继承上一个用例留下的过期时限，于是扫描静默不做任何事
// ——单跑通过、全量跑或 -shuffle 时随机失败（典型的状态泄漏）。
func setScanBudgetForTest(n int) {
	scanDirsLeft = n
	scanDeadline = time.Now().Add(scanTimeLimit)
}
