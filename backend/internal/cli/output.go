// Package cli 输出 NDJSON：stdout 只放结构化结果，stderr 放日志文本。
package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
)

var (
	mu sync.Mutex
)

// Emit 把任意结构序列化为一行 JSON 写到 stdout
func Emit(v any) {
	mu.Lock()
	defer mu.Unlock()
	line, err := json.Marshal(v)
	if err != nil {
		return
	}
	fmt.Fprintln(os.Stdout, string(line))
}

// Log 写一行诊断日志到 stderr（Electron 侧收进日志文件）
func Log(msg string) {
	fmt.Fprintln(os.Stderr, "[deps] "+msg)
}

// Fail 输出错误事件并结束进程
func Fail(msg string) {
	Emit(map[string]string{"event": "error", "message": msg})
	Log("错误：" + msg)
	os.Exit(1)
}
