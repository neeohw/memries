package storage

import (
	"errors"
	"io/fs"
	"os"
	"strings"
)

var ErrNotFound = errors.New("not found")

// IsNotFound reports whether err means the storage key cannot be opened safely.
func IsNotFound(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, fs.ErrNotExist) {
		return true
	}
	return strings.Contains(err.Error(), "path escape")
}

// ErrReadOnly is returned by write operations on indexed Sources.
var ErrReadOnly = errors.New("storage is read-only")
