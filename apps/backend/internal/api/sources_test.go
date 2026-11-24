package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/memries/memries/internal/auth"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/sources"
)

type fakeSources struct {
	created   []sources.Input
	previewed []string
}

func (f *fakeSources) List(context.Context) ([]sources.View, error) {
	return []sources.View{{ID: "7", Name: "NAS", Type: "smb", HasPassword: true}}, nil
}

func (f *fakeSources) Create(_ context.Context, in sources.Input) (sources.View, error) {
	f.created = append(f.created, in)
	if in.Location == "" {
		return sources.View{}, sources.ErrInvalid
	}
	return sources.View{ID: "8", Type: in.Type}, nil
}

func (f *fakeSources) Update(context.Context, string, sources.Input) (sources.View, error) {
	return sources.View{}, nil
}

func (f *fakeSources) Remove(context.Context, string) (sources.View, error) {
	return sources.View{}, nil
}

func (f *fakeSources) Preview(_ context.Context, id string, in sources.Input) (sources.Preview, error) {
	f.previewed = append(f.previewed, id)
	if in.Location == "" {
		return sources.Preview{}, sources.ErrInvalid
	}
	return sources.Preview{Name: "Photos", Location: in.Location, Photos: 3, Folders: 2}, nil
}

// There is one library, so a rescan takes no owner: the fake just counts.
type fakeRescan struct{ runs int }

func (f *fakeRescan) Rescan(context.Context) (index.Status, error) {
	f.runs++
	return index.Status{}, nil
}

func sourcesRouter(src *fakeSources, rescan *fakeRescan) chi.Router {
	a := &API{
		Sources:     src,
		Rescan:      rescan,
		SourceRoots: []string{"/data/photos"},
		IsAdmin:     func(email string) bool { return email == "admin@example.com" },
	}
	r := chi.NewRouter()
	a.Routes(r)
	return r
}

func TestAdminSourcesRequireAdmin(t *testing.T) {
	r := sourcesRouter(&fakeSources{}, &fakeRescan{})
	req := httptest.NewRequest(http.MethodGet, "/admin/sources", nil)
	req = req.WithContext(withUserEmail(req, "someone@example.com"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-admin got %d", w.Code)
	}

	req = withUser(httptest.NewRequest(http.MethodGet, "/admin/sources", nil), "owner")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("admin got %d", w.Code)
	}
	if bytes.Contains(w.Body.Bytes(), []byte("secret")) || !bytes.Contains(w.Body.Bytes(), []byte(`"has_password":true`)) {
		t.Fatalf("body %s", w.Body.String())
	}
}

func TestCreateSourceDefaultsOwnerAndRescans(t *testing.T) {
	src, rescan := &fakeSources{}, &fakeRescan{}
	r := sourcesRouter(src, rescan)
	req := withUser(httptest.NewRequest(http.MethodPost, "/admin/sources",
		bytes.NewBufferString(`{"type":"webdav","location":"https://dav.example.com/photos","password":"pw"}`)), "owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create %d %s", w.Code, w.Body.String())
	}
	if src.created[0].Password == nil {
		t.Fatalf("input %+v", src.created[0])
	}
	if rescan.runs != 1 {
		t.Fatalf("rescans = %d, want 1", rescan.runs)
	}
	var v sources.View
	_ = json.Unmarshal(w.Body.Bytes(), &v)
	if v.ID != "8" {
		t.Fatalf("view %+v", v)
	}

	bad := withUser(httptest.NewRequest(http.MethodPost, "/admin/sources", bytes.NewBufferString(`{"type":"local"}`)), "owner")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, bad)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid got %d", w.Code)
	}
}

func withUserEmail(r *http.Request, email string) context.Context {
	return auth.WithUser(r.Context(), &auth.SessionUser{Key: "k", Email: email})
}

// A dry run must not start an index: the whole point is that pressing it has
// no consequences (ADR 0027).
func TestPreviewSourceReportsWithoutScanning(t *testing.T) {
	src, rescan := &fakeSources{}, &fakeRescan{}
	r := sourcesRouter(src, rescan)

	req := withUser(httptest.NewRequest(http.MethodPost, "/admin/sources/preview",
		bytes.NewBufferString(`{"type":"local","location":"/data/photos"}`)), "admin@example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var p sources.Preview
	if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Photos != 3 || p.Folders != 2 {
		t.Errorf("preview = %+v", p)
	}
	if rescan.runs != 0 {
		t.Errorf("a dry run queued %d index runs", rescan.runs)
	}
	if len(src.previewed) != 1 || src.previewed[0] != "" {
		t.Errorf("previewed = %v, want one empty id for a new folder", src.previewed)
	}

	// Editing an existing folder hands the id through, so a blank password
	// field can fall back to the stored one.
	req = withUser(httptest.NewRequest(http.MethodPost, "/admin/sources/7/preview",
		bytes.NewBufferString(`{"type":"local","location":"/data/photos"}`)), "admin@example.com")
	r.ServeHTTP(httptest.NewRecorder(), req)
	if len(src.previewed) != 2 || src.previewed[1] != "7" {
		t.Errorf("previewed = %v", src.previewed)
	}
}

func TestPreviewSourceRejectsABadForm(t *testing.T) {
	r := sourcesRouter(&fakeSources{}, &fakeRescan{})
	req := withUser(httptest.NewRequest(http.MethodPost, "/admin/sources/preview",
		bytes.NewBufferString(`{"type":"local"}`)), "admin@example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

func TestPreviewSourceNeedsAnAdmin(t *testing.T) {
	r := sourcesRouter(&fakeSources{}, &fakeRescan{})
	req := httptest.NewRequest(http.MethodPost, "/admin/sources/preview",
		bytes.NewBufferString(`{"type":"local","location":"/data/photos"}`))
	req = req.WithContext(withUserEmail(req, "reader@example.com"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", w.Code)
	}
}

// The folder form writes a path relative to one of these, so the list has to
// say which roots exist rather than leaving a reader to discover the rule
// from a rejection (ADR 0013).
func TestListSourcesNamesTheAllowedRoots(t *testing.T) {
	r := sourcesRouter(&fakeSources{}, &fakeRescan{})
	req := withUser(httptest.NewRequest(http.MethodGet, "/admin/sources", nil), "owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var body struct {
		Sources []sources.View `json:"sources"`
		Roots   []string       `json:"roots"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Sources) != 1 {
		t.Errorf("sources = %d", len(body.Sources))
	}
	if len(body.Roots) != 1 || body.Roots[0] != "/data/photos" {
		t.Errorf("roots = %v", body.Roots)
	}
}

// A server with no roots configured must still answer with a list the client
// can map over, not a null.
func TestListSourcesAnswersWithAnEmptyRootsList(t *testing.T) {
	a := &API{Sources: &fakeSources{}, IsAdmin: func(string) bool { return true }}
	r := chi.NewRouter()
	a.Routes(r)
	req := withUser(httptest.NewRequest(http.MethodGet, "/admin/sources", nil), "owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if !strings.Contains(w.Body.String(), `"roots":[]`) {
		t.Errorf("body = %s", w.Body.String())
	}
}
