// Package fetch 实现直链分块下载与续传。
//
// 本文件是 electron/download/direct-state.ts 的 Go 移植，对应 4 组 vitest 用例
// （其中一组是 `it.each` 展开成 4 条，共 7 条断言）。
//
// 这些规则守护的是「暂停后能不能接着下」：判断错一次，用户就丢一次进度；
// 判断错得宽松，会把两个不同文件的片段拼起来，产出损坏的视频（比丢进度更糟）。
package fetch

import (
	"fmt"
	"math"
)

// Unit 是分段的最小粒度（1 MiB）。
const Unit = 1024 * 1024

// MaxSegments 是分段的硬上限。
//
// 检查点会被写进 `.part.json` 并在恢复时读回，段数失控会让文件大得离谱；
// 同时 `canResumeDirect` 用它拒绝明显损坏的数据。
const MaxSegments = 4096

// Resource 标识「这份数据的来源」。
//
// 四个字段缺一不可：URL 相同但 etag/lastModified 变了说明远端内容已换，
// 此时拼接旧片段会得到损坏文件；total 变了同理。
type Resource struct {
	URL          string `json:"url"`
	Total        int64  `json:"total"`
	ETag         string `json:"etag"`
	LastModified string `json:"lastModified"`
}

// Segment 是一个下载分段。
//
// Start/End 是**请求区间**（End 不含，即 HTTP Range 的 end = End-1）；
// Offset 是**已写入的字节数**（从 Start 起算的绝对位置）。
type Segment struct {
	Start  int64 `json:"start"`
	End    int64 `json:"end"`
	Offset int64 `json:"offset"`
}

// Checkpoint 是落盘的续传检查点。
type Checkpoint struct {
	Resource
	Segments []Segment `json:"segments"`
}

// CreateDirectSegments 按总大小规划分段。
//
// 多个小块由固定数量的工作连接领取，**快连接不必等待慢连接的大段**——
// 这是「分块队列」相对「四段均分」的核心改进：后者里最慢的那一段决定总耗时。
func CreateDirectSegments(total int64, connections int) []Segment {
	if connections <= 0 {
		connections = 8
	}
	var size int64
	if connections <= 1 {
		size = total
	} else {
		// 目标段数 = connections * 8（每连接约 8 个块，便于负载均衡），
		// 但不超过 MaxSegments；每段至少 Unit（太小会让请求开销超过收益）。
		target := connections * 8
		if target > MaxSegments {
			target = MaxSegments
		}
		size = int64(math.Ceil(float64(total)/float64(target)/float64(Unit))) * Unit
		if size < Unit {
			size = Unit
		}
	}
	if total <= 0 {
		return []Segment{}
	}
	count := int((total + size - 1) / size)
	out := make([]Segment, 0, count)
	for i := 0; i < count; i++ {
		start := int64(i) * size
		end := start + size
		if end > total {
			end = total
		}
		out = append(out, Segment{Start: start, End: end, Offset: start})
	}
	return out
}

// isSafeInt 对应 TS 的 Number.isSafeInteger：
// 检查点来自磁盘，可能是手改过或旧版本写的，必须防住小数与溢出。
//
// Go 的 int64 天然是整数，所以只需防「超出 JS 安全整数范围」——
// 超过 2^53 的值在 JS 侧解析时就已经失真，两侧对同一份数据的理解会不同。
func isSafeInt(v int64) bool {
	const maxSafe = int64(1)<<53 - 1
	return v >= -maxSafe && v <= maxSafe
}

// CanResumeDirect 判断检查点是否可以续传。
//
// 只接受**同一资源**的逐段检查点：文件预分配（比如先 truncate 到总长度）不能证明
// 下载进度，把预分配文件当成已完成会让用户得到一个全是零字节的「下载完成」。
func CanResumeDirect(value any, resource Resource, fileSize int64) (Checkpoint, bool) {
	saved, ok := value.(Checkpoint)
	if !ok {
		// 也接受指针形态（调用方从 JSON 反序列化后可能是指针）
		ptr, ok2 := value.(*Checkpoint)
		if !ok2 || ptr == nil {
			return Checkpoint{}, false
		}
		saved = *ptr
	}

	if saved.URL != resource.URL || saved.Total != resource.Total || fileSize != resource.Total ||
		saved.ETag != resource.ETag || saved.LastModified != resource.LastModified {
		return Checkpoint{}, false
	}
	if saved.Segments == nil {
		return Checkpoint{}, false
	}
	// 接受旧版本的四段布局及暂停前的连接配置，不能因设置变化丢失进度
	if len(saved.Segments) == 0 || len(saved.Segments) > MaxSegments {
		return Checkpoint{}, false
	}

	for i, seg := range saved.Segments {
		// 段必须首尾相接、从 0 开始、到最后一段恰好覆盖 total
		wantStart := int64(0)
		if i > 0 {
			wantStart = saved.Segments[i-1].End
		}
		if seg.Start != wantStart {
			return Checkpoint{}, false
		}
		if !isSafeInt(seg.Start) || !isSafeInt(seg.End) {
			return Checkpoint{}, false
		}
		if seg.End <= seg.Start || seg.End > resource.Total {
			return Checkpoint{}, false
		}
		if i == len(saved.Segments)-1 && seg.End != resource.Total {
			return Checkpoint{}, false
		}
		// offset 必须落在本段内：小于 start 说明写到了别处，大于 end 说明越界
		if !isSafeInt(seg.Offset) || seg.Offset < seg.Start || seg.Offset > seg.End {
			return Checkpoint{}, false
		}
	}
	return saved, true
}

// MatchesDirectRange 校验 206 响应的 Content-Range 是否与请求一致。
//
// 不一致说明服务器返回了别的东西（换了个文件、忽略了 Range、代理改写了响应），
// 这时候把数据写进分段会静默产出损坏文件。
func MatchesDirectRange(header string, start, end, total int64) bool {
	// HTTP 的 end 是**闭区间**，而本包的 End 是开区间，所以减 1。
	want := fmt.Sprintf("bytes %d-%d/%d", start, end-1, total)
	return header == want
}
