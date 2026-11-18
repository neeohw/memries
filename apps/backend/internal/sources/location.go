package sources

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/memries/memries/internal/storage"
)

const (
	TypeLocal  = "local"
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
		cfg, err := parseSMB(loc)
		if err != nil {
			return "", err
		}
		return smbLocation(cfg), nil
	case TypeWebDAV:
		return normalizeWebDAV(loc)
	default:
		return "", invalidf("type must be local, smb, or webdav")
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

// parseSMB accepts smb://host[:port]/share[/dir] or a UNC path \\host\share\dir.
func parseSMB(loc string) (storage.SMBConfig, error) {
	if strings.HasPrefix(loc, `\\`) || strings.HasPrefix(loc, "//") {
		loc = "smb://" + strings.TrimLeft(strings.ReplaceAll(loc, `\`, "/"), "/")
	}
	u, err := url.Parse(loc)
	if err != nil || !strings.EqualFold(u.Scheme, "smb") || u.Hostname() == "" {
		return storage.SMBConfig{}, invalidf(`SMB location must look like smb://nas/share/folder or \\nas\share\folder`)
	}
	if u.User != nil {
		return storage.SMBConfig{}, invalidf("put SMB credentials in the username and password fields, not the location")
	}
	parts := strings.SplitN(strings.Trim(u.Path, "/"), "/", 2)
	if parts[0] == "" {
		return storage.SMBConfig{}, invalidf("SMB location needs a share name: smb://%s/<share>", u.Host)
	}
	dir := ""
	if len(parts) == 2 {
		dir = path.Clean("/" + parts[1])
		dir = strings.TrimPrefix(dir, "/")
	}
	for _, seg := range strings.Split(dir, "/") {
		if seg == ".." {
			return storage.SMBConfig{}, invalidf("SMB folder cannot contain ..")
		}
	}
	port := u.Port()
	if port == "" {
		port = "445"
	}
	return storage.SMBConfig{
		Addr:  net.JoinHostPort(u.Hostname(), port),
		Share: parts[0],
		Dir:   dir,
	}, nil
}

func smbLocation(cfg storage.SMBConfig) string {
	host, port, _ := net.SplitHostPort(cfg.Addr)
	if port != "445" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	loc := "smb://" + host + "/" + cfg.Share
	if cfg.Dir != "" {
		loc += "/" + cfg.Dir
	}
	return loc
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
