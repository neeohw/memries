package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/sources"
)

// SettingsStore is the catalog's half of the server-wide settings (ADR 0022).
type SettingsStore interface {
	Setting(ctx context.Context, key string) (string, error)
	SetSetting(ctx context.Context, key, value string) error
}

type settingsResponse struct {
	// ThumbnailRoot is where thumbs are read and written right now.
	ThumbnailRoot string `json:"thumbnail_root"`
	// DefaultThumbnailRoot is MEMRIES_CACHE_ROOT, shown so an admin can tell
	// a stored choice from the install default.
	DefaultThumbnailRoot string `json:"default_thumbnail_root"`
	// AllowedRoots are the directories a thumbnail location may sit under.
	AllowedRoots []string `json:"allowed_roots"`
	// FreeBytes is the space left on the filesystem holding ThumbnailRoot, or
	// 0 when it cannot be read. The whole point of moving the cache is to get
	// off a full disk, so the number belongs next to the setting.
	FreeBytes uint64 `json:"free_bytes"`
}

func (a *API) settings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, a.settingsState(r.Context()))
}

func (a *API) settingsState(ctx context.Context) settingsResponse {
	root := a.Thumb.Root()
	return settingsResponse{
		ThumbnailRoot:        root,
		DefaultThumbnailRoot: a.DefaultThumbnailRoot,
		AllowedRoots:         a.CacheRoots,
		FreeBytes:            freeBytes(root),
	}
}

type thumbnailRootRequest struct {
	Path string `json:"path"`
}

type thumbnailRootResponse struct {
	settingsResponse
	// NeedsReindex is true whenever the location changed: thumbs already
	// written stay under the old root, and the indexer is what fills the new
	// one. Saying so is the honest answer to a grid that just went grey.
	NeedsReindex bool `json:"needs_reindex"`
}

func (a *API) setThumbnailRoot(w http.ResponseWriter, r *http.Request) {
	var req thumbnailRootRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	// An empty path returns to the install default rather than being an
	// error: it is how an admin undoes a choice without knowing what the
	// unit file says.
	target := strings.TrimSpace(req.Path)
	if target == "" {
		target = a.DefaultThumbnailRoot
	}

	clean, err := a.validateThumbnailRoot(r.Context(), target)
	if err != nil {
		if errors.Is(err, errInvalidSetting) {
			http.Error(w, strings.TrimPrefix(err.Error(), errInvalidSetting.Error()+": "), http.StatusBadRequest)
			return
		}
		http.Error(w, "settings", http.StatusInternalServerError)
		return
	}

	previous := a.Thumb.Root()
	if err := a.Thumb.SetRoot(clean); err != nil {
		http.Error(w, fmt.Sprintf("cannot use %s: %v", clean, err), http.StatusBadRequest)
		return
	}
	if err := a.Settings.SetSetting(r.Context(), db.SettingThumbnailRoot, clean); err != nil {
		// The generator already moved, so put it back rather than leaving the
		// running server and the catalog disagreeing about where thumbs are.
		_ = a.Thumb.SetRoot(previous)
		http.Error(w, "settings", http.StatusInternalServerError)
		return
	}

	writeJSON(w, thumbnailRootResponse{
		settingsResponse: a.settingsState(r.Context()),
		NeedsReindex:     clean != previous,
	})
}

var errInvalidSetting = errors.New("invalid setting")

func invalidSettingf(format string, args ...any) error {
	return fmt.Errorf("%w: %s", errInvalidSetting, fmt.Sprintf(format, args...))
}

// validateThumbnailRoot decides whether a directory may hold the thumbnail
// cache. An admin reaches this over HTTP, so the path is confined to
// MEMRIES_CACHE_ROOTS exactly as a Source is confined to MEMRIES_SOURCE_ROOTS
// — the setting is not a way to write anywhere the server user can reach.
func (a *API) validateThumbnailRoot(ctx context.Context, target string) (string, error) {
	if !filepath.IsAbs(target) {
		return "", invalidSettingf("the thumbnail folder must be an absolute path on the server")
	}
	clean := filepath.Clean(target)

	if !withinAllowedRoots(clean, a.CacheRoots) {
		return "", invalidSettingf("%s is outside the allowed folders (%s); add it to MEMRIES_CACHE_ROOTS",
			clean, strings.Join(a.CacheRoots, ", "))
	}

	// A cache inside a Source would be walked by the next scan, so the
	// indexer would index its own thumbs as photos — and a cache that
	// contains a Source would be a scan of the photo library's parent.
	// Neither is recoverable without a wipe, so both are refused here.
	if a.Sources != nil {
		views, err := a.Sources.List(ctx)
		if err != nil {
			return "", err
		}
		for _, v := range views {
			if v.Type != sources.TypeLocal || v.Location == "" {
				continue
			}
			loc := filepath.Clean(v.Location)
			if sources.IsWithin(clean, loc) {
				return "", invalidSettingf("%s is inside the folder %q, so the next scan would index the thumbnails as photos", clean, v.Name)
			}
			if sources.IsWithin(loc, clean) {
				return "", invalidSettingf("%s contains the folder %q, so the thumbnails would sit on top of the photo library", clean, v.Name)
			}
		}
	}

	if err := os.MkdirAll(clean, 0o755); err != nil {
		return "", invalidSettingf("cannot create %s: %v", clean, err)
	}
	// MkdirAll succeeds on a directory that is not writable by this user, and
	// a read-only mount is exactly the mistake worth catching before the next
	// index run fails on every photo.
	probe, err := os.CreateTemp(clean, ".memries-write-probe-*")
	if err != nil {
		return "", invalidSettingf("%s is not writable by the server: %v", clean, err)
	}
	probe.Close()
	_ = os.Remove(probe.Name())

	return clean, nil
}

// withinAllowedRoots confines a thumbnail location to one of roots.
//
// This cannot reuse the Source rule: a Source must already exist, where this
// directory is about to be created. Resolving symlinks on a path that is not
// there yet yields the literal path, which would then be compared against a
// resolved root and fail wherever the root sits under a symlink — /var on
// macOS, or a symlinked mount point on the Pi. So the check resolves the
// deepest ancestor that does exist, which is the part an attacker could have
// pointed elsewhere, and requires both the literal and the resolved form to
// land inside the same root.
func withinAllowedRoots(p string, roots []string) bool {
	resolved := resolveExistingAncestor(p)
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
		if sources.IsWithin(p, absRoot) && sources.IsWithin(resolved, realRoot) {
			return true
		}
	}
	return false
}

// resolveExistingAncestor returns p with its existing prefix symlink-resolved,
// so a link anywhere along the path cannot smuggle the target outside a root.
func resolveExistingAncestor(p string) string {
	missing := ""
	for current := p; ; {
		if real, err := filepath.EvalSymlinks(current); err == nil {
			return filepath.Join(real, missing)
		}
		parent := filepath.Dir(current)
		if parent == current {
			return p
		}
		missing = filepath.Join(filepath.Base(current), missing)
		current = parent
	}
}
