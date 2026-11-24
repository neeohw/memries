package sources

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
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
	GetSource(ctx context.Context, key string) (*db.Source, error)
	CreateSource(ctx context.Context, s *db.Source) error
	ReplaceSource(ctx context.Context, s *db.Source) error
	DeleteSource(ctx context.Context, key string) error
	RelocatePhotoPrefix(ctx context.Context, oldPrefix, newPrefix string) error
}

// Registry owns the Source catalog and exposes every Source as one read-only
// storage.Storage whose keys are "<source id>/<path inside the source>".
// Thumbs never go here: they are written to the local cache by thumb.Generator.
type Registry struct {
	Repo   Repo
	Sealer *Sealer
	// Roots are the directories local Sources must live under.
	Roots []string
	Log   *slog.Logger
	// Open builds a backend for a Source; tests swap it. Defaults to OpenStore.
	Open func(src db.Source, password string, roots []string) (storage.Storage, error)

	mu     sync.Mutex
	stores map[string]storage.Storage
}

// Input is the admin form for creating or editing a Source.
type Input struct {
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Location string  `json:"location"`
	Username string  `json:"username"`
	Password *string `json:"password"` // nil keeps the stored password on update
	// Excludes are regular expressions matched against each directory's path
	// below this Source's root; a matching tree is never walked (ADR 0020).
	Excludes []string `json:"excludes"`
}

// View is a Source as the admin UI sees it: never includes the password.
type View struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Type        string    `json:"type"`
	Location    string    `json:"location"`
	Username    string    `json:"username,omitempty"`
	HasPassword bool      `json:"has_password"`
	Excludes    []string  `json:"excludes,omitempty"`
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
		Excludes:    s.Excludes,
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
//
// The Source's exclude patterns are compiled here, from this Source's own
// list, and handed to this Source's backend — so one folder's patterns never
// reach another's tree. The indexer needs no knowledge of them: a tree the
// walk never visits is a tree it never indexes, and because the backend also
// hides it from Stat, the scan's prune pass removes what an earlier run put
// in the catalog (ADR 0020).
func OpenStore(src db.Source, password string, roots []string) (storage.Storage, error) {
	skip, err := CompileExcludes(src.Excludes)
	if err != nil {
		return nil, err
	}
	switch src.Type {
	case TypeLocal:
		loc, err := normalizeLocal(src.Location, roots)
		if err != nil {
			return nil, err
		}
		st, err := storage.OpenLocal(loc)
		if err != nil {
			return nil, err
		}
		st.SkipDir = skip
		return st, nil
	case TypeSMB:
		return nil, invalidf("SMB shares are no longer supported: mount the share on the server and add it as a folder (ADR 0020)")
	case TypeWebDAV:
		loc, err := normalizeWebDAV(src.Location)
		if err != nil {
			return nil, err
		}
		st := storage.NewWebDAV(loc, src.Username, password)
		st.SkipDir = skip
		return st, nil
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

// Scopes lists every Source as an index scope. Sources are server-wide, so
// there is one library to resolve and no owner to resolve it for (ADR 0020).
func (r *Registry) Scopes(ctx context.Context) ([]index.Scope, error) {
	srcs, err := r.Repo.ListSources(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]index.Scope, 0, len(srcs))
	for _, s := range srcs {
		out = append(out, index.Scope{Prefix: s.Key, Remote: s.Type != TypeLocal})
	}
	return out, nil
}

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
	src := db.Source{CreatedAt: time.Now().UTC()}
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
	// Validated here rather than at scan time: a pattern that will not
	// compile should be reported while the reader is still looking at the
	// form, not hours later in a log nobody is watching.
	excludes, err := ValidateExcludes(in.Excludes)
	if err != nil {
		return err
	}
	src.Name, src.Type, src.Location, src.Username, src.Secret = name, typ, loc, username, secret
	src.Excludes = excludes
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
