-- 0001_init: the catalog.
--
-- The library is server-wide: photos have no owner and every signed-in
-- reader sees the same timeline (ADR 0020). What stays personal is what a
-- reader does with it — favorites and albums.
--
-- Portable DDL: every type and clause here is accepted by both SQLite
-- (modernc.org/sqlite) and PostgreSQL. Timestamps are unix MICROSECONDS in
-- BIGINT columns, because SQLite has no timestamp type and an integer sorts
-- correctly, keeps the composite cursor comparison exact, and leaves no
-- timezone ambiguity. taken_at_local stays TEXT ("YYYY-MM-DDTHH:MM:SS")
-- because the date filters substring it.

CREATE TABLE IF NOT EXISTS users (
  key              TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  name             TEXT NOT NULL DEFAULT '',
  role             TEXT NOT NULL DEFAULT 'user',
  -- argon2id encoded hash (ADR 0016). Empty means the user cannot log in
  -- with a password yet.
  password_hash    TEXT NOT NULL DEFAULT '',
  -- Preferred interface language: 'en', 'nl', or empty to follow whatever
  -- the reader's browser asks for (ADR 0021).
  locale           TEXT NOT NULL DEFAULT '',
  created_at       BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS photos (
  key              TEXT PRIMARY KEY,
  kind             TEXT NOT NULL DEFAULT 'photo',
  taken_at         BIGINT NOT NULL,
  taken_at_local   TEXT NOT NULL DEFAULT '',
  taken_at_source  TEXT NOT NULL DEFAULT '',
  tz_offset        INTEGER NOT NULL DEFAULT 0,
  hash             TEXT NOT NULL,
  size_bytes       BIGINT NOT NULL DEFAULT 0,
  mime             TEXT NOT NULL DEFAULT '',
  width            INTEGER NOT NULL DEFAULT 0,
  height           INTEGER NOT NULL DEFAULT 0,
  orientation      INTEGER NOT NULL DEFAULT 1,
  storage_backend  TEXT NOT NULL DEFAULT '',
  storage_path     TEXT NOT NULL DEFAULT '',
  storage_bucket   TEXT NOT NULL DEFAULT '',
  storage_mtime    BIGINT,
  exif_camera      TEXT NOT NULL DEFAULT '',
  exif_lens        TEXT NOT NULL DEFAULT '',
  exif_iso         INTEGER NOT NULL DEFAULT 0,
  exif_f_number    DOUBLE PRECISION NOT NULL DEFAULT 0,
  exif_shutter     TEXT NOT NULL DEFAULT '',
  exif_gps_lat     DOUBLE PRECISION,
  exif_gps_lon     DOUBLE PRECISION,
  thumb_256        TEXT NOT NULL DEFAULT '',
  thumb_512        TEXT NOT NULL DEFAULT '',
  thumb_1024       TEXT NOT NULL DEFAULT '',
  -- Written only for originals a browser cannot display, such as HEIC; the
  -- viewer opens this instead of the original bytes (ADR 0025).
  thumb_2048       TEXT NOT NULL DEFAULT '',
  imported_at      BIGINT NOT NULL,
  deleted_at       BIGINT
);

-- Serves the composite cursor (taken_at DESC, key DESC) as one index scan.
-- This is the hot path for every timeline page (ADR 0005).
CREATE INDEX IF NOT EXISTS idx_photos_taken
  ON photos (taken_at DESC, key DESC);

-- One library, so one copy of a file however many folders hold it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_hash ON photos (hash);

-- Identity-by-path lookup during an index run.
CREATE INDEX IF NOT EXISTS idx_photos_path ON photos (storage_path);

-- Smart-date filters substring taken_at_local (ADR 0008).
CREATE INDEX IF NOT EXISTS idx_photos_local ON photos (taken_at_local);

-- Favorites are per reader, not per photo: the library is shared, but a
-- heart belongs to whoever pressed it (ADR 0020).
CREATE TABLE IF NOT EXISTS favorites (
  user_key   TEXT NOT NULL,
  photo_key  TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_key, photo_key)
);

-- Serves "my favorites, newest first" as a join against idx_photos_taken.
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (user_key);

CREATE TABLE IF NOT EXISTS albums (
  key        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_albums_owner ON albums (owner_id);

-- Replaces the in_album edge collection, which was only ever a join table.
CREATE TABLE IF NOT EXISTS album_photos (
  album_key TEXT NOT NULL,
  photo_key TEXT NOT NULL,
  added_at  BIGINT NOT NULL,
  PRIMARY KEY (album_key, photo_key)
);

CREATE INDEX IF NOT EXISTS idx_album_photos_photo ON album_photos (photo_key);

-- One row, because there is one library to index (ADR 0020).
CREATE TABLE IF NOT EXISTS index_runs (
  key         TEXT PRIMARY KEY,
  prefix      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  discovered  INTEGER NOT NULL DEFAULT 0,
  processed   INTEGER NOT NULL DEFAULT 0,
  indexed     INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  error       TEXT NOT NULL DEFAULT '',
  started_at  BIGINT,
  finished_at BIGINT,
  updated_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_index_runs_status ON index_runs (status);

CREATE TABLE IF NOT EXISTS sources (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  location    TEXT NOT NULL,
  username    TEXT NOT NULL DEFAULT '',
  -- Password sealed with a key derived from MEMRIES_SESSION_KEY (ADR 0013).
  secret      TEXT NOT NULL DEFAULT '',
  -- JSON array of regular expressions matched against each directory's path
  -- below this Source's root; a matching tree is never walked (ADR 0020).
  -- TEXT rather than a child table: read and written only as a whole, always
  -- with their Source, never queried individually.
  excludes    TEXT NOT NULL DEFAULT '',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

