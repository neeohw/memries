package db

import (
	"context"
	"database/sql"
	"errors"
)

const indexRunColumns = `key, prefix, status, discovered, processed,
	indexed, skipped, failed, error, started_at, finished_at, updated_at`

func scanIndexRun(sc rowScanner) (*IndexRun, error) {
	var (
		run               IndexRun
		started, finished sql.NullInt64
		updatedAt         int64
	)
	err := sc.Scan(
		&run.Key, &run.Prefix, &run.Status,
		&run.Discovered, &run.Processed, &run.Indexed, &run.Skipped, &run.Failed,
		&run.Error, &started, &finished, &updatedAt,
	)
	if err != nil {
		return nil, err
	}
	run.StartedAt = timeFromNull(started)
	run.FinishedAt = timeFromNull(finished)
	run.UpdatedAt = fromMicros(updatedAt)
	return &run, nil
}

// IndexRunKey is the key of the one run row. The library is server-wide, so
// there is nothing to key a second one by (ADR 0020).
const IndexRunKey = "library"

// GetIndexRun returns the current run, or (nil, nil) when none exists.
func (s *Store) GetIndexRun(ctx context.Context) (*IndexRun, error) {
	run, err := scanIndexRun(s.queryRow(ctx,
		`SELECT `+indexRunColumns+` FROM index_runs WHERE key = ?`, IndexRunKey))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return run, nil
}

func (s *Store) UpsertIndexRun(ctx context.Context, run *IndexRun) error {
	cols := compactColumns(indexRunColumns)
	q := `INSERT INTO index_runs (` + cols + `) VALUES (` +
		placeholders(len(splitColumns(cols))) + `)
		ON CONFLICT (key) DO UPDATE SET ` + excludedAssignments(cols, "key")
	_, err := s.exec(ctx, q,
		run.Key, run.Prefix, run.Status,
		run.Discovered, run.Processed, run.Indexed, run.Skipped, run.Failed,
		run.Error, nullMicros(run.StartedAt), nullMicros(run.FinishedAt),
		micros(run.UpdatedAt))
	return err
}

func (s *Store) ListIndexRunsByStatus(ctx context.Context, status string) ([]IndexRun, error) {
	rows, err := s.query(ctx,
		`SELECT `+indexRunColumns+` FROM index_runs WHERE status = ?`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IndexRun
	for rows.Next() {
		run, err := scanIndexRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *run)
	}
	return out, rows.Err()
}
