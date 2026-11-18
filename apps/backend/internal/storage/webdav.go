package storage

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/studio-b12/gowebdav"
)

// WebDAV is a read-only Storage rooted at a WebDAV collection URL.
type WebDAV struct {
	client *gowebdav.Client
}

func NewWebDAV(rootURL, user, password string) *WebDAV {
	c := gowebdav.NewClient(strings.TrimRight(rootURL, "/"), user, password)
	// No overall client timeout: originals stream through Get and can be large.
	c.SetTransport(&http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       90 * time.Second,
	})
	return &WebDAV{client: c}
}

func (w *WebDAV) Backend() string { return "webdav" }

func (w *WebDAV) Put(context.Context, string, io.Reader) error { return ErrReadOnly }
func (w *WebDAV) Delete(context.Context, string) error         { return ErrReadOnly }

func (w *WebDAV) URL(context.Context, string, time.Duration) (string, error) {
	return "", ErrReadOnly
}

func (w *WebDAV) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	p, err := remotePath(key)
	if err != nil {
		return nil, err
	}
	rc, err := w.client.ReadStream(p)
	return rc, webdavErr(err)
}

func (w *WebDAV) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	p, err := remotePath(key)
	if err != nil {
		return ObjectInfo{}, err
	}
	st, err := w.client.Stat(p)
	if err != nil {
		return ObjectInfo{}, webdavErr(err)
	}
	return ObjectInfo{Key: key, Size: st.Size(), ModTime: st.ModTime()}, nil
}

func (w *WebDAV) Walk(ctx context.Context, prefix string, fn func(ObjectInfo) error) error {
	dir, err := remoteDir(prefix)
	if err != nil {
		return err
	}
	return w.walk(ctx, dir, fn)
}

func (w *WebDAV) walk(ctx context.Context, dir string, fn func(ObjectInfo) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	entries, err := w.client.ReadDir(dir)
	if err != nil {
		return webdavErr(err)
	}
	for _, e := range entries {
		child := path.Join(dir, e.Name())
		if e.IsDir() {
			if err := w.walk(ctx, child, fn); err != nil {
				return err
			}
			continue
		}
		key := strings.TrimPrefix(child, "/")
		if err := fn(ObjectInfo{Key: key, Size: e.Size(), ModTime: e.ModTime()}); err != nil {
			return err
		}
	}
	return nil
}

func webdavErr(err error) error {
	if err == nil {
		return nil
	}
	if gowebdav.IsErrNotFound(err) {
		return fmt.Errorf("%w: %v", fs.ErrNotExist, err)
	}
	return err
}

// remotePath cleans a slash-separated key relative to a remote root.
func remotePath(key string) (string, error) {
	key = strings.TrimPrefix(strings.ReplaceAll(strings.TrimSpace(key), `\`, "/"), "/")
	if key == "" || key == "." {
		return "", fmt.Errorf("path escape: %q", key)
	}
	for _, part := range strings.Split(key, "/") {
		if part == ".." {
			return "", fmt.Errorf("path escape: %q", key)
		}
	}
	return "/" + path.Clean(key), nil
}

// remoteDir is remotePath that also accepts the root.
func remoteDir(prefix string) (string, error) {
	if strings.Trim(prefix, "/") == "" {
		return "/", nil
	}
	return remotePath(prefix)
}
