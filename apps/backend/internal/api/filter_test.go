package api

import (
	"net/url"
	"testing"
	"time"
)

func TestParsePhotoFilterReadsFavorite(t *testing.T) {
	got := parsePhotoFilter(url.Values{"favorite": []string{"true"}})
	if got.Favorite == nil || !*got.Favorite {
		t.Fatal("expected favorite true")
	}

	got = parsePhotoFilter(url.Values{"favorite": []string{"false"}})
	if got.Favorite == nil || *got.Favorite {
		t.Fatal("expected favorite false")
	}

	// Absent, unparseable, or a leftover search parameter: no filter at all,
	// rather than a guess.
	for _, q := range []url.Values{
		{},
		{"favorite": []string{""}},
		{"favorite": []string{"maybe"}},
		{"q": []string{"2024-08"}, "year": []string{"2024"}},
	} {
		if parsePhotoFilter(q).Favorite != nil {
			t.Errorf("%v produced a filter", q)
		}
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
