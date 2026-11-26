package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Starting a run walks every Source and renders thumbnails for what it finds,
// which on a single-board computer is minutes of the machine. Only an admin
// may ask for it, and since the splash no longer asks on anyone's behalf this
// endpoint is the last way a reader could have set one off (ADR 0004).
func TestStartIndexIsAdminOnly(t *testing.T) {
	a := &API{IsAdmin: func(email string) bool { return email == "admin@example.com" }}
	r := chi.NewRouter()
	a.Routes(r)

	for _, tc := range []struct {
		name  string
		email string
		want  int
	}{
		// 503 rather than 202 because this API has no coordinator wired: it is
		// how we know the request got past the admin check.
		{"an admin", "admin@example.com", http.StatusServiceUnavailable},
		{"a reader", "reader@example.com", http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/index", nil)
			req = req.WithContext(withUserEmail(req, tc.email))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}

func TestStartIndexRefusesWithoutASession(t *testing.T) {
	a := &API{IsAdmin: func(string) bool { return true }}
	r := chi.NewRouter()
	a.Routes(r)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/index", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
}

// Stopping is admin-only for the same reason starting is: one reader should
// not be able to cut short a scan someone else asked for.
func TestStopIndexIsAdminOnly(t *testing.T) {
	a := &API{IsAdmin: func(email string) bool { return email == "admin@example.com" }}
	r := chi.NewRouter()
	a.Routes(r)

	for _, tc := range []struct {
		name  string
		email string
		want  int
	}{
		{"an admin", "admin@example.com", http.StatusServiceUnavailable},
		{"a reader", "reader@example.com", http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/index/stop", nil)
			req = req.WithContext(withUserEmail(req, tc.email))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}
