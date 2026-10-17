//go:build !withsidecar

package sidecar

// 没有 `withsidecar` tag 时（`go test ./...`、普通 `go build`）不嵌入边车。
//
// 这不是"降级"而是必要条件：仓库里不能有 10MB 的二进制（每个平台一份），
// 而 `go test` 也不该因此变慢。打包脚本会带上 tag 重新构建。

import "errors"

// Available 报告这个构建是否带上了边车。
const Available = false

// ErrNotEmbedded 表示这是一次没有嵌入边车的构建。
var ErrNotEmbedded = errors.New("这个构建没有内嵌依赖边车（需用 -tags withsidecar 构建）")

// Extract 在未嵌入时总是返回错误。
func Extract(dir string) (string, error) {
	return "", ErrNotEmbedded
}
