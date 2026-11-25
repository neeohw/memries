package db

import (
	"context"
	"strings"
)

// YearSummary is one calendar year of the library, sampled rather than
// listed: a handful of photos per month, plus how many the year really holds.
//
// It exists because year view is a way of getting to a year, not a way of
// reading one. Paging 11,000 photos through the feed to reach 2019 is the
// wrong shape for that, so the server answers the whole question at once
// (ADR 0031).
type YearSummary struct {
	Year string `json:"year"`
	// Count is every live photo in the year, not the number sampled, so the
	// interface can say what zooming in would reveal.
	Count int `json:"count"`
	// Photos are the sample, newest first.
	Photos []Photo `json:"photos"`
}

// Bounds on the sample. One per month is too thin to recognise a year by, and
// a dozen is already a screenful per year at thumbnail size — past that the
// summary stops being one.
const (
	MinSummaryPerMonth     = 1
	MaxSummaryPerMonth     = 12
	DefaultSummaryPerMonth = 3
)

// ClampSummaryPerMonth keeps a client-supplied sample size inside the bounds.
// Zero means "unset" and takes the default, so a missing parameter and a
// nonsense one behave the same.
func ClampSummaryPerMonth(n int) int {
	if n <= 0 {
		return DefaultSummaryPerMonth
	}
	if n < MinSummaryPerMonth {
		return MinSummaryPerMonth
	}
	if n > MaxSummaryPerMonth {
		return MaxSummaryPerMonth
	}
	return n
}

// YearSummaries samples the whole library: up to perMonth photos from every
// month, grouped into years, newest year first.
//
// Two queries rather than one. The totals are a GROUP BY over the year and the
// sample is a windowed pick per month; doing both at once would either repeat
// the count on every sampled row or push the grouping into the handler, and
// the pair reads as what it is.
//
// Rows with no local capture clock are skipped, exactly as Timeline skips
// them: a photo that cannot be placed in a calendar has no year to summarise.
func (s *Store) YearSummaries(ctx context.Context, viewer string, perMonth int) ([]YearSummary, error) {
	perMonth = ClampSummaryPerMonth(perMonth)
	counts, order, err := s.yearCounts(ctx)
	if err != nil {
		return nil, err
	}
	sampled, err := s.sampleByMonth(ctx, viewer, perMonth)
	if err != nil {
		return nil, err
	}

	byYear := make(map[string][]Photo, len(order))
	for _, p := range sampled {
		year := yearOf(p)
		byYear[year] = append(byYear[year], p)
	}
	out := make([]YearSummary, 0, len(order))
	for _, year := range order {
		out = append(out, YearSummary{Year: year, Count: counts[year], Photos: byYear[year]})
	}
	return out, nil
}

// yearCounts is every live photo per year, plus the years newest-first. The
// order comes from the query rather than from sorting the map, so the two
// dialects agree on it.
func (s *Store) yearCounts(ctx context.Context) (map[string]int, []string, error) {
	year := s.bucketExpr("year")
	q := `SELECT ` + year + ` AS y, COUNT(*) FROM photos
		WHERE deleted_at IS NULL AND taken_at_local <> ''
		GROUP BY ` + year + `
		ORDER BY y DESC`
	rows, err := s.query(ctx, q)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	var order []string
	for rows.Next() {
		var (
			y string
			n int
		)
		if err := rows.Scan(&y, &n); err != nil {
			return nil, nil, err
		}
		counts[y] = n
		order = append(order, y)
	}
	return counts, order, rows.Err()
}

// sampleByMonth returns the newest perMonth photos of every month in the
// library, newest first overall.
//
// The window partitions by month and not by year because a year sampled as a
// whole is whatever December happened to hold. A few per month is what makes
// the strip read as a year: the seasons are in it.
func (s *Store) sampleByMonth(ctx context.Context, viewer string, perMonth int) ([]Photo, error) {
	month := s.bucketExpr("month")
	// No placeholder inside the CTE, so the viewer argument of favoriteExpr is
	// still the first one the query text reaches.
	q := `WITH ranked AS (
		  SELECT key, ROW_NUMBER() OVER (
		           PARTITION BY ` + month + `
		           ORDER BY taken_at DESC, key DESC
		         ) AS rn
		  FROM photos
		  WHERE deleted_at IS NULL AND taken_at_local <> ''
		)
		SELECT ` + photoColumns + favoriteExpr + ` FROM photos
		WHERE photos.key IN (SELECT key FROM ranked WHERE rn <= ?)
		ORDER BY taken_at DESC, key DESC`
	rows, err := s.query(ctx, q, viewer, perMonth)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Photo
	for rows.Next() {
		p, err := scanPhoto(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// yearOf reads the year off the local capture clock, which is the same text
// the SQL bucketed on. Deriving it from TakenAt instead would put a photo
// taken at 23:00 on New Year's Eve in the wrong year's strip.
func yearOf(p Photo) string {
	if len(p.TakenAtLocal) >= 4 {
		return p.TakenAtLocal[:4]
	}
	return strings.TrimSpace(p.TakenAtLocal)
}
