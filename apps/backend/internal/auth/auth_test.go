package auth

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/memries/memries/internal/config"
	"github.com/memries/memries/internal/db"
)

type fakeUsers struct {
	byEmail map[string]*db.User
	upserts []string
	setHash map[string]string
	locales map[string]string
	getErr  error
}

func (f *fakeUsers) SetUserLocale(_ context.Context, key, locale string) error {
	if f.locales == nil {
		f.locales = map[string]string{}
	}
	f.locales[key] = locale
	for _, u := range f.byEmail {
		if u.Key == key {
			u.Locale = locale
		}
	}
	return nil
}

func newFakeUsers() *fakeUsers {
	return &fakeUsers{byEmail: map[string]*db.User{}, setHash: map[string]string{}}
}

func (f *fakeUsers) add(email, password string, tb testing.TB) *db.User {
	tb.Helper()
	u := &db.User{Key: db.UserKeyFromEmail(email), Email: strings.ToLower(email), Name: "Test"}
	if password != "" {
		hash, err := HashPassword(password)
		if err != nil {
			tb.Fatal(err)
		}
		u.PasswordHash = hash
	}
	f.byEmail[u.Email] = u
	return u
}

func (f *fakeUsers) GetUserByEmail(_ context.Context, email string) (*db.User, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	u, ok := f.byEmail[strings.ToLower(strings.TrimSpace(email))]
	if !ok {
		return nil, db.ErrNotFound
	}
	return u, nil
}

func (f *fakeUsers) UpsertUserByEmail(_ context.Context, email, _ string) (*db.User, error) {
	email = strings.ToLower(email)
	f.upserts = append(f.upserts, email)
	if u, ok := f.byEmail[email]; ok {
		return u, nil
	}
	u := &db.User{Key: db.UserKeyFromEmail(email), Email: email}
	f.byEmail[email] = u
	return u, nil
}

func (f *fakeUsers) SetPasswordHash(_ context.Context, key, hash string) error {
	f.setHash[key] = hash
	for _, u := range f.byEmail {
		if u.Key == key {
			u.PasswordHash = hash
		}
	}
	return nil
}

func testConfig(publicURL string, admins ...string) *config.Config {
	return &config.Config{
		SessionKey:  base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")),
		PublicURL:   publicURL,
		AdminEmails: admins,
	}
}

func newTestAuth(tb testing.TB, store UserStore, cfg *config.Config) *Auth {
	tb.Helper()
	a, err := New(cfg, store, nil)
	if err != nil {
		tb.Fatal(err)
	}
	return a
}

func postJSON(a *Auth, login, password string) *httptest.ResponseRecorder {
	body := fmt.Sprintf(`{"login":%q,"password":%q}`, login, password)
	r := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.RemoteAddr = "192.0.2.10:1234"
	w := httptest.NewRecorder()
	a.LoginHandler(w, r)
	return w
}

func sessionCookie(tb testing.TB, w *httptest.ResponseRecorder) *http.Cookie {
	tb.Helper()
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionName {
			return c
		}
	}
	return nil
}

func TestLoginAcceptsCorrectPassword(t *testing.T) {
	users := newFakeUsers()
	users.add("admin@example.com", "password", t)
	a := newTestAuth(t, users, testConfig("http://localhost", "admin@example.com"))

	w := postJSON(a, "admin@example.com", "password")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["Email"] != "admin@example.com" {
		t.Errorf("Email = %v, want admin@example.com", got["Email"])
	}
	if got["admin"] != true {
		t.Errorf("admin = %v, want true for a configured admin address", got["admin"])
	}
	// The password hash must never leave the process.
	if body := w.Body.String(); strings.Contains(body, "argon2") || strings.Contains(body, "password_hash") {
		t.Errorf("login response leaks password material: %s", body)
	}
	if c := sessionCookie(t, w); c == nil {
		t.Error("no session cookie set")
	} else if !c.HttpOnly {
		t.Error("session cookie is not HttpOnly")
	}
}

func TestLoginIsCaseInsensitiveOnAddress(t *testing.T) {
	users := newFakeUsers()
	users.add("admin@example.com", "password", t)
	a := newTestAuth(t, users, testConfig("http://localhost"))

	if w := postJSON(a, "  ADMIN@Example.COM  ", "password"); w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
}

// A wrong password, an unknown address and an account with no password set
// must be indistinguishable from the outside. Anything else turns the form
// into a way to enumerate which addresses are registered.
func TestLoginFailuresAreIndistinguishable(t *testing.T) {
	users := newFakeUsers()
	users.add("known@example.com", "password", t)
	users.add("nopassword@example.com", "", t)

	type result struct {
		code int
		body string
	}
	results := map[string]result{}
	for name, creds := range map[string][2]string{
		"wrong password":    {"known@example.com", "not-the-password"},
		"unknown address":   {"nobody@example.com", "password"},
		"no password set":   {"nopassword@example.com", "password"},
		"unknown and weird": {"'; DROP TABLE users; --", "password"},
	} {
		// Each case gets its own Auth so the rate limiter cannot interfere.
		fresh := newTestAuth(t, users, testConfig("http://localhost"))
		w := postJSON(fresh, creds[0], creds[1])
		results[name] = result{w.Code, w.Body.String()}
		if c := sessionCookie(t, w); c != nil && c.MaxAge >= 0 && c.Value != "" {
			t.Errorf("%s: a session cookie was issued on a failed login", name)
		}
	}

	var first *result
	for name, got := range results {
		if got.code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", name, got.code)
		}
		if first == nil {
			g := got
			first = &g
			continue
		}
		if got.body != first.body {
			t.Errorf("%s: body %q differs from another failure's %q, which leaks which accounts exist",
				name, got.body, first.body)
		}
	}
}

func TestLoginRejectsMalformedRequests(t *testing.T) {
	users := newFakeUsers()
	users.add("admin@example.com", "password", t)

	cases := map[string]struct{ login, password string }{
		"no login":    {"", "password"},
		"no password": {"admin@example.com", ""},
		"both empty":  {"", ""},
		"blank login": {"   ", "password"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			a := newTestAuth(t, users, testConfig("http://localhost"))
			if w := postJSON(a, tc.login, tc.password); w.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", w.Code)
			}
		})
	}
}

// An unbounded password would be run through a 19MiB hash, so the length cap
// is a resource guard, not a policy.
func TestLoginRejectsOversizedPassword(t *testing.T) {
	users := newFakeUsers()
	users.add("admin@example.com", "password", t)
	a := newTestAuth(t, users, testConfig("http://localhost"))

	long := strings.Repeat("a", maxPasswordBytes+1)
	w := postJSON(a, "admin@example.com", long)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
}

// The sign-in form posts the field names the e2e suite already drives, so a
// plain HTML submit works without JavaScript.
func TestLoginAcceptsFormEncodedFields(t *testing.T) {
	users := newFakeUsers()
	users.add("admin@example.com", "password", t)
	a := newTestAuth(t, users, testConfig("http://localhost"))

	form := url.Values{"login": {"admin@example.com"}, "password": {"password"}}
	r := httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.RemoteAddr = "192.0.2.11:5555"
	w := httptest.NewRecorder()
	a.LoginHandler(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", w.Code, w.Body.String())
	}
	if sessionCookie(t, w) == nil {
		t.Error("no session cookie set")
	}
}

func TestLoginThrottlesRepeatedFailures(t *testing.T) {
	users := newFakeUsers()
	users.add("admin@example.com", "password", t)
	a := newTestAuth(t, users, testConfig("http://localhost"))

	for i := 0; i < loginBurst; i++ {
		if w := postJSON(a, "admin@example.com", "wrong"); w.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401", i+1, w.Code)
		}
	}
	w := postJSON(a, "admin@example.com", "wrong")
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt %d: status = %d, want 429", loginBurst+1, w.Code)
	}
	retry := w.Header().Get("Retry-After")
	if n, err := strconv.Atoi(retry); err != nil || n < 1 {
		t.Errorf("Retry-After = %q, want a positive integer", retry)
	}
	// Even the correct password is refused while throttled.
	if w := postJSON(a, "admin@example.com", "password"); w.Code != http.StatusTooManyRequests {
		t.Errorf("throttle bypassed by a correct password: status = %d", w.Code)
	}
}

func TestLoginSuccessClearsTheThrottle(t *testing.T) {
	users := newFakeUsers()
	users.add("admin@example.com", "password", t)
	a := newTestAuth(t, users, testConfig("http://localhost"))

	// A few typos, then the right password: the budget should be restored so
	// the next genuine mistake is not met with a lockout.
	for i := 0; i < loginBurst-1; i++ {
		postJSON(a, "admin@example.com", "wrong")
	}
	if w := postJSON(a, "admin@example.com", "password"); w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	for i := 0; i < loginBurst; i++ {
		if w := postJSON(a, "admin@example.com", "wrong"); w.Code == http.StatusTooManyRequests {
			t.Fatalf("still throttled %d attempts after a successful sign-in", i+1)
		}
	}
}

func TestLogoutClearsTheSession(t *testing.T) {
	users := newFakeUsers()
	users.add("admin@example.com", "password", t)
	a := newTestAuth(t, users, testConfig("http://localhost"))

	login := postJSON(a, "admin@example.com", "password")
	cookie := sessionCookie(t, login)
	if cookie == nil {
		t.Fatal("login set no cookie")
	}

	r := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	a.LogoutHandler(w, r)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
	cleared := sessionCookie(t, w)
	if cleared == nil {
		t.Fatal("logout set no cookie to expire the session")
	}
	if cleared.MaxAge >= 0 {
		t.Errorf("MaxAge = %d, want negative so the browser drops it", cleared.MaxAge)
	}
}

func TestMiddlewareGuardsOnTheSessionCookie(t *testing.T) {
	users := newFakeUsers()
	users.add("admin@example.com", "password", t)
	a := newTestAuth(t, users, testConfig("http://localhost"))

	var seen *SessionUser
	guarded := a.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		u, _ := UserFromContext(r.Context())
		seen = u
	}))

	// No cookie at all.
	w := httptest.NewRecorder()
	guarded.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/me", nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("without a cookie: status = %d, want 401", w.Code)
	}

	// A forged cookie the session key cannot authenticate.
	w = httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	r.AddCookie(&http.Cookie{Name: sessionName, Value: "forged"})
	guarded.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("with a forged cookie: status = %d, want 401", w.Code)
	}

	// The real thing.
	cookie := sessionCookie(t, postJSON(a, "admin@example.com", "password"))
	w = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	r.AddCookie(cookie)
	guarded.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("with a valid cookie: status = %d, want 200", w.Code)
	}
	if seen == nil || seen.Email != "admin@example.com" {
		t.Errorf("handler saw %+v, want the signed-in user", seen)
	}
}

func TestCookieSecureFlagFollowsPublicURL(t *testing.T) {
	users := newFakeUsers()
	for url, wantSecure := range map[string]bool{
		"https://photos.example.com": true,
		"http://localhost":           false,
		"HTTPS://Photos.Example.com": true,
	} {
		a := newTestAuth(t, users, testConfig(url))
		if got := a.store.Options.Secure; got != wantSecure {
			t.Errorf("PublicURL %q: Secure = %v, want %v", url, got, wantSecure)
		}
	}
}

func TestNewRejectsAWeakSessionKey(t *testing.T) {
	users := newFakeUsers()
	for name, key := range map[string]string{
		"empty":      "",
		"not base64": "!!!!!!!!",
		"too short":  base64.StdEncoding.EncodeToString([]byte("short")),
		"31 bytes":   base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 31))),
	} {
		t.Run(name, func(t *testing.T) {
			cfg := testConfig("http://localhost")
			cfg.SessionKey = key
			if _, err := New(cfg, users, nil); err == nil {
				t.Error("want error, got nil")
			}
		})
	}
}

func TestBootstrapFillsOnlyEmptyPasswords(t *testing.T) {
	users := newFakeUsers()
	existing := users.add("admin@example.com", "already-chosen", t)
	originalHash := existing.PasswordHash

	cfg := testConfig("http://localhost", "admin@example.com", "second@example.com")
	cfg.BootstrapPassword = "bootstrap-secret"
	a := newTestAuth(t, users, cfg)

	if err := a.Bootstrap(context.Background()); err != nil {
		t.Fatal(err)
	}

	// The existing password must survive a restart with the variable still set.
	if users.byEmail["admin@example.com"].PasswordHash != originalHash {
		t.Error("bootstrap overwrote an existing password")
	}
	// The new address gets the bootstrap password and can sign in with it.
	second := users.byEmail["second@example.com"]
	if second == nil || second.PasswordHash == "" {
		t.Fatal("bootstrap did not set a password for the second admin")
	}
	if err := VerifyPassword(second.PasswordHash, "bootstrap-secret"); err != nil {
		t.Errorf("bootstrap password does not verify: %v", err)
	}
	if w := postJSON(a, "second@example.com", "bootstrap-secret"); w.Code != http.StatusOK {
		t.Errorf("sign-in with the bootstrap password: status = %d, want 200", w.Code)
	}
}

func TestBootstrapIsANoOpWithoutAPassword(t *testing.T) {
	users := newFakeUsers()
	a := newTestAuth(t, users, testConfig("http://localhost", "admin@example.com"))
	if err := a.Bootstrap(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(users.upserts) != 0 {
		t.Errorf("bootstrap touched the catalog with no password configured: %v", users.upserts)
	}
}

// A bootstrap password with nobody to apply it to is a misconfiguration that
// would otherwise look like a working install nobody can sign into.
func TestBootstrapRequiresAnAdminAddress(t *testing.T) {
	cfg := testConfig("http://localhost")
	cfg.BootstrapPassword = "secret"
	a := newTestAuth(t, newFakeUsers(), cfg)
	if err := a.Bootstrap(context.Background()); err == nil {
		t.Error("want an error when MEMRIES_ADMIN_EMAILS is empty")
	}
}

// The one configuration that yields a healthy-looking install nobody can sign
// into: no bootstrap password, and no account that already has one. Sign-in
// failures are uniform by design, so this warning is the operator's only clue.
func TestBootstrapWarnsWhenNobodyCanSignIn(t *testing.T) {
	capture := func(users *fakeUsers) string {
		var buf bytes.Buffer
		cfg := testConfig("http://localhost", "admin@example.com")
		a, err := New(cfg, users, slog.New(slog.NewTextHandler(&buf, nil)))
		if err != nil {
			t.Fatal(err)
		}
		if err := a.Bootstrap(context.Background()); err != nil {
			t.Fatal(err)
		}
		return buf.String()
	}

	t.Run("warns with no users at all", func(t *testing.T) {
		if got := capture(newFakeUsers()); !strings.Contains(got, "MEMRIES_BOOTSTRAP_PASSWORD") {
			t.Errorf("no warning about an unusable install; log was %q", got)
		}
	})

	t.Run("warns when the admin has no password", func(t *testing.T) {
		users := newFakeUsers()
		users.add("admin@example.com", "", t)
		if got := capture(users); !strings.Contains(got, "MEMRIES_BOOTSTRAP_PASSWORD") {
			t.Errorf("no warning; log was %q", got)
		}
	})

	// A password set on an earlier run is the normal case and must stay quiet.
	t.Run("silent when a password already exists", func(t *testing.T) {
		users := newFakeUsers()
		users.add("admin@example.com", "chosen-earlier", t)
		if got := capture(users); strings.Contains(got, "MEMRIES_BOOTSTRAP_PASSWORD") {
			t.Errorf("warned about a working install; log was %q", got)
		}
	})
}

func TestSetLocaleHandlerStoresASupportedLanguage(t *testing.T) {
	users := newFakeUsers()
	u := users.add("a@example.com", "pw", t)
	a := newTestAuth(t, users, testConfig("http://localhost"))

	for _, locale := range []string{"nl", "en", ""} {
		req := httptest.NewRequest(http.MethodPut, "/api/me/locale",
			strings.NewReader(`{"locale":"`+locale+`"}`))
		req = req.WithContext(WithUser(req.Context(), &SessionUser{Key: u.Key, Email: u.Email}))
		w := httptest.NewRecorder()
		a.SetLocaleHandler(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("locale %q: status %d: %s", locale, w.Code, w.Body.String())
		}
		if users.locales[u.Key] != locale {
			t.Errorf("stored %q, want %q", users.locales[u.Key], locale)
		}
	}
}

func TestSetLocaleHandlerRefusesAnUnknownLanguage(t *testing.T) {
	users := newFakeUsers()
	u := users.add("a@example.com", "pw", t)
	a := newTestAuth(t, users, testConfig("http://localhost"))

	req := httptest.NewRequest(http.MethodPut, "/api/me/locale",
		strings.NewReader(`{"locale":"de"}`))
	req = req.WithContext(WithUser(req.Context(), &SessionUser{Key: u.Key, Email: u.Email}))
	w := httptest.NewRecorder()
	a.SetLocaleHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", w.Code)
	}
	if _, ok := users.locales[u.Key]; ok {
		t.Error("an unsupported locale was stored")
	}
}

func TestSetLocaleHandlerNeedsASession(t *testing.T) {
	users := newFakeUsers()
	a := newTestAuth(t, users, testConfig("http://localhost"))
	req := httptest.NewRequest(http.MethodPut, "/api/me/locale", strings.NewReader(`{"locale":"nl"}`))
	w := httptest.NewRecorder()
	a.SetLocaleHandler(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", w.Code)
	}
}

func TestMeReportsTheStoredLocale(t *testing.T) {
	users := newFakeUsers()
	u := users.add("a@example.com", "pw", t)
	u.Locale = "nl"
	a := newTestAuth(t, users, testConfig("http://localhost"))

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req = req.WithContext(WithUser(req.Context(), &SessionUser{Key: u.Key, Email: u.Email}))
	w := httptest.NewRecorder()
	a.MeHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status %d", w.Code)
	}
	var body struct {
		Locale string `json:"locale"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Locale != "nl" {
		t.Fatalf("locale = %q, want nl", body.Locale)
	}
}
