package db

import (
	"context"
	"errors"
	"strconv"
	"testing"
)

// favoriteOf reads the flag as `reader` sees it: favorites are per reader,
// so there is no such thing as "the" favorite flag of a photo (ADR 0020).
func favoriteOf(t *testing.T, s *Store, key string) bool {
	t.Helper()
	p, err := s.GetPhoto(context.Background(), "reader", key)
	if err != nil {
		t.Fatalf("get %s: %v", key, err)
	}
	return p.Favorite
}

func TestSetFavoritesFlipsEveryGivenPhoto(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s,
		photo("a", "2026-03-01T10:00:00"),
		photo("b", "2026-03-02T10:00:00"),
		photo("c", "2026-03-03T10:00:00"),
	)

	n, err := s.SetFavorites(ctx, "reader", []string{"a", "c"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("updated %d, want 2", n)
	}
	if !favoriteOf(t, s, "a") || !favoriteOf(t, s, "c") {
		t.Error("a and c should be favorited")
	}
	if favoriteOf(t, s, "b") {
		t.Error("b was not in the batch and must be untouched")
	}

	// And back off again.
	if _, err := s.SetFavorites(ctx, "reader", []string{"a", "c"}, false); err != nil {
		t.Fatal(err)
	}
	if favoriteOf(t, s, "a") || favoriteOf(t, s, "c") {
		t.Error("unfavoriting the batch did not take")
	}
}

func TestSetFavoritesIgnoresDuplicateIDs(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("a", "2026-03-01T10:00:00"))

	// Duplicates must not make the affected-row count disagree with the
	// request and look like a permission failure.
	n, err := s.SetFavorites(ctx, "reader", []string{"a", "a", "a"}, true)
	if err != nil {
		t.Fatalf("duplicates rejected: %v", err)
	}
	if n != 1 {
		t.Errorf("updated %d, want 1", n)
	}
}

// The ids arrive from a client. One belonging to someone else must not be
// honoured, and must not quietly succeed for the rest either.
func TestSetFavoritesRefusesAnIDThatIsNotALivePhoto(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("real", "2026-03-01T10:00:00"))

	_, err := s.SetFavorites(ctx, "reader", []string{"real", "ghost"}, true)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
	// All or nothing: the valid half must not have been applied either.
	if favoriteOf(t, s, "real") {
		t.Error("the batch was half applied")
	}
}

func TestSetFavoritesRefusesAnUnknownPhoto(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("a", "2026-03-01T10:00:00"))

	if _, err := s.SetFavorites(ctx, "reader", []string{"a", "ghost"}, true); !errors.Is(err, ErrForbidden) {
		t.Errorf("err = %v, want ErrForbidden", err)
	}
}

func TestSetFavoritesAcceptsAnEmptyBatch(t *testing.T) {
	s := newTestStore(t)
	n, err := s.SetFavorites(context.Background(), "owner-a", nil, true)
	if err != nil || n != 0 {
		t.Errorf("got (%d, %v), want (0, nil)", n, err)
	}
}

func TestSetFavoritesRejectsAnOversizedBatch(t *testing.T) {
	s := newTestStore(t)
	ids := make([]string, MaxBatchPhotos+1)
	for i := range ids {
		ids[i] = "p" + strconv.Itoa(i)
	}
	if _, err := s.SetFavorites(context.Background(), "owner-a", ids, true); err == nil {
		t.Error("want an error for a batch over the cap")
	}
}

func TestAddPhotosToAlbumAddsEveryGivenPhoto(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s,
		photo("a", "2026-03-01T10:00:00"),
		photo("b", "2026-03-02T10:00:00"),
	)
	album, err := s.CreateAlbum(ctx, "owner-a", "Trip")
	if err != nil {
		t.Fatal(err)
	}

	view, err := s.AddPhotosToAlbum(ctx, "owner-a", album.ID, []string{"a", "b"})
	if err != nil {
		t.Fatal(err)
	}
	if view.PhotoCount != 2 {
		t.Errorf("photo_count = %d, want 2", view.PhotoCount)
	}
}

func TestAddPhotosToAlbumIsIdempotent(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s,
		photo("a", "2026-03-01T10:00:00"),
		photo("b", "2026-03-02T10:00:00"),
	)
	album, _ := s.CreateAlbum(ctx, "owner-a", "Trip")

	if _, err := s.AddPhotosToAlbum(ctx, "owner-a", album.ID, []string{"a"}); err != nil {
		t.Fatal(err)
	}
	// Re-adding "a" alongside a new photo must not fail or double-count.
	view, err := s.AddPhotosToAlbum(ctx, "owner-a", album.ID, []string{"a", "b"})
	if err != nil {
		t.Fatal(err)
	}
	if view.PhotoCount != 2 {
		t.Errorf("photo_count = %d, want 2", view.PhotoCount)
	}
}

// One unusable id must abort the whole batch, so a selection is never half
// applied and the reader is never left guessing which half took.
func TestAddPhotosToAlbumAddsNothingWhenOneIDIsUnusable(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("real", "2026-03-01T10:00:00"))
	album, _ := s.CreateAlbum(ctx, "owner-a", "Trip")

	_, err := s.AddPhotosToAlbum(ctx, "owner-a", album.ID, []string{"real", "ghost"})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
	view, err := s.GetAlbumView(ctx, "owner-a", album.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.PhotoCount != 0 {
		t.Errorf("photo_count = %d, want 0: the batch must be all or nothing", view.PhotoCount)
	}
}

func TestAddPhotosToAlbumRefusesAnotherOwnersAlbum(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("a", "2026-03-01T10:00:00"))
	album, _ := s.CreateAlbum(ctx, "owner-b", "Theirs")

	if _, err := s.AddPhotosToAlbum(ctx, "owner-a", album.ID, []string{"a"}); !errors.Is(err, ErrForbidden) {
		t.Errorf("err = %v, want ErrForbidden", err)
	}
}

func TestAddPhotosToAlbumRefusesASoftDeletedPhoto(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s,
		photo("a", "2026-03-01T10:00:00"),
		photo("gone", "2026-03-02T10:00:00"),
	)
	if err := s.SoftDeletePhoto(ctx, "gone"); err != nil {
		t.Fatal(err)
	}
	album, _ := s.CreateAlbum(ctx, "owner-a", "Trip")

	if _, err := s.AddPhotosToAlbum(ctx, "owner-a", album.ID, []string{"a", "gone"}); !errors.Is(err, ErrForbidden) {
		t.Errorf("err = %v, want ErrForbidden", err)
	}
}

func TestAddPhotosToAlbumRejectsEmptyAndOversizedBatches(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("a", "2026-03-01T10:00:00"))
	album, _ := s.CreateAlbum(ctx, "owner-a", "Trip")

	if _, err := s.AddPhotosToAlbum(ctx, "owner-a", album.ID, nil); err == nil {
		t.Error("want an error for an empty batch")
	}
	ids := make([]string, MaxBatchPhotos+1)
	for i := range ids {
		ids[i] = "p" + strconv.Itoa(i)
	}
	if _, err := s.AddPhotosToAlbum(ctx, "owner-a", album.ID, ids); err == nil {
		t.Error("want an error for a batch over the cap")
	}
}
