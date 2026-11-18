package api

import (
	"net/url"
	"testing"
	"time"
)

func TestParsePhotoFilterReadsYearFavoriteAndQuery(t *testing.T) {
	q := url.Values{
		"year":     []string{"2024", "2025"},
		"favorite": []string{"true"},
		"q":        []string{"2024-08"},
	}
	got := parsePhotoFilter(q)
	if len(got.Years) != 2 || got.Years[0] != "2024" || got.Years[1] != "2025" {
		t.Fatalf("years %+v", got.Years)
	}
	if got.Favorite == nil || !*got.Favorite {
		t.Fatal("expected favorite true")
	}
	if got.Query != "2024-08" {
		t.Fatalf("query %q", got.Query)
	}
}

func TestParseRangeDefaultAllowsNearFutureCaptureTimes(t *testing.T) {
	from, to, err := parseRange("", "")
	if err != nil {
		t.Fatal(err)
	}
	future := time.Date(2026, 8, 31, 10, 0, 0, 0, time.UTC)
	if !from.Before(future) || !future.Before(to) {
		t.Fatalf("range [%s, %s] excludes %s", from, to, future)
	}
}

// Unix time is an encoding, not a product floor: a scanned family negative
// carries an EXIF DateTimeOriginal from the 1950s or 1960s, and the SPA asks
// for /api/photos with no from/to at all.
func TestParseRangeDefaultIncludesPre1970CaptureTimes(t *testing.T) {
	from, to, err := parseRange("", "")
	if err != nil {
		t.Fatal(err)
	}
	pre1970 := time.Date(1968, 6, 1, 0, 0, 0, 0, time.UTC)
	if pre1970.Before(from) || !pre1970.Before(to) {
		t.Fatalf("default range [%s, %s] excludes %s", from, to, pre1970)
	}
}

// The ceiling stays finite on purpose: a camera clock set to 2200 should not
// drag the whole timeline out with it.
func TestParseRangeDefaultStillExcludesTheFarFuture(t *testing.T) {
	_, to, err := parseRange("", "")
	if err != nil {
		t.Fatal(err)
	}
	farFuture := time.Date(2200, 1, 1, 0, 0, 0, 0, time.UTC)
	if farFuture.Before(to) {
		t.Fatalf("default range ends at %s, which admits %s", to, farFuture)
	}
}

func TestParsePhotoFilterEmptyMeansNoConstraint(t *testing.T) {
	got := parsePhotoFilter(url.Values{})
	if got.Favorite != nil || len(got.Years) != 0 || len(got.Months) != 0 || got.Query != "" || got.LocalFrom != "" || got.LocalTo != "" {
		t.Fatalf("got %+v", got)
	}
}

func TestParsePhotoFilterReadsMonthAndLocalTakenAtBounds(t *testing.T) {
	q := url.Values{
		"month":      []string{"06", "07"},
		"local_from": []string{"2025-12-01"},
		"local_to":   []string{"2026-03-01"},
	}
	got := parsePhotoFilter(q)
	if len(got.Months) != 2 || got.Months[0] != "06" || got.Months[1] != "07" {
		t.Fatalf("months %+v", got.Months)
	}
	if got.LocalFrom != "2025-12-01" || got.LocalTo != "2026-03-01" {
		t.Fatalf("local bounds %q %q", got.LocalFrom, got.LocalTo)
	}
}

func TestParsePhotoFilterIgnoresInvalidMonthAndLocalDays(t *testing.T) {
	q := url.Values{
		"month":      []string{"13", "ab", "6"},
		"local_from": []string{"2025-1-1"},
		"local_to":   []string{"yesterday"},
	}
	got := parsePhotoFilter(q)
	if len(got.Months) != 0 || got.LocalFrom != "" || got.LocalTo != "" {
		t.Fatalf("got %+v", got)
	}
}
