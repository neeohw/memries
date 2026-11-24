package db

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"
	_ "modernc.org/sqlite"             // database/sql driver "sqlite", pure Go

	"github.com/memries/memries/internal/config"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Supported MEMRIES_DB_DRIVER values (ADR 0014).
const (
	DriverSQLite   = "sqlite"
	DriverPostgres = "postgres"
)

type dialect int

const (
	dialectSQLite dialect = iota
	dialectPostgres
)

// Store is the relational catalog. It satisfies api.Library,
// index.PhotoRepository, index.PhotoLister, index.RunStore,
// index.OwnerPhotoCounter and sources.Repo.
type Store struct {
	db      *sql.DB
	dialect dialect
}

// Connect opens the catalog, applies pending migrations, and returns a Store.
func Connect(ctx context.Context, cfg *config.Config) (*Store, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Database.Driver)) {
	case "", DriverSQLite:
		return openSQLite(ctx, cfg.Database.DSN)
	case DriverPostgres:
		return openPostgres(ctx, cfg.Database.DSN)
	default:
		return nil, fmt.Errorf("unsupported MEMRIES_DB_DRIVER %q (want %q or %q)",
			cfg.Database.Driver, DriverSQLite, DriverPostgres)
	}
}

func openSQLite(ctx context.Context, dsn string) (*Store, error) {
	if dsn == "" {
		return nil, errors.New("MEMRIES_DB_DSN is required for the sqlite driver")
	}
	if dir := filepath.Dir(dsn); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("catalog dir: %w", err)
		}
	}
	// WAL lets readers run while the indexer writes, and survives the indexer
	// running as a separate process against the same file. synchronous=NORMAL
	// is the right trade on eMMC: durable across process crashes, and only a
	// power cut during a commit can lose the last transaction.
	pragmas := strings.Join([]string{
		"_pragma=journal_mode(WAL)",
		"_pragma=synchronous(NORMAL)",
		"_pragma=busy_timeout(10000)",
		"_pragma=foreign_keys(1)",
	}, "&")
	sqlDB, err := sql.Open("sqlite", "file:"+dsn+"?"+pragmas)
	if err != nil {
		return nil, fmt.Errorf("sqlite open: %w", err)
	}
	// One connection on purpose. Catalog work is microseconds next to JPEG
	// decoding, so serializing it costs nothing measurable on four A53 cores
	// and removes every SQLITE_BUSY race. Index runs must keep their batches
	// bounded so a commit never holds this connection long.
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(0)
	return finishOpen(ctx, sqlDB, dialectSQLite)
}

func openPostgres(ctx context.Context, dsn string) (*Store, error) {
	if dsn == "" {
		return nil, errors.New("MEMRIES_DB_DSN is required for the postgres driver")
	}
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("postgres open: %w", err)
	}
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)
	return finishOpen(ctx, sqlDB, dialectPostgres)
}

func finishOpen(ctx context.Context, sqlDB *sql.DB, d dialect) (*Store, error) {
	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("db ping: %w", err)
	}
	s := &Store{db: sqlDB, dialect: d}
	if err := s.migrate(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

// rebind turns the "?" placeholders every query is written with into the
// "$1..$n" PostgreSQL wants. Migration and query text must not contain a
// literal "?" inside a string literal.
func (s *Store) rebind(q string) string {
	if s.dialect != dialectPostgres {
		return q
	}
	var b strings.Builder
	b.Grow(len(q) + 8)
	n := 0
	for i := 0; i < len(q); i++ {
		if q[i] != '?' {
			b.WriteByte(q[i])
			continue
		}
		n++
		b.WriteByte('$')
		b.WriteString(strconv.Itoa(n))
	}
	return b.String()
}

func (s *Store) query(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	return s.db.QueryContext(ctx, s.rebind(q), args...)
}

func (s *Store) queryRow(ctx context.Context, q string, args ...any) *sql.Row {
	return s.db.QueryRowContext(ctx, s.rebind(q), args...)
}

func (s *Store) exec(ctx context.Context, q string, args ...any) (sql.Result, error) {
	return s.db.ExecContext(ctx, s.rebind(q), args...)
}

// tx runs fn inside a transaction, rolling back on error or panic.
func (s *Store) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	t, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = t.Rollback()
			panic(p)
		}
	}()
	if err := fn(t); err != nil {
		_ = t.Rollback()
		return err
	}
	return t.Commit()
}

// weekExpr renders an ISO year-week ("2026-W46") from a taken_at_local column.
// The only bucketing expression that differs between the two dialects.
func (s *Store) weekExpr(col string) string {
	if s.dialect == dialectPostgres {
		return fmt.Sprintf(
			"to_char(to_date(substr(%s, 1, 10), 'YYYY-MM-DD'), 'IYYY-\"W\"IW')", col)
	}
	return fmt.Sprintf(
		"strftime('%%G-W%%V', substr(%s, 1, 10))", col)
}

// --- migrations ---------------------------------------------------------

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    BIGINT PRIMARY KEY,
		applied_at BIGINT NOT NULL
	)`); err != nil {
		return fmt.Errorf("schema_migrations: %w", err)
	}
	applied, err := s.appliedVersions(ctx)
	if err != nil {
		return err
	}
	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		version, err := versionFromName(name)
		if err != nil {
			return err
		}
		if applied[version] {
			continue
		}
		body, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		statements := splitStatements(string(body))
		err = s.tx(ctx, func(t *sql.Tx) error {
			for _, stmt := range statements {
				if _, err := t.ExecContext(ctx, stmt); err != nil {
					return fmt.Errorf("%s: %q: %w", name, firstLine(stmt), err)
				}
			}
			_, err := t.ExecContext(ctx,
				s.rebind(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`),
				version, time.Now().UTC().UnixMicro())
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) appliedVersions(ctx context.Context) (map[int64]bool, error) {
	rows, err := s.query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out[v] = true
	}
	return out, rows.Err()
}

func versionFromName(name string) (int64, error) {
	cut := strings.IndexByte(name, '_')
	if cut <= 0 {
		return 0, fmt.Errorf("migration %q must be named <version>_<description>.sql", name)
	}
	v, err := strconv.ParseInt(name[:cut], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("migration %q: bad version: %w", name, err)
	}
	return v, nil
}

// splitStatements strips "--" line comments and splits on ";". pgx's extended
// protocol refuses multi-statement Exec, so each statement goes separately.
// Migration files therefore must not contain ";" inside a string literal.
func splitStatements(body string) []string {
	var clean strings.Builder
	for _, line := range strings.Split(body, "\n") {
		if cut := strings.Index(line, "--"); cut >= 0 {
			line = line[:cut]
		}
		clean.WriteString(line)
		clean.WriteByte('\n')
	}
	var out []string
	for _, stmt := range strings.Split(clean.String(), ";") {
		if s := strings.TrimSpace(stmt); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func firstLine(stmt string) string {
	stmt = strings.TrimSpace(stmt)
	if i := strings.IndexByte(stmt, '\n'); i >= 0 {
		stmt = stmt[:i]
	}
	if len(stmt) > 60 {
		stmt = stmt[:60] + "..."
	}
	return stmt
}
