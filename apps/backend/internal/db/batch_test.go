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

func TestCreateAlbumWithPhotosFillsItInOneGo(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s,
		photo("a", "2026-03-01T10:00:00"),
		photo("b", "2026-03-02T10:00:00"),
		photo("c", "2026-03-03T10:00:00"),
	)

	view, err := s.CreateAlbumWithPhotos(ctx, "owner", "Trip", []string{"a", "c"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if view.Name != "Trip" || view.PhotoCount != 2 {
		t.Fatalf("view = %+v", view)
	}
	// Newest first, like every other album view.
	if len(view.PhotoIDs) != 2 || view.PhotoIDs[0] != "c" || view.PhotoIDs[1] != "a" {
		t.Fatalf("photo_ids = %v", view.PhotoIDs)
	}
	if view.CoverPhotoID != "c" {
		t.Errorf("cover = %q, want c", view.CoverPhotoID)
	}
}

func TestCreateAlbumWithNoPhotosIsStillAnAlbum(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	view, err := s.CreateAlbumWithPhotos(ctx, "owner", "Empty", nil)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if view.PhotoCount != 0 || len(view.PhotoIDs) != 0 {
		t.Fatalf("view = %+v", view)
	}
}

func TestCreateAlbumWithPhotosLeavesNothingBehindOnABadID(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("real", "2026-03-01T10:00:00"))

	_, err := s.CreateAlbumWithPhotos(ctx, "owner", "Trip", []string{"real", "ghost"})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
	// The album must not exist either. A half-done create would leave the
	// reader with an album they never asked for, holding part of a selection.
	albums, err := s.ListAlbums(ctx, "owner")
	if err != nil {
		t.Fatal(err)
	}
	if len(albums) != 0 {
		t.Fatalf("albums = %+v, want none", albums)
	}
}

func TestCreateAlbumWithPhotosDeduplicates(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("a", "2026-03-01T10:00:00"))

	view, err := s.CreateAlbumWithPhotos(ctx, "owner", "Trip", []string{"a", "a", "a"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if view.PhotoCount != 1 {
		t.Fatalf("photo_count = %d, want 1", view.PhotoCount)
	}
}

func TestCreateAlbumStillNeedsAName(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("a", "2026-03-01T10:00:00"))
	if _, err := s.CreateAlbumWithPhotos(ctx, "owner", "   ", []string{"a"}); err == nil {
		t.Fatal("a blank name was accepted")
	}
	albums, _ := s.ListAlbums(ctx, "owner")
	if len(albums) != 0 {
		t.Fatalf("albums = %+v, want none", albums)
	}
}

func TestDeleteAlbumsRemovesTheAlbumsAndTheirMembership(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("a", "2026-03-01T10:00:00"))
	keep, _ := s.CreateAlbumWithPhotos(ctx, "owner", "Keep", []string{"a"})
	gone, _ := s.CreateAlbumWithPhotos(ctx, "owner", "Gone", []string{"a"})

	n, err := s.DeleteAlbums(ctx, "owner", []string{gone.ID})
	if err != nil || n != 1 {
		t.Fatalf("delete: n=%d err=%v", n, err)
	}

	albums, err := s.ListAlbums(ctx, "owner")
	if err != nil {
		t.Fatal(err)
	}
	if len(albums) != 1 || albums[0].ID != keep.ID {
		t.Fatalf("albums = %+v, want only Keep", albums)
	}
	// The photo is the library's, not the album's.
	if _, err := s.GetPhoto(ctx, "owner", "a"); err != nil {
		t.Fatalf("the photo was deleted with its album: %v", err)
	}
	// The membership rows went with it, so the key cannot be reused into a
	// resurrected album.
	if view, err := s.GetAlbumView(ctx, "owner", keep.ID); err != nil || view.PhotoCount != 1 {
		t.Fatalf("the surviving album lost members: %+v err=%v", view, err)
	}
}

func TestDeleteAlbumsRefusesAnotherOwnersAlbum(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mine, _ := s.CreateAlbum(ctx, "owner-a", "Mine")
	theirs, _ := s.CreateAlbum(ctx, "owner-b", "Theirs")

	_, err := s.DeleteAlbums(ctx, "owner-a", []string{mine.ID, theirs.ID})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
	// All or nothing: the one they did own must survive too.
	if albums, _ := s.ListAlbums(ctx, "owner-a"); len(albums) != 1 {
		t.Fatalf("owner-a albums = %+v, want Mine kept", albums)
	}
	if albums, _ := s.ListAlbums(ctx, "owner-b"); len(albums) != 1 {
		t.Fatal("another owner's album was deleted")
	}
}

func TestDeleteAlbumsRefusesAnUnknownID(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mine, _ := s.CreateAlbum(ctx, "owner", "Mine")

	if _, err := s.DeleteAlbums(ctx, "owner", []string{mine.ID, "ghost"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("err = %v, want ErrForbidden", err)
	}
	if albums, _ := s.ListAlbums(ctx, "owner"); len(albums) != 1 {
		t.Fatal("the batch was partly applied")
	}
}

func TestDeleteAlbumsDeduplicatesAndTakesNone(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mine, _ := s.CreateAlbum(ctx, "owner", "Mine")

	n, err := s.DeleteAlbums(ctx, "owner", []string{mine.ID, mine.ID})
	if err != nil || n != 1 {
		t.Fatalf("n=%d err=%v, want 1/nil", n, err)
	}
	if n, err := s.DeleteAlbums(ctx, "owner", nil); err != nil || n != 0 {
		t.Fatalf("empty: n=%d err=%v", n, err)
	}
}
