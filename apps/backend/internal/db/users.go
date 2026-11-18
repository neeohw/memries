package db

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

const userColumns = `key, email, name, role, password_hash, sources_migrated, created_at`

func UserKeyFromEmail(email string) string {
	sum := sha1.Sum([]byte(strings.ToLower(email)))
	return hex.EncodeToString(sum[:])
}

func scanUser(sc rowScanner) (*User, error) {
	var (
		u         User
		migrated  boolVal
		createdAt int64
	)
	err := sc.Scan(&u.Key, &u.Email, &u.Name, &u.Role, &u.PasswordHash, &migrated, &createdAt)
	if err != nil {
		return nil, err
	}
	u.SourcesMigrated = bool(migrated)
	u.CreatedAt = fromMicros(createdAt)
	return &u, nil
}

func (s *Store) UpsertUserByEmail(ctx context.Context, email, name string) (*User, error) {
	key := UserKeyFromEmail(email)
	email = strings.ToLower(email)
	// A non-empty name refreshes the stored one; an empty name never clears it.
	// password_hash is deliberately absent: upserting a user must never reset
	// their password.
	if _, err := s.exec(ctx, `
		INSERT INTO users (key, email, name, role, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (key) DO UPDATE SET
		  name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE users.name END`,
		key, email, name, "user", micros(time.Now().UTC())); err != nil {
		return nil, err
	}
	return s.GetUser(ctx, key)
}

func (s *Store) GetUser(ctx context.Context, key string) (*User, error) {
	u, err := scanUser(s.queryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE key = ?`, key))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errors.New("user not found")
	}
	return u, err
}

// GetUserByEmail looks a user up by address, which is what the sign-in form
// submits. Addresses are stored lowercased, so the lookup is case-insensitive.
// A missing user is ErrNotFound rather than a nil pair, so the caller cannot
// mistake "no such account" for success.
func (s *Store) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	u, err := scanUser(s.queryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE email = ?`,
		strings.ToLower(strings.TrimSpace(email))))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

// SetPasswordHash stores an encoded argon2id hash (ADR 0016). The hash is
// opaque here: this package never parses or compares it.
func (s *Store) SetPasswordHash(ctx context.Context, key, hash string) error {
	res, err := s.exec(ctx, `UPDATE users SET password_hash = ? WHERE key = ?`, hash, key)
	if err != nil {
		return err
	}
	return errIfNoRows(res)
}
