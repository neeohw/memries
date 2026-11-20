package sources

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const (
	TypeLocal = "local"
	// TypeSMB is kept only to recognise Sources written before ADR 0020
	// removed it, so they can be reported clearly instead of as garbage.
	TypeSMB    = "smb"
	TypeWebDAV = "webdav"
)

// ErrInvalid wraps every admin input problem so the API can answer 400.
var ErrInvalid = errors.New("invalid source")

func invalidf(format string, args ...interface{}) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// normalizeLocation validates a Location for its Type and returns the
// canonical form stored on the Source.
func normalizeLocation(typ, loc string, roots []string) (string, error) {
	loc = strings.TrimSpace(loc)
	if loc == "" {
		return "", invalidf("location is required")
	}
	switch typ {
	case TypeLocal:
		return normalizeLocal(loc, roots)
	case TypeSMB:
		// Removed in ADR 0020. Rows written before that still exist, so the
		// message says what to do rather than "unknown type".
		return "", invalidf("SMB shares are no longer configured here: mount the share on the server and add it as a folder")
	case TypeWebDAV:
		return normalizeWebDAV(loc)
	default:
		return "", invalidf("type must be local or webdav")
	}
}

func normalizeLocal(loc string, roots []string) (string, error) {
	if !filepath.IsAbs(loc) {
		return "", invalidf("local folder must be an absolute path on the server")
	}
	clean := filepath.Clean(loc)
	if !withinRoots(clean, roots) {
		return "", invalidf("%s is outside the allowed folders (%s); add it to MEMRIES_SOURCE_ROOTS", clean, strings.Join(roots, ", "))
	}
	return clean, nil
}

// IsWithin reports whether p is root or sits below it.
func IsWithin(p, root string) bool {
	return isWithin(p, root)
}

// withinRoots compares both the literal and the symlink-resolved path so a
// link inside an allowed root cannot point the indexer elsewhere.
func withinRoots(p string, roots []string) bool {
	resolved := p
	if r, err := filepath.EvalSymlinks(p); err == nil {
		resolved = r
	} else if !os.IsNotExist(err) {
		return false
	}
	for _, root := range roots {
		if root == "" {
			continue
		}
		absRoot, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		realRoot := absRoot
		if r, err := filepath.EvalSymlinks(absRoot); err == nil {
			realRoot = r
		}
		if isWithin(p, absRoot) && isWithin(resolved, realRoot) {
			return true
		}
	}
	return false
}

func isWithin(p, root string) bool {
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func normalizeWebDAV(loc string) (string, error) {
	u, err := url.Parse(loc)
	if err != nil || u.Host == "" {
		return "", invalidf("WebDAV location must be an http(s) URL")
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
	default:
		return "", invalidf("WebDAV location must be an http(s) URL")
	}
	if u.User != nil {
		return "", invalidf("put WebDAV credentials in the username and password fields, not the URL")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.RawQuery, u.Fragment = "", ""
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = ""
	return u.String(), nil
}
