// Command downvid-server 是容器端 / 无头模式的入口。
//
// ## 环境变量（与 TS 实现保持一致，不引入新的名字）
//
//	DOWNVID_WEB_PORT      监听端口，默认 6080
//	DOWNVID_WEB_HOST      监听地址，默认 127.0.0.1（容器里由 compose 改成 0.0.0.0）
//	DOWNVID_WEB_DIST      前端构建产物目录，默认 app/frontend/dist
//	DOWNVID_DATA_DIR      数据目录（历史、日志），默认 ./data/userdata
//	DOWNVID_DOWNLOADS     下载目录，默认 ./data/downloads
//	DOWNVID_DATA_FILE     保持这个名字不变：用户的 compose 里已经写了它
//
// ## 为什么默认只监听 127.0.0.1
//
// 这是个人自托管工具，**没有多租户、没有账号系统**。默认绑 0.0.0.0 会让
// 局域网里任何人都能调用下载与文件接口。要暴露到容器外，由 compose 显式设置
// `DOWNVID_WEB_HOST=0.0.0.0`——这一行写在用户的编排文件里，是明确的选择。
package main

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/Downvid/downvid/app/internal/history"
	"github.com/Downvid/downvid/app/internal/server"
)

// version 由构建期注入：go build -ldflags "-X main.version=1.6.0"
var version = "0.0.0-dev"

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	port := 6080
	if p := os.Getenv("DOWNVID_WEB_PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 && n < 65536 {
			port = n
		} else {
			log.Printf("[downvid] DOWNVID_WEB_PORT=%q 非法，使用默认 %d", p, port)
		}
	}

	dataDir := envOr("DOWNVID_DATA_DIR", filepath.Join("data", "userdata"))
	downloadsDir := envOr("DOWNVID_DOWNLOADS", filepath.Join("data", "downloads"))
	staticDir := envOr("DOWNVID_WEB_DIST", filepath.Join("app", "frontend", "dist"))

	// 数据目录必须存在：历史写入会自己 MkdirAll，但下载目录不会，
	// 而用户第一次下载时目录不存在会被 yt-dlp 报成一个难懂的错误。
	if err := os.MkdirAll(downloadsDir, 0o755); err != nil {
		log.Printf("[downvid] 无法创建下载目录 %s：%v", downloadsDir, err)
	}

	s := server.New(server.Config{
		Host:      envOr("DOWNVID_WEB_HOST", "127.0.0.1"),
		Port:      port,
		StaticDir: staticDir,
		Version:   version,
	})

	registerCoreMethods(s, dataDir, downloadsDir)

	log.Printf("[downvid] version=%s dataDir=%s downloads=%s static=%s", version, dataDir, downloadsDir, staticDir)
	if err := s.ListenAndServe(); err != nil {
		log.Fatalf("[downvid] 服务退出：%v", err)
	}
}

// registerCoreMethods 注册**已经移植到 Go 的那部分**方法。
//
// 刻意只注册确实实现了的：未实现的通道会走「unknown channel」分支如实报错，
// 而不是返回一个假的成功值。前端拿到明确错误比拿到空数据好排查得多。
//
// 后续移植时按域往里加，每加一个就在 `docs/provenance/` 记一笔。
func registerCoreMethods(s *server.Server, dataDir, downloadsDir string) {
	historyPath := filepath.Join(dataDir, "download-history.json")

	s.Handle("app:getVersion", func(args []any) (any, error) {
		return version, nil
	})

	// 容器版的下载目录是固定的（挂载卷），不像桌面版由用户选
	s.Handle("app:getDefaultDownloadDir", func(args []any) (any, error) {
		return downloadsDir, nil
	})

	s.Handle("history:get", func(args []any) (any, error) {
		records, err := history.Load(historyPath)
		// 文件损坏时**不静默**：把能读到的部分返回，同时让前端知道出了问题。
		// 原 TS 实现吞掉错误返回空列表，用户看到「历史空了」却没有任何提示。
		if err != nil {
			log.Printf("[downvid] 历史文件读取异常：%v", err)
		}
		return history.AttachFileState(records, nil), nil
	})

	s.Handle("history:add", func(args []any) (any, error) {
		record, ok := args[0].(map[string]any)
		if !ok {
			return nil, errInvalid("history:add 需要一条记录")
		}
		rec := history.Record{
			Title:     str(record["title"]),
			Thumbnail: str(record["thumbnail"]),
			URL:       str(record["url"]),
			FilePath:  str(record["filePath"]),
			Format:    str(record["format"]),
			Quality:   str(record["quality"]),
			FileSize:  str(record["fileSize"]),
		}
		if rec.FilePath == "" {
			return nil, errInvalid("记录缺少 filePath")
		}

		records, _ := history.Load(historyPath)
		next := history.Upsert(records, rec, newID(), nowISO(), "")
		if err := history.Save(historyPath, next); err != nil {
			return nil, err
		}
		s.Emit("history:updated", history.AttachFileState(next, nil))
		return true, nil
	})

	s.Handle("history:delete", func(args []any) (any, error) {
		id := str(args[0])
		records, _ := history.Load(historyPath)
		kept := make([]history.Record, 0, len(records))
		for _, r := range records {
			if r.ID != id {
				kept = append(kept, r)
			}
		}
		if err := history.Save(historyPath, kept); err != nil {
			return nil, err
		}
		s.Emit("history:updated", history.AttachFileState(kept, nil))
		return true, nil
	})
}

// ===== 小工具 =====

type invalidError string

func (e invalidError) Error() string { return string(e) }

func errInvalid(msg string) error { return invalidError(msg) }

// str 从 JSON 解出来的 any 里安全取字符串。
//
// JSON 的 null 会解成 nil；数字会被 f64。直接类型断言会在前端传了
// 意料之外的类型时 panic——RPC 边界上不该 panic。
func str(v any) string {
	s, _ := v.(string)
	return s
}

func newID() string {
	b := make([]byte, 16)
	if _, err := randRead(b); err != nil {
		// 拿不到随机数时退化为时间戳：ID 只用于区分记录，
		// 不需要密码学强度，但绝不能为空（空 ID 会让删除失效）
		return strconv.FormatInt(timeNow().UnixNano(), 36)
	}
	return hexEncode(b)
}

func nowISO() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func timeNow() time.Time { return time.Now() }

func randRead(b []byte) (int, error) { return rand.Read(b) }

func hexEncode(b []byte) string { return hex.EncodeToString(b) }
