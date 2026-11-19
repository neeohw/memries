package db

import "time"

type Dims struct {
	W int `json:"w"`
	H int `json:"h"`
}

type GPS struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type EXIF struct {
	Camera  string  `json:"camera,omitempty"`
	Lens    string  `json:"lens,omitempty"`
	ISO     int     `json:"iso,omitempty"`
	FNum    float64 `json:"f_number,omitempty"`
	Shutter string  `json:"shutter,omitempty"`
	GPS     *GPS    `json:"gps,omitempty"`
}

type StoragePtr struct {
	Backend string     `json:"backend"`
	Path    string     `json:"path"`
	Bucket  string     `json:"bucket,omitempty"`
	ModTime *time.Time `json:"mtime,omitempty"` // Source mtime at last index; with size, skips re-reading unchanged files
}

type Thumbs struct {
	S256  string `json:"256,omitempty"`
	S512  string `json:"512,omitempty"`
	S1024 string `json:"1024,omitempty"`
}

type Photo struct {
	Key           string    `json:"_key"`
	Kind          string    `json:"kind"` // photo|video
	TakenAt       time.Time `json:"taken_at"`
	TakenAtLocal  string    `json:"taken_at_local,omitempty"`
	TakenAtSource string    `json:"taken_at_source,omitempty"`
	TZOffset      int       `json:"tz_offset"`
	// Favorite is this request's reader's own, read from the favorites table
	// rather than stored on the row (ADR 0020).
	Favorite    bool       `json:"favorite"`
	Storage     StoragePtr `json:"storage"`
	Hash        string     `json:"hash"`
	SizeBytes   int64      `json:"size_bytes"`
	MIME        string     `json:"mime"`
	Dims        Dims       `json:"dims"`
	Orientation int        `json:"orientation"`
	EXIF        EXIF       `json:"exif"`
	Thumbs      Thumbs     `json:"thumbs"`
	ImportedAt  time.Time  `json:"imported_at"`
	DeletedAt   *time.Time `json:"deleted_at"`
}

type User struct {
	Key   string `json:"_key"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
	// PasswordHash is an encoded argon2id hash (ADR 0016), empty when the user
	// has no password yet. It is never serialised: no handler returns it, and
	// `json:"-"` keeps it out of a response if one ever marshals a User.
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

// Source is an admin-managed folder (a local path on the server, or a WebDAV
// collection) whose media is indexed into the library. Sources are
// server-wide, not per reader (ADR 0020). Photo storage paths are
// "<source _key>/<path inside the source>".
type Source struct {
	Key      string `json:"_key,omitempty"`
	Name     string `json:"name"`
	Type     string `json:"type"`     // local|webdav
	Location string `json:"location"` // /abs/path or https://host/dav/dir
	Username string `json:"username,omitempty"`
	Secret   string `json:"secret,omitempty"` // sealed password; never leaves the backend
	// Excludes are regular expressions matched against each directory's path
	// below the Source root. A matching tree is never walked (ADR 0020).
	Excludes  []string  `json:"excludes,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Album struct {
	Key        string    `json:"_key"`
	Name       string    `json:"name"`
	OwnerID    string    `json:"owner_id"`
	Visibility string    `json:"visibility"`
	CreatedAt  time.Time `json:"created_at"`
}

// IndexRun is the state of the one index run there is: the library is
// server-wide, so there is nothing to key a second one by (ADR 0020).
type IndexRun struct {
	Key        string     `json:"_key"`
	Prefix     string     `json:"prefix"`
	Status     string     `json:"status"`
	Discovered int        `json:"discovered"`
	Processed  int        `json:"processed"`
	Indexed    int        `json:"indexed"`
	Skipped    int        `json:"skipped"`
	Failed     int        `json:"failed"`
	Error      string     `json:"error,omitempty"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	UpdatedAt  time.Time  `json:"updated_at"`
}
