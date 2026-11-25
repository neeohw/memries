package db

import (
	"context"
	"fmt"
	"testing"
)

// seedYears writes perMonth*2 photos into every month of each year, so every
// month has more than any sample would take.
func seedYears(t *testing.T, s *Store, years []int, perMonthPhotos int) {
	t.Helper()
	ctx := context.Background()
	for _, year := range years {
		for month := 1; month <= 12; month++ {
			for i := 0; i < perMonthPhotos; i++ {
				local := fmt.Sprintf("%04d-%02d-%02dT12:00:00", year, month, i+1)
				key := fmt.Sprintf("p-%04d-%02d-%02d", year, month, i+1)
				if err := s.UpsertPhoto(ctx, photo(key, local)); err != nil {
					t.Fatalf("upsert %s: %v", key, err)
				}
			}
		}
	}
}

func TestYearSummariesSamplesEachMonth(t *testing.T) {
	s := newTestStore(t)
	seedYears(t, s, []int{2024, 2026}, 5)

	years, err := s.YearSummaries(context.Background(), "", 3)
	if err != nil {
		t.Fatalf("summaries: %v", err)
	}
	if len(years) != 2 {
		t.Fatalf("years = %d, want 2", len(years))
	}
	if years[0].Year != "2026" || years[1].Year != "2024" {
		t.Fatalf("order = %q, %q; want newest first", years[0].Year, years[1].Year)
	}
	for _, y := range years {
		// The count is the whole year, not the sample.
		if y.Count != 12*5 {
			t.Errorf("%s count = %d, want 60", y.Year, y.Count)
		}
		if len(y.Photos) != 12*3 {
			t.Errorf("%s sampled %d photos, want 36", y.Year, len(y.Photos))
		}
		months := map[string]int{}
		for _, p := range y.Photos {
			months[p.TakenAtLocal[:7]]++
		}
		if len(months) != 12 {
			t.Errorf("%s covered %d months, want 12", y.Year, len(months))
		}
		for month, n := range months {
			if n != 3 {
				t.Errorf("%s: month %s has %d photos, want 3", y.Year, month, n)
			}
		}
	}
}

func TestYearSummariesTakesNewestOfEachMonth(t *testing.T) {
	s := newTestStore(t)
	seedYears(t, s, []int{2026}, 4)

	years, err := s.YearSummaries(context.Background(), "", 2)
	if err != nil {
		t.Fatalf("summaries: %v", err)
	}
	var march []string
	for _, p := range years[0].Photos {
		if p.TakenAtLocal[:7] == "2026-03" {
			march = append(march, p.Key)
		}
	}
	// Days 1-4 exist; the sample is the two newest, newest first.
	want := []string{"p-2026-03-04", "p-2026-03-03"}
	if len(march) != len(want) {
		t.Fatalf("march sample = %v, want %v", march, want)
	}
	for i, key := range want {
		if march[i] != key {
			t.Fatalf("march sample = %v, want %v", march, want)
		}
	}
}

func TestYearSummariesSkipsDeletedAndUndated(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedYears(t, s, []int{2026}, 2)
	if err := s.SoftDeletePhoto(ctx, "p-2026-01-01"); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	undated := photo("p-undated", "2026-01-01T00:00:00")
	undated.TakenAtLocal = ""
	if err := s.UpsertPhoto(ctx, undated); err != nil {
		t.Fatalf("upsert undated: %v", err)
	}

	years, err := s.YearSummaries(ctx, "", 12)
	if err != nil {
		t.Fatalf("summaries: %v", err)
	}
	if len(years) != 1 {
		t.Fatalf("years = %d, want 1 (a photo with no capture clock has no year)", len(years))
	}
	if years[0].Count != 23 {
		t.Errorf("count = %d, want 23", years[0].Count)
	}
	for _, p := range years[0].Photos {
		if p.Key == "p-2026-01-01" || p.Key == "p-undated" {
			t.Errorf("sample contains %s", p.Key)
		}
	}
}

func TestYearSummariesReadsTheViewersFavorites(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedYears(t, s, []int{2026}, 1)
	if _, err := s.SetFavorite(ctx, "reader", "p-2026-06-01", true); err != nil {
		t.Fatalf("favorite: %v", err)
	}

	years, err := s.YearSummaries(ctx, "reader", 1)
	if err != nil {
		t.Fatalf("summaries: %v", err)
	}
	var found bool
	for _, p := range years[0].Photos {
		if p.Key == "p-2026-06-01" {
			found = p.Favorite
		} else if p.Favorite {
			t.Errorf("%s came back favorited for reader", p.Key)
		}
	}
	if !found {
		t.Error("the reader's own favorite did not come back favorited")
	}

	other, err := s.YearSummaries(ctx, "someone-else", 1)
	if err != nil {
		t.Fatalf("summaries: %v", err)
	}
	for _, p := range other[0].Photos {
		if p.Favorite {
			t.Errorf("%s is favorited for a reader who never pressed it", p.Key)
		}
	}
}

func TestClampSummaryPerMonth(t *testing.T) {
	cases := map[int]int{0: DefaultSummaryPerMonth, -4: DefaultSummaryPerMonth, 1: 1, 5: 5, 99: MaxSummaryPerMonth}
	for in, want := range cases {
		if got := ClampSummaryPerMonth(in); got != want {
			t.Errorf("ClampSummaryPerMonth(%d) = %d, want %d", in, got, want)
		}
	}
}
