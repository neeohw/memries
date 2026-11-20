package api

import (
	"net/url"
	"strconv"
	"strings"

	"github.com/memries/memries/internal/db"
)

// parsePhotoFilter reads the one filter the product has. Smart-date search
// was removed; its query, year, month and local-range parameters are gone
// with it.
func parsePhotoFilter(q url.Values) db.PhotoFilter {
	filter := db.PhotoFilter{}
	if raw := strings.TrimSpace(q.Get("favorite")); raw != "" {
		if v, err := strconv.ParseBool(raw); err == nil {
			filter.Favorite = &v
		}
	}
	return filter
}
