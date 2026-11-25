package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/memries/memries/internal/db"
)

func getSummary(t *testing.T, lib *fakeLibrary, query string) *httptest.ResponseRecorder {
	t.Helper()
	a := &API{DB: lib}
	r := chi.NewRouter()
	a.Routes(r)
	req := withUser(httptest.NewRequest(http.MethodGet, "/photos/summary"+query, nil), "reader")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestPhotoSummaryClampsSampleSize(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"", db.DefaultSummaryPerMonth},
		{"?per_month=", db.DefaultSummaryPerMonth},
		{"?per_month=nonsense", db.DefaultSummaryPerMonth},
		{"?per_month=0", db.DefaultSummaryPerMonth},
		{"?per_month=4", 4},
		{"?per_month=900", db.MaxSummaryPerMonth},
	} {
		lib := &fakeLibrary{summaries: []db.YearSummary{{Year: "2026", Count: 120}}}
		w := getSummary(t, lib, tc.query)
		if w.Code != http.StatusOK {
			t.Fatalf("%q: status = %d, want 200 (%s)", tc.query, w.Code, w.Body.String())
		}
		if lib.perMonth != tc.want {
			t.Errorf("%q: per_month = %d, want %d", tc.query, lib.perMonth, tc.want)
		}
		var body struct {
			PerMonth int `json:"per_month"`
			Years    []struct {
				Year  string `json:"year"`
				Count int    `json:"count"`
			} `json:"years"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("%q: decode: %v", tc.query, err)
		}
		// Echoed, so the client renders what it was given rather than what it
		// asked for.
		if body.PerMonth != tc.want {
			t.Errorf("%q: body per_month = %d, want %d", tc.query, body.PerMonth, tc.want)
		}
		if len(body.Years) != 1 || body.Years[0].Year != "2026" || body.Years[0].Count != 120 {
			t.Errorf("%q: years = %+v", tc.query, body.Years)
		}
	}
}

func TestPhotoSummaryEmptyLibraryIsAnEmptyList(t *testing.T) {
	w := getSummary(t, &fakeLibrary{}, "")
	var body struct {
		Years []db.YearSummary `json:"years"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// `[]`, not `null`: the client maps over it.
	if body.Years == nil || len(body.Years) != 0 {
		t.Fatalf("years = %v, want an empty list", body.Years)
	}
}

func TestPhotoSummaryNeedsASession(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/photos/summary", nil)
	(&API{DB: &fakeLibrary{}}).photoSummary(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}
