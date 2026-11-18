package sources

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/storage"
)

// Backend is the StoragePtr.Backend value for Photos read through a Source.
const Backend = "source"

type Repo interface {
	ListSources(ctx context.Context) ([]db.Source, error)
	ListOwnerSources(ctx context.Context, ownerID string) ([]db.Source, error)
	GetSource(ctx context.Context, key string) (*db.Source, error)
	CreateSource(ctx context.Context, s *db.Source) error
	ReplaceSource(ctx context.Context, s *db.Source) error
	DeleteSource(ctx context.Context, key string) error
	OwnerSourcesMigrated(ctx context.Context, ownerID string) (bool, error)
	MarkOwnerSourcesMigrated(ctx context.Context, ownerID string) error
	RelocatePhotoPrefix(ctx context.Context, ownerID, oldPrefix, newPrefix string) error
}

// Registry owns the Source catalog and exposes every Source as one read-only
// storage.Storage whose keys are "<source id>/<path inside the source>".
// Thumbs never go here: they are written to the local cache by thumb.Generator.
type Registry struct {
	Repo   Repo
	Sealer *Sealer
	// Roots are the directories local Sources must live under.
	Roots []string
	// LegacyRoot holds pre-Source libraries at <LegacyRoot>/<owner email>.
	LegacyRoot string
	Log        *slog.Logger
	// Open builds a backend for a Source; tests swap it. Defaults to OpenStore.
	Open func(src db.Source, password string, roots []string) (storage.Storage, error)

	mu      sync.Mutex
	stores  map[string]storage.Storage
	migrate sync.Mutex
}

// Input is the admin form for creating or editing a Source.
type Input struct {
	Name       string  `json:"name"`
	Type       string  `json:"type"`
	Location   string  `json:"location"`
	Username   string  `json:"username"`
	Password   *string `json:"password"` // nil keeps the stored password on update
	OwnerEmail string  `json:"owner_email"`
}

// View is a Source as the admin UI sees it: never includes the password.
type View struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	Location    string    `json:"location"`
	Username    string    `json:"username,omitempty"`
	HasPassword bool      `json:"has_password"`
	OwnerID     string    `json:"owner_id"`
	OwnerEmail  string    `json:"owner_email"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func viewOf(s db.Source) View {
	return View{
		ID:          s.Key,
		Name:        s.Name,
		Type:        s.Type,
		Location:    s.Location,
		Username:    s.Username,
		HasPassword: s.Secret != "",
		OwnerID:     s.OwnerID,
		OwnerEmail:  s.OwnerEmail,
		CreatedAt:   s.CreatedAt,
		UpdatedAt:   s.UpdatedAt,
	}
}

// ---- storage.Storage ----

func (r *Registry) Backend() string { return Backend }

func (r *Registry) Put(context.Context, string, io.Reader) error { return storage.ErrReadOnly }
func (r *Registry) Delete(context.Context, string) error         { return storage.ErrReadOnly }

func (r *Registry) URL(context.Context, string, time.Duration) (string, error) {
	return "", storage.ErrReadOnly
}

func (r *Registry) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	st, rest, err := r.route(ctx, key)
	if err != nil {
		return nil, err
	}
	return st.Get(ctx, rest)
}

func (r *Registry) Stat(ctx context.Context, key string) (storage.ObjectInfo, error) {
	st, rest, err := r.route(ctx, key)
	if err != nil {
		return storage.ObjectInfo{}, err
	}
	info, err := st.Stat(ctx, rest)
	info.Key = key
	return info, err
}

func (r *Registry) Walk(ctx context.Context, prefix string, fn func(storage.ObjectInfo) error) error {
	id, rest := splitKey(prefix)
	if id == "" {
		return fmt.Errorf("walk needs a source id prefix")
	}
	st, err := r.store(ctx, id)
	if err != nil {
		return err
	}
	return st.Walk(ctx, rest, func(o storage.ObjectInfo) error {
		o.Key = id + "/" + o.Key
		return fn(o)
	})
}

func (r *Registry) route(ctx context.Context, key string) (storage.Storage, string, error) {
	id, rest := splitKey(key)
	if id == "" || rest == "" {
		return nil, "", fmt.Errorf("%w: %q is not a source path", fs.ErrNotExist, key)
	}
	st, err := r.store(ctx, id)
	return st, rest, err
}

func splitKey(key string) (id, rest string) {
	key = strings.Trim(key, "/")
	id, rest, _ = strings.Cut(key, "/")
	return id, rest
}

// store returns the cached backend for a Source. A deleted Source reports
// fs.ErrNotExist so the indexer prunes its Photos.
func (r *Registry) store(ctx context.Context, id string) (storage.Storage, error) {
	r.mu.Lock()
	if st, ok := r.stores[id]; ok {
		r.mu.Unlock()
		return st, nil
	}
	r.mu.Unlock()

	src, err := r.Repo.GetSource(ctx, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, fmt.Errorf("%w: source %s was removed", fs.ErrNotExist, id)
		}
		return nil, err
	}
	st, err := r.openSource(*src)
	if err != nil {
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.stores[id]; ok {
		closeStore(st)
		return existing, nil
	}
	if r.stores == nil {
		r.stores = map[string]storage.Storage{}
	}
	r.stores[id] = st
	return st, nil
}

func (r *Registry) openSource(src db.Source) (storage.Storage, error) {
	password, err := r.Sealer.Open(src.Secret)
	if err != nil {
		return nil, err
	}
	open := r.Open
	if open == nil {
		open = OpenStore
	}
	return open(src, password, r.Roots)
}

// OpenStore builds the storage backend for one Source.
func OpenStore(src db.Source, password string, roots []string) (storage.Storage, error) {
	switch src.Type {
	case TypeLocal:
		loc, err := normalizeLocal(src.Location, roots)
		if err != nil {
			return nil, err
		}
		return storage.OpenLocal(loc)
	case TypeSMB:
		cfg, err := parseSMB(src.Location)
		if err != nil {
			return nil, err
		}
		cfg.User, cfg.Password = src.Username, password
		return storage.NewSMB(cfg), nil
	case TypeWebDAV:
		loc, err := normalizeWebDAV(src.Location)
		if err != nil {
			return nil, err
		}
		return storage.NewWebDAV(loc, src.Username, password), nil
	default:
		return nil, fmt.Errorf("unknown source type %q", src.Type)
	}
}

func (r *Registry) invalidate(id string) {
	r.mu.Lock()
	st := r.stores[id]
	delete(r.stores, id)
	r.mu.Unlock()
	closeStore(st)
}

func closeStore(st storage.Storage) {
	if c, ok := st.(io.Closer); ok {
		_ = c.Close()
	}
}

// ---- index scopes ----

// Scopes lists the Owner's Sources as index scopes, first turning a legacy
// <LegacyRoot>/<email> folder into an explicit Source.
func (r *Registry) Scopes(ctx context.Context, ownerID, email string) ([]index.Scope, error) {
	if err := r.migrateLegacy(ctx, ownerID, email); err != nil {
		return nil, fmt.Errorf("migrate legacy folder: %w", err)
	}
	srcs, err := r.Repo.ListOwnerSources(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	out := make([]index.Scope, 0, len(srcs))
	for _, s := range srcs {
		out = append(out, index.Scope{Prefix: s.Key, Remote: s.Type != TypeLocal})
	}
	return out, nil
}

func (r *Registry) migrateLegacy(ctx context.Context, ownerID, email string) error {
	r.migrate.Lock()
	defer r.migrate.Unlock()
	done, err := r.Repo.OwnerSourcesMigrated(ctx, ownerID)
	if err != nil || done {
		return err
	}
	prefix, perr := index.PrefixFromEmail(email)
	if r.LegacyRoot != "" && perr == nil {
		dir, err := filepath.Abs(filepath.Join(r.LegacyRoot, prefix))
		if err != nil {
			return err
		}
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			src, err := r.legacySource(ctx, ownerID, prefix, dir)
			if err != nil {
				return err
			}
			if err := r.Repo.RelocatePhotoPrefix(ctx, ownerID, prefix, src.Key); err != nil {
				return err
			}
			r.log().Info("migrated legacy folder to source", "owner", ownerID, "dir", dir, "source", src.Key)
		}
	}
	return r.Repo.MarkOwnerSourcesMigrated(ctx, ownerID)
}

func (r *Registry) legacySource(ctx context.Context, ownerID, email, dir string) (*db.Source, error) {
	existing, err := r.Repo.ListOwnerSources(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	for i := range existing {
		if existing[i].Type == TypeLocal && existing[i].Location == dir {
			return &existing[i], nil
		}
	}
	now := time.Now().UTC()
	src := &db.Source{
		Name:       "Photos",
		Type:       TypeLocal,
		Location:   dir,
		OwnerID:    ownerID,
		OwnerEmail: email,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := r.Repo.CreateSource(ctx, src); err != nil {
		return nil, err
	}
	return src, nil
}

// ---- admin ----

func (r *Registry) List(ctx context.Context) ([]View, error) {
	srcs, err := r.Repo.ListSources(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]View, 0, len(srcs))
	for _, s := range srcs {
		out = append(out, viewOf(s))
	}
	return out, nil
}

func (r *Registry) Create(ctx context.Context, in Input) (View, error) {
	owner := strings.ToLower(strings.TrimSpace(in.OwnerEmail))
	if _, err := index.PrefixFromEmail(owner); err != nil || !strings.Contains(owner, "@") {
		return View{}, invalidf("owner email is required")
	}
	now := time.Now().UTC()
	src := db.Source{
		OwnerID:    db.UserKeyFromEmail(owner),
		OwnerEmail: owner,
		CreatedAt:  now,
	}
	if err := r.apply(ctx, &src, in, ""); err != nil {
		return View{}, err
	}
	if err := r.Repo.CreateSource(ctx, &src); err != nil {
		return View{}, err
	}
	return viewOf(src), nil
}

func (r *Registry) Update(ctx context.Context, id string, in Input) (View, error) {
	src, err := r.Repo.GetSource(ctx, id)
	if err != nil {
		return View{}, err
	}
	// Photo identity and ACL hang off owner_id; moving a Source between
	// Owners would strand Photos, so it is delete-and-re-add instead.
	if o := strings.ToLower(strings.TrimSpace(in.OwnerEmail)); o != "" && o != src.OwnerEmail {
		return View{}, invalidf("owner cannot change; remove the folder and add it again for %s", o)
	}
	if err := r.apply(ctx, src, in, src.Secret); err != nil {
		return View{}, err
	}
	if err := r.Repo.ReplaceSource(ctx, src); err != nil {
		return View{}, err
	}
	r.invalidate(id)
	return viewOf(*src), nil
}

func (r *Registry) Remove(ctx context.Context, id string) (View, error) {
	src, err := r.Repo.GetSource(ctx, id)
	if err != nil {
		return View{}, err
	}
	if err := r.Repo.DeleteSource(ctx, id); err != nil {
		return View{}, err
	}
	r.invalidate(id)
	return viewOf(*src), nil
}

// apply validates in onto src and probes the connection before anything is saved.
func (r *Registry) apply(ctx context.Context, src *db.Source, in Input, keepSecret string) error {
	typ := strings.ToLower(strings.TrimSpace(in.Type))
	loc, err := normalizeLocation(typ, in.Location, r.Roots)
	if err != nil {
		return err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = defaultName(loc)
	}
	if len(name) > 80 {
		return invalidf("name is longer than 80 characters")
	}
	secret := keepSecret
	username := strings.TrimSpace(in.Username)
	if typ == TypeLocal {
		username, secret = "", ""
	} else if in.Password != nil {
		if secret, err = r.Sealer.Seal(*in.Password); err != nil {
			return err
		}
	}
	src.Name, src.Type, src.Location, src.Username, src.Secret = name, typ, loc, username, secret
	src.UpdatedAt = time.Now().UTC()
	return r.probe(ctx, *src)
}

var errProbeDone = errors.New("probe done")

// probe opens the Source and lists until the first file so a typo, bad
// password, or unreachable host is reported while the admin is still in the form.
func (r *Registry) probe(ctx context.Context, src db.Source) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	st, err := r.openSource(src)
	if err != nil {
		return invalidf("cannot open %s: %v", src.Location, err)
	}
	defer closeStore(st)
	err = st.Walk(ctx, "", func(storage.ObjectInfo) error { return errProbeDone })
	if err != nil && !errors.Is(err, errProbeDone) {
		return invalidf("cannot read %s: %v", src.Location, err)
	}
	return nil
}

func defaultName(loc string) string {
	loc = strings.TrimRight(strings.ReplaceAll(loc, `\`, "/"), "/")
	if i := strings.LastIndex(loc, "/"); i >= 0 && i < len(loc)-1 {
		return loc[i+1:]
	}
	return loc
}

func (r *Registry) log() *slog.Logger {
	if r.Log != nil {
		return r.Log
	}
	return slog.Default()
}
