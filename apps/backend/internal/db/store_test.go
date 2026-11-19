package db

import (
	"context"
	"errors"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/memries/memries/internal/config"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	cfg := &config.Config{
		DBDriver: DriverSQLite,
		DBDSN:    filepath.Join(t.TempDir(), "catalog.db"),
	}
	s, err := Connect(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t.UTC()
}

// photo builds a minimally valid Photo for the given owner and capture time.
func photo(key, local string, opts ...func(*Photo)) *Photo {
	p := &Photo{
		Key:          key,
		Kind:         "photo",
		TakenAt:      at(local + "Z"),
		TakenAtLocal: local,
		Hash:         "hash-" + key,
		MIME:         "image/jpeg",
		Orientation:  1,
		Dims:         Dims{W: 4000, H: 3000},
		Storage:      StoragePtr{Backend: "source", Path: "src1/" + key + ".jpg"},
		Thumbs:       Thumbs{S256: "a/256.jpg", S512: "a/512.jpg", S1024: "a/1024.jpg"},
		ImportedAt:   at("2026-01-01T00:00:00Z"),
	}
	for _, o := range opts {
		o(p)
	}
	return p
}

func mustUpsert(t *testing.T, s *Store, photos ...*Photo) {
	t.Helper()
	for _, p := range photos {
		if err := s.UpsertPhoto(context.Background(), p); err != nil {
			t.Fatalf("upsert %s: %v", p.Key, err)
		}
	}
}

func TestMigrationsAreIdempotent(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "catalog.db")
	cfg := &config.Config{DBDriver: DriverSQLite, DBDSN: dsn}
	for i := 0; i < 2; i++ {
		s, err := Connect(context.Background(), cfg)
		if err != nil {
			t.Fatalf("connect %d: %v", i, err)
		}
		if err := s.Close(); err != nil {
			t.Fatalf("close %d: %v", i, err)
		}
	}
}

func TestPhotoRoundTrip(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mtime := at("2026-03-02T12:00:00Z")
	p := photo("p1", "2026-03-01T15:04:05", func(p *Photo) {
		p.Favorite = true
		p.TZOffset = 3600
		p.SizeBytes = 123456
		p.Storage.ModTime = &mtime
		p.EXIF = EXIF{
			Camera:  "NIKON Z6",
			Lens:    "24-70mm",
			ISO:     400,
			FNum:    2.8,
			Shutter: "1/250",
			GPS:     &GPS{Lat: 51.05, Lon: 3.72},
		}
	})
	mustUpsert(t, s, p)

	got, err := s.GetPhoto(ctx, "", "p1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !got.TakenAt.Equal(p.TakenAt) {
		t.Errorf("taken_at = %v, want %v", got.TakenAt, p.TakenAt)
	}
	if got.TZOffset != 3600 || got.SizeBytes != 123456 {
		t.Errorf("scalars round-tripped wrong: %+v", got)
	}
	if got.Dims != (Dims{W: 4000, H: 3000}) {
		t.Errorf("dims = %+v", got.Dims)
	}
	if got.Storage.ModTime == nil || !got.Storage.ModTime.Equal(mtime) {
		t.Errorf("storage mtime = %v, want %v", got.Storage.ModTime, mtime)
	}
	if got.EXIF.Camera != "NIKON Z6" || got.EXIF.ISO != 400 || got.EXIF.FNum != 2.8 {
		t.Errorf("exif = %+v", got.EXIF)
	}
	if got.EXIF.GPS == nil || got.EXIF.GPS.Lat != 51.05 {
		t.Errorf("gps = %+v", got.EXIF.GPS)
	}
	if got.Thumbs.S1024 != "a/1024.jpg" {
		t.Errorf("thumbs = %+v", got.Thumbs)
	}
	if got.DeletedAt != nil {
		t.Errorf("deleted_at = %v, want nil", got.DeletedAt)
	}
}

func TestPhotoWithoutGPSOrMtime(t *testing.T) {
	s := newTestStore(t)
	mustUpsert(t, s, photo("p1", "2026-03-01T15:04:05"))
	got, err := s.GetPhoto(context.Background(), "", "p1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.EXIF.GPS != nil {
		t.Errorf("gps = %+v, want nil", got.EXIF.GPS)
	}
	if got.Storage.ModTime != nil {
		t.Errorf("mtime = %v, want nil", got.Storage.ModTime)
	}
}

func TestUpsertPhotoReplacesExisting(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s, photo("p1", "2026-03-01T15:04:05"))
	updated := photo("p1", "2026-03-01T15:04:05", func(p *Photo) {
		p.MIME = "image/png"
		p.Hash = "rehashed"
	})
	mustUpsert(t, s, updated)
	got, err := s.GetPhoto(ctx, "", "p1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.MIME != "image/png" || got.Hash != "rehashed" {
		t.Errorf("upsert did not overwrite: %+v", got)
	}
}

func TestGetPhotoNotFound(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.GetPhoto(context.Background(), "", "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

// One library, so one copy of a file: the same bytes cannot be two Photos
// (ADR 0020).
func TestHashIsUniqueAcrossTheLibrary(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s, photo("p1", "2026-03-01T15:04:05", func(p *Photo) { p.Hash = "shared" }))

	err := s.UpsertPhoto(ctx, photo("p2", "2026-03-01T15:04:05", func(p *Photo) { p.Hash = "shared" }))
	if err == nil {
		t.Fatal("a second Photo with the same hash was accepted")
	}

	got, err := s.GetPhotoByHash(ctx, "shared")
	if err != nil {
		t.Fatalf("by hash: %v", err)
	}
	if got.Key != "p1" {
		t.Errorf("key = %s, want p1", got.Key)
	}
}

func TestSoftDeleteThenUpdateIndexedRestores(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s, photo("p1", "2026-03-01T15:04:05"))
	if _, err := s.SetFavorite(ctx, "reader", "p1", true); err != nil {
		t.Fatalf("favorite: %v", err)
	}
	if err := s.SoftDeletePhoto(ctx, "p1"); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	got, _ := s.GetPhoto(ctx, "reader", "p1")
	if got.DeletedAt == nil {
		t.Fatal("deleted_at not set")
	}
	// Rediscovered content clears deleted_at, and the reader's favorite is
	// untouched because it was never on the photo's row.
	if err := s.UpdateIndexedPhoto(ctx, photo("p1", "2026-03-01T15:04:05")); err != nil {
		t.Fatalf("update indexed: %v", err)
	}
	got, _ = s.GetPhoto(ctx, "reader", "p1")
	if got.DeletedAt != nil {
		t.Errorf("deleted_at = %v, want nil after reindex", got.DeletedAt)
	}
	if !got.Favorite {
		t.Error("favorite lost on reindex")
	}
}

func TestPhotosPaginatesWithCursor(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	for i, local := range []string{
		"2026-03-01T10:00:00", "2026-03-02T10:00:00", "2026-03-03T10:00:00",
		"2026-03-04T10:00:00", "2026-03-05T10:00:00",
	} {
		mustUpsert(t, s, photo(string(rune('a'+i)), local))
	}
	from, to := at("2026-01-01T00:00:00Z"), at("2027-01-01T00:00:00Z")

	var seen []string
	cursor := ""
	for page := 0; page < 10; page++ {
		photos, next, err := s.Photos(ctx, "reader", from, to, 2, cursor)
		if err != nil {
			t.Fatalf("page %d: %v", page, err)
		}
		for _, p := range photos {
			seen = append(seen, p.TakenAtLocal)
		}
		if next == "" {
			break
		}
		cursor = next
	}
	want := []string{
		"2026-03-05T10:00:00", "2026-03-04T10:00:00", "2026-03-03T10:00:00",
		"2026-03-02T10:00:00", "2026-03-01T10:00:00",
	}
	if len(seen) != len(want) {
		t.Fatalf("saw %d photos (%v), want %d", len(seen), seen, len(want))
	}
	for i := range want {
		if seen[i] != want[i] {
			t.Errorf("page order[%d] = %s, want %s", i, seen[i], want[i])
		}
	}
}

func TestPhotosExcludesDeleted(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	deleted := at("2026-04-01T00:00:00Z")
	mustUpsert(t, s,
		photo("keep", "2026-03-01T10:00:00"),
		photo("gone", "2026-03-02T10:00:00", func(p *Photo) { p.DeletedAt = &deleted }),
	)
	got, _, err := s.Photos(ctx, "reader", at("2026-01-01T00:00:00Z"), at("2027-01-01T00:00:00Z"), 50, "")
	if err != nil {
		t.Fatalf("photos: %v", err)
	}
	if len(got) != 1 || got[0].Key != "keep" {
		t.Fatalf("got %d photos %+v, want only keep", len(got), got)
	}
}

func TestPhotoFilters(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	yes := true
	mustUpsert(t, s,
		photo("j1", "2025-01-15T10:00:00"),
		photo("j2", "2026-01-20T10:00:00"),
		photo("m1", "2026-03-10T10:00:00"),
	)
	if _, err := s.SetFavorite(ctx, "reader", "j2", true); err != nil {
		t.Fatalf("favorite: %v", err)
	}
	from, to := at("2020-01-01T00:00:00Z"), at("2030-01-01T00:00:00Z")

	cases := []struct {
		name   string
		filter PhotoFilter
		want   []string
	}{
		{"year", PhotoFilter{Years: []string{"2026"}}, []string{"m1", "j2"}},
		{"years multi", PhotoFilter{Years: []string{"2025", "2026"}}, []string{"m1", "j2", "j1"}},
		{"month", PhotoFilter{Months: []string{"01"}}, []string{"j2", "j1"}},
		{"favorite", PhotoFilter{Favorite: &yes}, []string{"j2"}},
		{"local range", PhotoFilter{LocalFrom: "2026-01-01", LocalTo: "2026-02-01"}, []string{"j2"}},
		{"query", PhotoFilter{Query: "2026-03"}, []string{"m1"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, _, err := s.PhotosFiltered(ctx, "reader", from, to, 50, "", tc.filter)
			if err != nil {
				t.Fatalf("filtered: %v", err)
			}
			keys := make([]string, len(got))
			for i := range got {
				keys[i] = got[i].Key
			}
			if len(keys) != len(tc.want) {
				t.Fatalf("got %v, want %v", keys, tc.want)
			}
			for i := range tc.want {
				if keys[i] != tc.want[i] {
					t.Errorf("got %v, want %v", keys, tc.want)
					break
				}
			}
		})
	}
}

// A LIKE wildcard typed by the user must match literally, not as a wildcard.
func TestQueryFilterEscapesWildcards(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s, photo("p1", "2026-03-01T10:00:00"))
	got, _, err := s.PhotosFiltered(ctx, "reader",
		at("2020-01-01T00:00:00Z"), at("2030-01-01T00:00:00Z"), 50, "",
		PhotoFilter{Query: "%"})
	if err != nil {
		t.Fatalf("filtered: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("query %q matched %d rows, want 0 (wildcard must be literal)", "%", len(got))
	}
}

func TestCountPhotos(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	deleted := at("2026-04-01T00:00:00Z")
	mustUpsert(t, s,
		photo("a", "2026-03-01T10:00:00"),
		photo("b", "2026-03-02T10:00:00", func(p *Photo) { p.DeletedAt = &deleted }),
		photo("c", "2026-03-03T10:00:00"),
	)
	n, err := s.CountPhotos(ctx)
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	// Two live photos: the library is shared, so the only thing that takes a
	// row out of the count is the soft delete.
	if n != 2 {
		t.Errorf("count = %d, want 2", n)
	}
}

func TestListPhotoStorage(t *testing.T) {
	s := newTestStore(t)
	mustUpsert(t, s, photo("a", "2026-03-01T10:00:00"))
	refs, err := s.ListPhotoStorage(context.Background())
	if err != nil {
		t.Fatalf("list storage: %v", err)
	}
	if len(refs) != 1 || refs[0].Key != "a" || refs[0].Path != "src1/a.jpg" {
		t.Errorf("refs = %+v", refs)
	}
}

func TestTimelineBuckets(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s,
		photo("a", "2026-03-01T10:00:00"),
		photo("b", "2026-03-02T10:00:00"),
		photo("c", "2025-12-31T10:00:00"),
	)
	from, to := at("2020-01-01T00:00:00Z"), at("2030-01-01T00:00:00Z")

	for _, tc := range []struct {
		granularity string
		want        map[string]int
	}{
		{"year", map[string]int{"2026": 2, "2025": 1}},
		{"month", map[string]int{"2026-03": 2, "2025-12": 1}},
		{"day", map[string]int{"2026-03-01": 1, "2026-03-02": 1, "2025-12-31": 1}},
	} {
		t.Run(tc.granularity, func(t *testing.T) {
			buckets, err := s.Timeline(ctx, tc.granularity, from, to)
			if err != nil {
				t.Fatalf("timeline: %v", err)
			}
			if len(buckets) != len(tc.want) {
				t.Fatalf("got %d buckets %+v, want %d", len(buckets), buckets, len(tc.want))
			}
			for _, b := range buckets {
				if want, ok := tc.want[b.Bucket]; !ok || b.Count != want {
					t.Errorf("bucket %s count = %d, want %d", b.Bucket, b.Count, want)
				}
				if b.CoverPhotoID == "" {
					t.Errorf("bucket %s has no cover", b.Bucket)
				}
			}
			// Buckets come back newest first.
			for i := 1; i < len(buckets); i++ {
				if buckets[i-1].Bucket < buckets[i].Bucket {
					t.Errorf("buckets not sorted DESC: %v", buckets)
					break
				}
			}
		})
	}
}

// ISO year-week is the one bucket expression that differs per dialect, so
// assert the shape and that it actually groups by week.
func TestTimelineWeekBuckets(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s,
		// Mon 2026-11-16 and Tue 2026-11-17 share an ISO week.
		photo("mon", "2026-11-16T10:00:00"),
		photo("tue", "2026-11-17T10:00:00"),
		// The following Monday starts the next one.
		photo("next", "2026-11-23T10:00:00"),
	)
	buckets, err := s.Timeline(ctx, "week",
		at("2020-01-01T00:00:00Z"), at("2030-01-01T00:00:00Z"))
	if err != nil {
		t.Fatalf("timeline week: %v", err)
	}
	if len(buckets) != 2 {
		t.Fatalf("got %d week buckets %+v, want 2", len(buckets), buckets)
	}
	shape := regexp.MustCompile(`^\d{4}-W\d{2}$`)
	counts := map[string]int{}
	for _, b := range buckets {
		if !shape.MatchString(b.Bucket) {
			t.Errorf("bucket %q does not look like an ISO year-week", b.Bucket)
		}
		counts[b.Bucket] = b.Count
	}
	foundPair := false
	for _, n := range counts {
		if n == 2 {
			foundPair = true
		}
	}
	if !foundPair {
		t.Errorf("no week bucket held both Mon and Tue: %+v", counts)
	}
}

// Favorites belong to the reader who pressed them, so two readers on the
// same shared photo never see each other's (ADR 0020).
func TestFavoritesArePerReader(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s, photo("p1", "2026-03-01T10:00:00"))

	got, err := s.SetFavorite(ctx, "reader-a", "p1", true)
	if err != nil {
		t.Fatalf("set favorite: %v", err)
	}
	if !got.Favorite {
		t.Error("favorite not set for the reader who set it")
	}

	other, err := s.GetPhoto(ctx, "reader-b", "p1")
	if err != nil {
		t.Fatalf("get as other reader: %v", err)
	}
	if other.Favorite {
		t.Error("one reader's favorite showed up for another")
	}

	// Un-hearting is also personal: it must not touch anyone else's.
	if _, err := s.SetFavorite(ctx, "reader-b", "p1", false); err != nil {
		t.Fatalf("unset: %v", err)
	}
	mine, _ := s.GetPhoto(ctx, "reader-a", "p1")
	if !mine.Favorite {
		t.Error("another reader's un-favorite removed mine")
	}
}

func TestUsers(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	u, err := s.UpsertUserByEmail(ctx, "Admin@Example.com", "Admin")
	if err != nil {
		t.Fatalf("upsert user: %v", err)
	}
	if u.Email != "admin@example.com" {
		t.Errorf("email = %q, want lowercased", u.Email)
	}
	if u.Key != UserKeyFromEmail("admin@example.com") {
		t.Errorf("key = %q", u.Key)
	}
	// An empty name must not clear the stored one.
	again, err := s.UpsertUserByEmail(ctx, "admin@example.com", "")
	if err != nil {
		t.Fatalf("re-upsert: %v", err)
	}
	if again.Name != "Admin" {
		t.Errorf("name = %q, want Admin preserved", again.Name)
	}
	renamed, err := s.UpsertUserByEmail(ctx, "admin@example.com", "Boss")
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if renamed.Name != "Boss" {
		t.Errorf("name = %q, want Boss", renamed.Name)
	}
	if _, err := s.GetUser(ctx, "missing"); err == nil {
		t.Error("GetUser(missing) should error")
	}
}

func TestSourceCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	now := at("2026-01-01T00:00:00Z")
	src := &Source{
		Name: "NAS", Type: "webdav", Location: "https://dav/photos",
		Username: "mv", Secret: "sealed", CreatedAt: now, UpdatedAt: now,
	}
	if err := s.CreateSource(ctx, src); err != nil {
		t.Fatalf("create: %v", err)
	}
	if src.Key == "" {
		t.Fatal("CreateSource did not assign a key")
	}
	got, err := s.GetSource(ctx, src.Key)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "NAS" || got.Secret != "sealed" || !got.CreatedAt.Equal(now) {
		t.Errorf("source = %+v", got)
	}
	src.Name = "NAS2"
	if err := s.ReplaceSource(ctx, src); err != nil {
		t.Fatalf("replace: %v", err)
	}
	got, _ = s.GetSource(ctx, src.Key)
	if got.Name != "NAS2" {
		t.Errorf("name = %q, want NAS2", got.Name)
	}
	if all, err := s.ListSources(ctx); err != nil || len(all) != 1 {
		t.Fatalf("list all = %+v err = %v", all, err)
	}
	if err := s.DeleteSource(ctx, src.Key); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetSource(ctx, src.Key); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
	if err := s.DeleteSource(ctx, src.Key); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete err = %v, want ErrNotFound", err)
	}
	if err := s.ReplaceSource(ctx, &Source{Key: "ghost"}); !errors.Is(err, ErrNotFound) {
		t.Errorf("replace missing err = %v, want ErrNotFound", err)
	}
}

func TestRelocatePhotoPrefix(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s,
		photo("a", "2026-03-01T10:00:00", func(p *Photo) {
			p.Storage = StoragePtr{Backend: "local", Path: "old/sub/a.jpg"}
		}),
		photo("b", "2026-03-02T10:00:00", func(p *Photo) {
			p.Storage = StoragePtr{Backend: "local", Path: "keep/b.jpg"}
		}),
	)
	if err := s.RelocatePhotoPrefix(ctx, "old", "src-new"); err != nil {
		t.Fatalf("relocate: %v", err)
	}
	a, _ := s.GetPhoto(ctx, "", "a")
	if a.Storage.Path != "src-new/sub/a.jpg" {
		t.Errorf("path = %q, want src-new/sub/a.jpg", a.Storage.Path)
	}
	if a.Storage.Backend != "source" {
		t.Errorf("backend = %q, want source", a.Storage.Backend)
	}
	b, _ := s.GetPhoto(ctx, "", "b")
	if b.Storage.Path != "keep/b.jpg" {
		t.Errorf("untouched path = %q", b.Storage.Path)
	}
}

func TestIndexRuns(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	// A missing run is (nil, nil), not an error.
	run, err := s.GetIndexRun(ctx)
	if err != nil || run != nil {
		t.Fatalf("run = %+v err = %v, want nil/nil", run, err)
	}
	started := at("2026-01-01T00:00:00Z")
	if err := s.UpsertIndexRun(ctx, &IndexRun{
		Key: IndexRunKey, Status: "running",
		Discovered: 10, StartedAt: &started, UpdatedAt: started,
	}); err != nil {
		t.Fatalf("upsert run: %v", err)
	}
	run, err = s.GetIndexRun(ctx)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != "running" || run.Discovered != 10 {
		t.Errorf("run = %+v", run)
	}
	if run.StartedAt == nil || !run.StartedAt.Equal(started) {
		t.Errorf("started_at = %v", run.StartedAt)
	}
	if run.FinishedAt != nil {
		t.Errorf("finished_at = %v, want nil", run.FinishedAt)
	}
	// Upsert again updates in place.
	finished := at("2026-01-01T01:00:00Z")
	if err := s.UpsertIndexRun(ctx, &IndexRun{
		Key: IndexRunKey, Status: "complete",
		Discovered: 10, Indexed: 10, StartedAt: &started,
		FinishedAt: &finished, UpdatedAt: finished,
	}); err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	runs, err := s.ListIndexRunsByStatus(ctx, "complete")
	if err != nil {
		t.Fatalf("list by status: %v", err)
	}
	if len(runs) != 1 || runs[0].Indexed != 10 {
		t.Fatalf("runs = %+v", runs)
	}
	if none, _ := s.ListIndexRunsByStatus(ctx, "running"); len(none) != 0 {
		t.Errorf("running runs = %+v, want none", none)
	}
}

func TestAlbums(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s,
		photo("p1", "2026-03-01T10:00:00"),
		photo("p2", "2026-03-05T10:00:00"),
		photo("other", "2026-03-05T10:00:00"),
	)
	if _, err := s.CreateAlbum(ctx, "owner-a", "  "); err == nil {
		t.Error("blank album name should error")
	}
	album, err := s.CreateAlbum(ctx, "owner-a", "  Trip  ")
	if err != nil {
		t.Fatalf("create album: %v", err)
	}
	if album.Name != "Trip" {
		t.Errorf("name = %q, want trimmed", album.Name)
	}
	if album.PhotoIDs == nil {
		t.Error("PhotoIDs must be an empty slice, not nil")
	}
	if _, err := s.AddPhotoToAlbum(ctx, "owner-a", album.ID, "p1"); err != nil {
		t.Fatalf("add p1: %v", err)
	}
	view, err := s.AddPhotoToAlbum(ctx, "owner-a", album.ID, "p2")
	if err != nil {
		t.Fatalf("add p2: %v", err)
	}
	if view.PhotoCount != 2 {
		t.Errorf("count = %d, want 2", view.PhotoCount)
	}
	// Newest first, so p2 leads and becomes the cover.
	if view.CoverPhotoID != "p2" {
		t.Errorf("cover = %q, want p2", view.CoverPhotoID)
	}
	// Adding twice is idempotent.
	if view, err = s.AddPhotoToAlbum(ctx, "owner-a", album.ID, "p2"); err != nil {
		t.Fatalf("re-add: %v", err)
	}
	if view.PhotoCount != 2 {
		t.Errorf("count after re-add = %d, want 2", view.PhotoCount)
	}
	// The Album is owned; the library is not. Another reader cannot touch
	// this Album, but any photo in the library may go into it (ADR 0020).
	if _, err := s.AddPhotoToAlbum(ctx, "owner-b", album.ID, "other"); !errors.Is(err, ErrForbidden) {
		t.Errorf("foreign owner err = %v, want ErrForbidden", err)
	}
	if _, err := s.AddPhotoToAlbum(ctx, "owner-a", album.ID, "other"); err != nil {
		t.Errorf("any library photo should be addable, got %v", err)
	}
	// Put it back as it was, so the ordering checks below are unaffected.
	if _, err := s.RemovePhotoFromAlbum(ctx, "owner-a", album.ID, "other"); err != nil {
		t.Fatalf("undo add: %v", err)
	}
	if _, err := s.GetAlbumView(ctx, "owner-b", album.ID); !errors.Is(err, ErrForbidden) {
		t.Errorf("foreign view err = %v, want ErrForbidden", err)
	}
	detail, err := s.GetAlbumView(ctx, "owner-a", album.ID)
	if err != nil {
		t.Fatalf("album view: %v", err)
	}
	if len(detail.Photos) != 2 || detail.Photos[0].Key != "p2" {
		t.Errorf("detail photos = %+v", detail.PhotoIDs)
	}
	// A soft-deleted member drops out of the detail view.
	if err := s.SoftDeletePhoto(ctx, "p2"); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	detail, _ = s.GetAlbumView(ctx, "owner-a", album.ID)
	if len(detail.Photos) != 1 || detail.Photos[0].Key != "p1" {
		t.Errorf("after delete, detail = %+v", detail.PhotoIDs)
	}
	if _, err := s.RemovePhotoFromAlbum(ctx, "owner-a", album.ID, "p1"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	detail, _ = s.GetAlbumView(ctx, "owner-a", album.ID)
	if len(detail.Photos) != 0 {
		t.Errorf("after remove, detail = %+v", detail.PhotoIDs)
	}
}

func TestListAlbumsOrdersNewestFirst(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	first, err := s.CreateAlbum(ctx, "owner-a", "First")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// CreatedAt comes from the clock, so force a distinct ordering.
	if _, err := s.exec(ctx, `UPDATE albums SET created_at = ? WHERE key = ?`,
		micros(at("2020-01-01T00:00:00Z")), first.ID); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	second, err := s.CreateAlbum(ctx, "owner-a", "Second")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	views, err := s.ListAlbums(ctx, "owner-a")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(views) != 2 {
		t.Fatalf("views = %+v", views)
	}
	if views[0].ID != second.ID || views[1].ID != first.ID {
		t.Errorf("order = %s,%s want %s,%s",
			views[0].Name, views[1].Name, "Second", "First")
	}
	if views[0].PhotoIDs == nil || views[1].PhotoIDs == nil {
		t.Error("empty albums must carry an empty slice, not nil")
	}
}

func TestClearOwnerAlbumsAndFavorites(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	mustUpsert(t, s,
		photo("p1", "2026-03-01T10:00:00"),
		photo("p2", "2026-03-01T10:00:00"),
	)
	if _, err := s.SetFavorite(ctx, "owner-a", "p1", true); err != nil {
		t.Fatalf("favorite p1: %v", err)
	}
	if _, err := s.SetFavorite(ctx, "owner-b", "p2", true); err != nil {
		t.Fatalf("favorite p2: %v", err)
	}
	album, _ := s.CreateAlbum(ctx, "owner-a", "Trip")
	if _, err := s.AddPhotoToAlbum(ctx, "owner-a", album.ID, "p1"); err != nil {
		t.Fatalf("add: %v", err)
	}
	if err := s.ClearOwnerAlbumsAndFavorites(ctx, "owner-a"); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if views, _ := s.ListAlbums(ctx, "owner-a"); len(views) != 0 {
		t.Errorf("albums = %+v, want none", views)
	}
	p1, _ := s.GetPhoto(ctx, "owner-a", "p1")
	if p1.Favorite {
		t.Error("owner-a favorite not cleared")
	}
	// The other reader's favorites are rows of their own and must survive.
	p2, _ := s.GetPhoto(ctx, "owner-b", "p2")
	if !p2.Favorite {
		t.Error("owner-b favorite was cleared")
	}
}

// Capture times before the Unix epoch are negative microseconds. BIGINT holds
// them and orders them correctly, but that is the kind of thing worth proving
// against a real database rather than reasoning about: a scanned negative from
// 1962 has to survive the round trip, sort before later photos, and be
// returned by the API's default unbounded-below window (ADR 0005).
func TestPhotosReturnsPreEpochCaptureTimes(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	film := photo("film", "1962-04-02T11:30:00")
	modern := photo("modern", "2026-08-31T10:00:00")
	mustUpsert(t, s, film, modern)

	// The window the API now uses when the SPA sends no from/to.
	from := time.Time{}
	to := time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)

	got, _, err := s.Photos(ctx, "reader", from, to, 50, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		keys := make([]string, 0, len(got))
		for _, p := range got {
			keys = append(keys, p.Key)
		}
		t.Fatalf("got %d photos %v, want both film and modern", len(got), keys)
	}
	// Newest first, so the pre-epoch one sorts last.
	if got[0].Key != "modern" || got[1].Key != "film" {
		t.Errorf("order = %s, %s; want modern, film", got[0].Key, got[1].Key)
	}
	if !got[1].TakenAt.Equal(film.TakenAt) {
		t.Errorf("round-tripped TakenAt = %s, want %s", got[1].TakenAt, film.TakenAt)
	}
	if got[1].TakenAt.Unix() >= 0 {
		t.Errorf("TakenAt %s is not actually pre-epoch, so this test proves nothing", got[1].TakenAt)
	}
}

// The same frame must reach the scrubber's histogram, which buckets on
// taken_at_local rather than the UTC instant.
func TestTimelineBucketsPreEpochCaptureTimes(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	mustUpsert(t, s, photo("film", "1962-04-02T11:30:00"))

	buckets, err := s.Timeline(ctx, "year", time.Time{},
		time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(buckets) != 1 || buckets[0].Bucket != "1962" {
		t.Fatalf("buckets = %+v, want one 1962 bucket", buckets)
	}
	if buckets[0].Count != 1 {
		t.Errorf("count = %d, want 1", buckets[0].Count)
	}
}
