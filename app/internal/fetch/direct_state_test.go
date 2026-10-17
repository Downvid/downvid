package fetch

import (
	"reflect"
	"testing"
)

// tests/direct-state.test.ts 的逐条移植。
//
// 这些规则守护「暂停后能不能接着下」——判断错一次用户就丢一次进度；
// 判断错得宽松会把两个不同文件的片段拼起来，产出损坏视频。

func testResource() Resource {
	return Resource{
		URL:   "https://cdn.example/video",
		Total: 8*Unit + 1,
		ETag:  `"v1"`,
	}
}

func testCheckpoint() Checkpoint {
	r := testResource()
	return Checkpoint{Resource: r, Segments: CreateDirectSegments(r.Total, 8)}
}

// --- 分段无重叠且覆盖完整文件，小文件只用一段 ---

func TestSegmentsCoverWholeFile(t *testing.T) {
	r := testResource()
	segs := CreateDirectSegments(r.Total, 8)

	// 总大小 8MiB+1，块大小 1MiB → 9 段
	if len(segs) != 9 {
		t.Fatalf("段数 = %d, want 9（8MiB+1 按 1MiB 切）", len(segs))
	}
	if segs[0].Start != 0 {
		t.Fatalf("首段 start = %d, want 0", segs[0].Start)
	}
	if segs[len(segs)-1].End != r.Total {
		t.Fatalf("末段 end = %d, want %d", segs[len(segs)-1].End, r.Total)
	}
	// 段必须首尾相接，不能有空洞也不能重叠
	for i := 1; i < len(segs); i++ {
		if segs[i].Start != segs[i-1].End {
			t.Fatalf("第 %d 段 start=%d 与上一段 end=%d 不连续", i, segs[i].Start, segs[i-1].End)
		}
	}
}

func TestSmallFileUsesOneSegment(t *testing.T) {
	got := CreateDirectSegments(1024, 8)
	want := []Segment{{Start: 0, End: 1024, Offset: 0}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("小文件应只用一段，got %v", got)
	}
	if got := CreateDirectSegments(testResource().Total, 1); len(got) != 1 {
		t.Fatalf("connections=1 时应只有一段，got %d 段", len(got))
	}
}

// --- 只接受已写入的逐段偏移，不把预分配文件当作下载完成 ---

func TestOnlyAcceptsWrittenOffsets(t *testing.T) {
	saved := testCheckpoint()
	saved.Segments[0].Offset = 16384
	if _, ok := CanResumeDirect(saved, testResource(), testResource().Total); !ok {
		t.Fatal("逐段偏移合法时应可续传")
	}
	if _, ok := CanResumeDirect(nil, testResource(), testResource().Total); ok {
		t.Fatal("nil 检查点不可续传")
	}
	// 文件大小与资源总大小不符：说明磁盘上是个预分配或残缺文件
	if _, ok := CanResumeDirect(saved, testResource(), 16384); ok {
		t.Fatal("文件大小不符时不可续传（预分配文件不能证明下载进度）")
	}
}

// --- 资源变化后拒绝拼接旧片段（it.each 展开成 4 条）---

func TestRejectsChangedResource(t *testing.T) {
	cases := map[string]func(*Resource){
		"url":          func(r *Resource) { r.URL = "changed" },
		"total":        func(r *Resource) { r.Total = r.Total + 1 },
		"etag":         func(r *Resource) { r.ETag = "changed" },
		"lastModified": func(r *Resource) { r.LastModified = "changed" },
	}
	saved := testCheckpoint()
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			changed := testResource()
			mutate(&changed)
			if _, ok := CanResumeDirect(saved, changed, testResource().Total); ok {
				t.Fatalf("资源 %s 变化后不该接受旧片段拼接（会产出损坏文件）", name)
			}
		})
	}
}

// --- 损坏、越界或布局错误的检查点不可续传 ---

func TestRejectsCorruptCheckpoint(t *testing.T) {
	empty := testCheckpoint()
	empty.Segments = []Segment{}
	if _, ok := CanResumeDirect(empty, testResource(), testResource().Total); ok {
		t.Fatal("空 segments 不可续传")
	}

	for _, offset := range []int64{-1, testResource().Total + 1, 0} {
		saved := testCheckpoint()
		saved.Segments[0].Offset = offset
		// offset=0 是合法的（首段 start 就是 0）——单独确认它不该被拒
		_, ok := CanResumeDirect(saved, testResource(), testResource().Total)
		if offset == 0 {
			if !ok {
				t.Fatal("offset=0 是首段的合法初始值，不该被拒")
			}
			continue
		}
		if ok {
			t.Fatalf("offset=%d 越界时应拒绝", offset)
		}
	}

	// 段之间出现空洞
	saved := testCheckpoint()
	saved.Segments[1].Start++
	if _, ok := CanResumeDirect(saved, testResource(), testResource().Total); ok {
		t.Fatal("段不连续时应拒绝")
	}
}

// 小数 offset：TS 侧用 Number.isSafeInteger 挡。Go 的 int64 无法表达小数，
// 所以这里验证「JSON 里出现小数时解析会报错而不是静默截断」由调用方的反序列化负责；
// 本包内补一条「末段未覆盖到 total」的用例，那是同一类「布局错误」。
func TestRejectsLayoutErrors(t *testing.T) {
	saved := testCheckpoint()
	saved.Segments[len(saved.Segments)-1].End--
	if _, ok := CanResumeDirect(saved, testResource(), testResource().Total); ok {
		t.Fatal("末段没覆盖到 total 时应拒绝（否则尾部字节永远下不到）")
	}
}

// --- 响应范围必须与请求和总长度一致 ---

func TestMatchesDirectRange(t *testing.T) {
	if !MatchesDirectRange("bytes 100-199/1000", 100, 200, 1000) {
		t.Fatal("一致的范围应通过")
	}
	bad := []string{"", "bytes 0-199/1000", "bytes 100-200/1000", "bytes 100-199/999"}
	for _, v := range bad {
		if MatchesDirectRange(v, 100, 200, 1000) {
			t.Fatalf("%q 不该通过（服务器返回了别的东西）", v)
		}
	}
}
