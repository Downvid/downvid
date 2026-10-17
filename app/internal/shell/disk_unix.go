//go:build !windows

package shell

import "syscall"

// diskSpace 用 statfs 拿剩余/总空间。
//
// Bavail 而不是 Bfree：Bfree 含 root 保留块，普通用户实际用不了那些。
func diskSpace(path string) (free int64, total int64, err error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	bs := int64(st.Bsize)
	return int64(st.Bavail) * bs, int64(st.Blocks) * bs, nil
}
