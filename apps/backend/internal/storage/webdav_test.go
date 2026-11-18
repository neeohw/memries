package storage

import (
	"context"
	"io"
	"net/http/httptest"
	"os"
	"path"
	"sort"
	"testing"

	"golang.org/x/net/webdav"
)

func newDAV(t *testing.T, files map[string]string) *httptest.Server {
	t.Helper()
	fs := webdav.NewMemFS()
	ctx := context.Background()
	for name, body := range files {
		if dir := path.Dir(name); dir != "/" {
			if err := fs.Mkdir(ctx, dir, 0o755); err != nil && !os.IsExist(err) {
				t.Fatal(err)
			}
		}
		f, err := fs.OpenFile(ctx, name, os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(f, body); err != nil {
			t.Fatal(err)
		}
		f.Close()
	}
	srv := httptest.NewServer(&webdav.Handler{Prefix: "/dav", FileSystem: fs, LockSystem: webdav.NewMemLS()})
	t.Cleanup(srv.Close)
	return srv
}

func TestWebDAVWalkGetStat(t *testing.T) {
	srv := newDAV(t, map[string]string{
		"/2024/a.jpg": "aaa",
		"/2024/b.png": "bbbb",
		"/top.jpg":    "t",
	})
	w := NewWebDAV(srv.URL+"/dav/", "", "")
	ctx := context.Background()

	var keys []string
	if err := w.Walk(ctx, "", func(o ObjectInfo) error {
		keys = append(keys, o.Key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sort.Strings(keys)
	want := []string{"2024/a.jpg", "2024/b.png", "top.jpg"}
	if len(keys) != len(want) {
		t.Fatalf("keys = %v", keys)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("keys = %v", keys)
		}
	}

	rc, err := w.Get(ctx, "2024/b.png")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(rc)
	rc.Close()
	if string(body) != "bbbb" {
		t.Fatalf("body = %q", body)
	}

	st, err := w.Stat(ctx, "2024/a.jpg")
	if err != nil || st.Size != 3 || st.ModTime.IsZero() {
		t.Fatalf("stat = %+v err %v", st, err)
	}
}

func TestWebDAVMissingIsNotFound(t *testing.T) {
	srv := newDAV(t, map[string]string{"/a.jpg": "a"})
	w := NewWebDAV(srv.URL+"/dav", "", "")
	if _, err := w.Stat(context.Background(), "gone.jpg"); !IsNotFound(err) {
		t.Fatalf("stat err = %v", err)
	}
	if _, err := w.Get(context.Background(), "gone.jpg"); !IsNotFound(err) {
		t.Fatalf("get err = %v", err)
	}
}

func TestWebDAVRejectsEscape(t *testing.T) {
	w := NewWebDAV("http://127.0.0.1:1/dav", "", "")
	if _, err := w.Get(context.Background(), "../etc/passwd"); !IsNotFound(err) {
		t.Fatalf("err = %v", err)
	}
}

func TestOpenLocalRequiresExistingDir(t *testing.T) {
	if _, err := OpenLocal(t.TempDir() + "/missing"); err == nil {
		t.Fatal("expected error for missing root")
	}
	root := t.TempDir()
	l, err := OpenLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root+"/x.jpg", []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	var keys []string
	if err := l.Walk(context.Background(), "", func(o ObjectInfo) error {
		keys = append(keys, o.Key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(keys) != 1 || keys[0] != "x.jpg" {
		t.Fatalf("keys = %v", keys)
	}
}
