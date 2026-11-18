package db

import (
	"context"
	"database/sql"
	"errors"
)

const indexRunColumns = `key, owner_id, prefix, status, discovered, processed,
	indexed, skipped, failed, error, started_at, finished_at, updated_at`

func scanIndexRun(sc rowScanner) (*IndexRun, error) {
	var (
		run               IndexRun
		started, finished sql.NullInt64
		updatedAt         int64
	)
	err := sc.Scan(
		&run.Key, &run.OwnerID, &run.Prefix, &run.Status,
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

// GetIndexRun returns the Owner's run, or (nil, nil) when none exists. The run
// key is the owner key: one current run per Owner (ADR 0004).
func (s *Store) GetIndexRun(ctx context.Context, ownerID string) (*IndexRun, error) {
	run, err := scanIndexRun(s.queryRow(ctx,
		`SELECT `+indexRunColumns+` FROM index_runs WHERE key = ?`, ownerID))
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
		run.Key, run.OwnerID, run.Prefix, run.Status,
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
