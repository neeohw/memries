package api

import (
	"net/http"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/storage"
)

// thumbCandidates lists the written renditions largest first, for the
// fallback that stands in for an original the store cannot open.
//
// A list rather than one pick: a rendition recorded in the catalog may be
// missing from the cache — the admin moved the thumbnail folder (ADR 0022),
// or a scan was interrupted — and a reader is better served a smaller image
// than a 500. The display rendition leads because it is the largest, and it
// is also the one most likely to be absent, since it exists only for HEIC.
func thumbCandidates(t db.Thumbs) []string {
	out := make([]string, 0, 4)
	for _, rel := range []string{t.S2048, t.S1024, t.S512, t.S256} {
		if rel != "" {
			out = append(out, rel)
		}
	}
	return out
}

func statusForStoreOpen(err error) int {
	if storage.IsNotFound(err) {
		return http.StatusNotFound
	}
	return http.StatusInternalServerError
}

func mediaOpenStatus(err error) int {
	return statusForStoreOpen(err)
}

func originalErrorBody(status int) string {
	if status == http.StatusNotFound {
		return "not found"
	}
	return "open original"
}
