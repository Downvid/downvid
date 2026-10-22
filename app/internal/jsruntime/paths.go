package jsruntime

import (
	"path"
	"strings"
)

// 候选路径的拼接规则，**与宿主平台无关**。
//
// 不能用 filepath.Join：在 macOS / Linux 上跑时它把反斜杠当普通字符，
// Windows 的候选表就拼不对、也测不出来（history.cleanWin32 是同一个原因）。
// TS 版用的是 Node 的 path.win32 / path.posix，交叉验证要求逐字相同，
// 所以这里照搬 Node（v22）的算法，而不是写一个「意思差不多」的归一化——
// 那种实现会在尾分隔符、`..`、UNC 这些边角上分叉。

// posixJoin 等价于 Node 的 path.posix.join。
//
// 唯一的差别是尾部 `/`：Node 会保留，path.Join 会去掉。这里拼出来的
// 最后一段永远是文件名或固定的目录名，不会以 `/` 结尾，所以两者结果相同。
func posixJoin(elems ...string) string { return path.Join(elems...) }

// win32Join 等价于 Node 的 path.win32.join。
//
// 没有照搬的三个分支：`\\?\` / `\\.\` 设备命名空间、`CON:` 这类保留设备名、
// 以及含冒号的**相对**路径（CVE-2024-36139 的处理）。候选路径的根目录都来自
// 安装目录与环境变量，是盘符或 UNC 开头的绝对路径，走不到这三个分支。
func win32Join(elems ...string) string {
	parts := make([]string, 0, len(elems))
	for _, e := range elems {
		if e != "" {
			parts = append(parts, e)
		}
	}
	if len(parts) == 0 {
		return "."
	}
	first := parts[0]
	joined := parts[0]
	for _, p := range parts[1:] {
		joined += `\` + p
	}

	// 合并后不能以两个分隔符开头，否则 normalize 会把它当成 UNC；
	// 只有第一段本身就是 `\\server` 这种形状时才保留。
	needsReplace := true
	slashCount := 0
	if isWin32Sep(first[0]) {
		slashCount++
		if len(first) > 1 && isWin32Sep(first[1]) {
			slashCount++
			if len(first) > 2 {
				if isWin32Sep(first[2]) {
					slashCount++
				} else {
					needsReplace = false
				}
			}
		}
	}
	if needsReplace {
		for slashCount < len(joined) && isWin32Sep(joined[slashCount]) {
			slashCount++
		}
		if slashCount >= 2 {
			joined = `\` + joined[slashCount:]
		}
	}
	return win32Normalize(joined)
}

// win32Normalize 等价于 Node 的 path.win32.normalize（不含上面说明的三个分支）。
func win32Normalize(p string) string {
	n := len(p)
	if n == 0 {
		return "."
	}
	if n == 1 {
		if p[0] == '/' {
			return `\`
		}
		return p
	}

	rootEnd := 0
	device := ""
	hasDevice := false
	isAbsolute := false

	if isWin32Sep(p[0]) {
		// 以分隔符开头：至少是某种绝对路径（UNC 或当前盘的根）
		isAbsolute = true
		if isWin32Sep(p[1]) {
			j := 2
			last := j
			for j < n && !isWin32Sep(p[j]) {
				j++
			}
			if j < n && j != last {
				firstPart := p[last:j]
				last = j
				for j < n && isWin32Sep(p[j]) {
					j++
				}
				if j < n && j != last {
					last = j
					for j < n && !isWin32Sep(p[j]) {
						j++
					}
					if j == n {
						// 只有 UNC 根（`\\server\share`），没有剩余部分
						return `\\` + firstPart + `\` + p[last:] + `\`
					}
					if j != last {
						device = `\\` + firstPart + `\` + p[last:j]
						hasDevice = true
						rootEnd = j
					}
				}
			}
		} else {
			rootEnd = 1
		}
	} else if isDriveLetter(p[0]) && p[1] == ':' {
		device = p[:2]
		hasDevice = true
		rootEnd = 2
		if n > 2 && isWin32Sep(p[2]) {
			isAbsolute = true
			rootEnd = 3
		}
	}

	tail := ""
	if rootEnd < n {
		tail = normalizeString(p[rootEnd:], !isAbsolute, '\\', isWin32Sep)
	}
	if tail == "" && !isAbsolute {
		tail = "."
	}
	if tail != "" && isWin32Sep(p[n-1]) {
		tail += `\`
	}
	if !hasDevice {
		if isAbsolute {
			return `\` + tail
		}
		return tail
	}
	if isAbsolute {
		return device + `\` + tail
	}
	return device + tail
}

// normalizeString 是 Node 同名内部函数的逐行移植：消解 `.` 与 `..`，合并重复分隔符。
func normalizeString(p string, allowAboveRoot bool, separator byte, isSep func(byte) bool) string {
	res := ""
	lastSegmentLength := 0
	lastSlash := -1
	dots := 0
	var code byte
	for i := 0; i <= len(p); i++ {
		if i < len(p) {
			code = p[i]
		} else if isSep(code) {
			break
		} else {
			code = '/'
		}

		if isSep(code) {
			switch {
			case lastSlash == i-1 || dots == 1:
				// 空段或 `.`：什么都不做
			case dots == 2:
				if len(res) < 2 || lastSegmentLength != 2 || res[len(res)-1] != '.' || res[len(res)-2] != '.' {
					if len(res) > 2 {
						lastSlashIndex := len(res) - lastSegmentLength - 1
						if lastSlashIndex == -1 {
							res = ""
							lastSegmentLength = 0
						} else {
							res = res[:lastSlashIndex]
							lastSegmentLength = len(res) - 1 - strings.LastIndexByte(res, separator)
						}
						lastSlash = i
						dots = 0
						continue
					} else if len(res) != 0 {
						res = ""
						lastSegmentLength = 0
						lastSlash = i
						dots = 0
						continue
					}
				}
				if allowAboveRoot {
					if len(res) > 0 {
						res += string(separator) + ".."
					} else {
						res = ".."
					}
					lastSegmentLength = 2
				}
			default:
				if len(res) > 0 {
					res += string(separator) + p[lastSlash+1:i]
				} else {
					res = p[lastSlash+1 : i]
				}
				lastSegmentLength = i - lastSlash - 1
			}
			lastSlash = i
			dots = 0
		} else if code == '.' && dots != -1 {
			dots++
		} else {
			dots = -1
		}
	}
	return res
}

func isWin32Sep(c byte) bool { return c == '/' || c == '\\' }

func isDriveLetter(c byte) bool { return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' }
