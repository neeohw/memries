package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// SettingThumbnailRoot is the directory holding the generated thumbnail
// ladder. The paths stored on each Photo are relative to it, so moving the
// root does not rewrite a single catalog row (ADR 0022).
const SettingThumbnailRoot = "thumbnail_root"

// Setting reads one setting. A missing key returns "" and no error: the
// caller's env default stands in, which is what a fresh install has.
func (s *Store) Setting(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx,
		s.rebind(`SELECT value FROM settings WHERE key = ?`), key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return value, nil
}

// SetSetting writes one setting.
func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	now := time.Now().UnixMicro()
	_, err := s.db.ExecContext(ctx, s.rebind(`
		INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
		key, value, now)
	return err
}
