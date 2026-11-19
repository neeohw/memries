package index

import (
	"context"
	"errors"
	"io/fs"
	"testing"
	"time"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/storage"
)

// seenWindow records the range the probe asked for. It is a pointer field so
// the value-receiver method below can still write to it.
type seenWindow struct {
	from, to time.Time
}

type fakePhotoLister struct {
	photos []db.Photo
	err    error
	seen   *seenWindow
}

func (f fakePhotoLister) Photos(_ context.Context, _ string, from, to time.Time, _ int, _ string) ([]db.Photo, string, error) {
	if f.seen != nil {
		f.seen.from, f.seen.to = from, to
	}
	return f.photos, "", f.err
}

type fakeStater struct {
	missing map[string]bool
}

func (f fakeStater) Stat(_ context.Context, key string) (storage.ObjectInfo, error) {
	if f.missing[key] {
		return storage.ObjectInfo{}, fs.ErrNotExist
	}
	return storage.ObjectInfo{Key: key}, nil
}

// A library whose Photos all predate the epoch must still be sampled.
// Otherwise the probe sees nothing, the Owner looks like an empty library, and
// a populated folder sits at not_started (ADR 0004).
func TestRecentOriginalsProbeSamplesPre1970Photos(t *testing.T) {
	seen := &seenWindow{}
	lib := Library{
		Photos: fakePhotoLister{seen: seen, photos: []db.Photo{
			{Storage: db.StoragePtr{Path: "admin@example.com/film-1962.jpg"}},
		}},
		Store: fakeStater{missing: map[string]bool{"admin@example.com/film-1962.jpg": true}},
	}
	if _, err := lib.RecentOriginalsMissing(context.Background()); err != nil {
		t.Fatal(err)
	}

	film := time.Date(1962, 4, 2, 0, 0, 0, 0, time.UTC)
	if film.Before(seen.from) {
		t.Errorf("probe window starts at %s, which excludes a %s capture", seen.from, film)
	}
	if !film.Before(seen.to) {
		t.Errorf("probe window ends at %s, before %s", seen.to, film)
	}
}

func TestRecentOriginalsMissingWhenEverySampleIsGone(t *testing.T) {
	lib := Library{
		Photos: fakePhotoLister{photos: []db.Photo{
			{Storage: db.StoragePtr{Path: "admin@example.com/IMG_2272.png"}},
			{Storage: db.StoragePtr{Path: "admin@example.com/old.jpg"}},
		}},
		Store: fakeStater{missing: map[string]bool{
			"admin@example.com/IMG_2272.png": true,
			"admin@example.com/old.jpg":      true,
		}},
	}
	missing, err := lib.RecentOriginalsMissing(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !missing {
		t.Fatal("expected missing library")
	}
}

func TestRecentOriginalsMissingIfAnyFileExists(t *testing.T) {
	lib := Library{
		Photos: fakePhotoLister{photos: []db.Photo{
			{Storage: db.StoragePtr{Path: "admin@example.com/gone.jpg"}},
			{Storage: db.StoragePtr{Path: "admin@example.com/here.jpg"}},
		}},
		Store: fakeStater{missing: map[string]bool{"admin@example.com/gone.jpg": true}},
	}
	missing, err := lib.RecentOriginalsMissing(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if missing {
		t.Fatal("existing original should keep the library")
	}
}

func TestRecentOriginalsMissingNoPhotos(t *testing.T) {
	lib := Library{Photos: fakePhotoLister{}, Store: fakeStater{}}
	missing, err := lib.RecentOriginalsMissing(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if missing {
		t.Fatal("empty list is not a missing library")
	}
}

func TestRecentOriginalsMissingPropagatesListError(t *testing.T) {
	lib := Library{Photos: fakePhotoLister{err: errors.New("db down")}, Store: fakeStater{}}
	if _, err := lib.RecentOriginalsMissing(context.Background()); err == nil {
		t.Fatal("expected error")
	}
}
