//go:build linux || darwin

package api

import "syscall"

// freeBytes reports the space available to this user on the filesystem
// holding dir, or 0 when it cannot be read. Bavail, not Bfree: the reserved
// blocks root can still use are not space the server can write thumbs into.
func freeBytes(dir string) uint64 {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(dir, &stat); err != nil {
		return 0
	}
	return uint64(stat.Bavail) * uint64(stat.Bsize)
}
