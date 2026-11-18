package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/memries/memries/internal/auth"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/sources"
)

type fakeSources struct {
	created []sources.Input
}

func (f *fakeSources) List(context.Context) ([]sources.View, error) {
	return []sources.View{{ID: "7", Name: "NAS", Type: "smb", HasPassword: true}}, nil
}

func (f *fakeSources) Create(_ context.Context, in sources.Input) (sources.View, error) {
	f.created = append(f.created, in)
	if in.Location == "" {
		return sources.View{}, sources.ErrInvalid
	}
	return sources.View{ID: "8", Type: in.Type, OwnerID: "bob", OwnerEmail: in.OwnerEmail}, nil
}

func (f *fakeSources) Update(context.Context, string, sources.Input) (sources.View, error) {
	return sources.View{}, nil
}

func (f *fakeSources) Remove(context.Context, string) (sources.View, error) {
	return sources.View{}, nil
}

type fakeRescan struct{ owners []string }

func (f *fakeRescan) Rescan(_ context.Context, ownerID, _ string) (index.Status, error) {
	f.owners = append(f.owners, ownerID)
	return index.Status{}, nil
}

func sourcesRouter(src *fakeSources, rescan *fakeRescan) chi.Router {
	a := &API{
		Sources: src,
		Rescan:  rescan,
		IsAdmin: func(email string) bool { return email == "admin@example.com" },
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
	if src.created[0].OwnerEmail != "admin@example.com" || src.created[0].Password == nil {
		t.Fatalf("input %+v", src.created[0])
	}
	if len(rescan.owners) != 1 || rescan.owners[0] != "bob" {
		t.Fatalf("rescans %v", rescan.owners)
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
