// Package auth owns the cookie session and local password sign-in (ADR 0016).
//
// There is no identity provider. Memries is a single-household photo manager
// on a 2GB board, and a separate OIDC container would cost more memory than
// the application it authenticates for while only ever holding one static
// password.
package auth

import (
	"context"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/sessions"

	"github.com/memries/memries/internal/config"
	"github.com/memries/memries/internal/db"
)

const sessionName = "memries"

// maxCredentialBytes caps the request body. A password is run through argon2id
// at 19MiB a go, so an unbounded one would be a cheap way to spend the host's
// memory and CPU.
const maxCredentialBytes = 4 << 10

// maxPasswordBytes bounds what reaches the hash function, for the same reason.
const maxPasswordBytes = 1024

// concurrentVerifications bounds how many password hashes may be computed at
// once. Each costs 19MiB, so without this a handful of simultaneous attempts
// would push the process past its memory limit.
const concurrentVerifications = 2

type ctxKey int

const userKey ctxKey = 1

type SessionUser struct {
	Key   string
	Email string
	Name  string
}

// localeReader is the slice of the catalog the locale endpoints need.
type localeReader interface {
	SetUserLocale(ctx context.Context, key, locale string) error
}

func init() {
	gob.Register(&SessionUser{})
}

// UserStore is the slice of the catalog this package needs. Narrowing it keeps
// the handlers testable without a database.
type UserStore interface {
	GetUserByEmail(ctx context.Context, email string) (*db.User, error)
	UpsertUserByEmail(ctx context.Context, email, name string) (*db.User, error)
	SetPasswordHash(ctx context.Context, key, hash string) error
	SetUserLocale(ctx context.Context, key, locale string) error
}

type Auth struct {
	cfg   *config.Config
	store *sessions.CookieStore
	db    UserStore
	log   *slog.Logger

	byAddr  *limiter
	byLogin *limiter
	// verifying is a counting semaphore, not a lock: see
	// concurrentVerifications.
	verifying chan struct{}
}

func New(cfg *config.Config, store UserStore, log *slog.Logger) (*Auth, error) {
	key, err := base64.StdEncoding.DecodeString(cfg.Server.SessionKey)
	if err != nil || len(key) < 32 {
		return nil, errors.New("MEMRIES_SESSION_KEY must be base64-encoded, at least 32 bytes")
	}
	if log == nil {
		log = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	cookies := sessions.NewCookieStore(key)
	cookies.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   60 * 60 * 24 * 30,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		// Only promise Secure when the deployment is actually https; setting it
		// on a plain-http LAN install would make the cookie unusable.
		Secure: strings.HasPrefix(strings.ToLower(cfg.Server.PublicURL), "https://"),
	}
	return &Auth{
		cfg:       cfg,
		store:     cookies,
		db:        store,
		log:       log,
		byAddr:    newLimiter(loginBurst, loginRefill),
		byLogin:   newLimiter(loginBurst, loginRefill),
		verifying: make(chan struct{}, concurrentVerifications),
	}, nil
}

// Bootstrap gives the configured admin addresses a password from
// MEMRIES_BOOTSTRAP_PASSWORD, so a fresh install can be signed into.
//
// It only ever fills an empty password. Re-applying the variable on every
// restart would silently undo a password change, and leaving the variable set
// is the normal case for a Compose or systemd unit.
func (a *Auth) Bootstrap(ctx context.Context) error {
	if a.cfg.Admins.BootstrapPassword == "" {
		a.warnIfNobodyCanSignIn(ctx)
		return nil
	}
	if len(a.cfg.Admins.Emails) == 0 {
		return errors.New("MEMRIES_BOOTSTRAP_PASSWORD is set but MEMRIES_ADMIN_EMAILS is empty, so there is no account to apply it to")
	}
	if len(a.cfg.Admins.BootstrapPassword) > maxPasswordBytes {
		return fmt.Errorf("MEMRIES_BOOTSTRAP_PASSWORD must be at most %d bytes", maxPasswordBytes)
	}
	for _, email := range a.cfg.Admins.Emails {
		user, err := a.db.UpsertUserByEmail(ctx, email, "")
		if err != nil {
			return fmt.Errorf("bootstrap %s: %w", email, err)
		}
		if user.PasswordHash != "" {
			continue
		}
		hash, err := HashPassword(a.cfg.Admins.BootstrapPassword)
		if err != nil {
			return fmt.Errorf("bootstrap %s: %w", email, err)
		}
		if err := a.db.SetPasswordHash(ctx, user.Key, hash); err != nil {
			return fmt.Errorf("bootstrap %s: %w", email, err)
		}
		// Never log the password itself, only that one was applied.
		a.log.Info("bootstrap password applied", "email", email)
	}
	return nil
}

// warnIfNobodyCanSignIn reports the one configuration that leaves a healthy
// install nobody can get into: no bootstrap password, and no existing account
// with a password either.
//
// Sign-in failures are deliberately uniform, so without this the operator sees
// only "invalid login or password" and has nothing to go on. It warns rather
// than failing, because an install whose passwords were set on an earlier run
// is perfectly normal and must still start.
func (a *Auth) warnIfNobodyCanSignIn(ctx context.Context) {
	for _, email := range a.cfg.Admins.Emails {
		user, err := a.db.GetUserByEmail(ctx, email)
		if err != nil || user == nil {
			continue
		}
		if user.PasswordHash != "" {
			return
		}
	}
	a.log.Warn("no account has a password, so sign-in cannot succeed; " +
		"set MEMRIES_BOOTSTRAP_PASSWORD (with MEMRIES_ADMIN_EMAILS) and restart")
}

type credentials struct {
	Login    string `json:"login"`
	Password string `json:"password"`
}

// LoginHandler verifies a password and starts a session.
//
// Every failure answers with the same status and message. Distinguishing
// "no such account" from "wrong password" would turn the form into an address
// oracle, so the two paths are kept identical in wording and in cost.
func (a *Auth) LoginHandler(w http.ResponseWriter, r *http.Request) {
	creds, err := readCredentials(w, r)
	if err != nil {
		http.Error(w, "malformed credentials", http.StatusBadRequest)
		return
	}
	login := strings.ToLower(strings.TrimSpace(creds.Login))
	if login == "" || creds.Password == "" {
		http.Error(w, "login and password are required", http.StatusBadRequest)
		return
	}
	if len(creds.Password) > maxPasswordBytes {
		http.Error(w, "password is too long", http.StatusBadRequest)
		return
	}

	addr := clientAddr(r)
	if ok, retry := a.byAddr.allow(addr); !ok {
		a.tooMany(w, retry, "addr", addr)
		return
	}
	if ok, retry := a.byLogin.allow(login); !ok {
		a.tooMany(w, retry, "login", login)
		return
	}

	user, err := a.authenticate(r.Context(), login, creds.Password)
	if err != nil {
		// Logged without the password, and at info: a wrong password is an
		// expected event, not a fault.
		a.log.Info("login rejected", "login", login, "addr", addr, "reason", err)
		http.Error(w, "invalid login or password", http.StatusUnauthorized)
		return
	}

	// The attempt succeeded, so the earlier typos that led here should not
	// leave this person or this address throttled.
	a.byAddr.reset(addr)
	a.byLogin.reset(login)

	sess, _ := a.store.Get(r, sessionName)
	// Replace the whole value map rather than merging, so nothing from a prior
	// session survives into this one.
	sess.Values = map[any]any{
		"user": &SessionUser{Key: user.Key, Email: user.Email, Name: user.Name},
	}
	if err := sess.Save(r, w); err != nil {
		http.Error(w, "session save", http.StatusInternalServerError)
		return
	}
	a.log.Info("login accepted", "login", login, "addr", addr)
	a.writeUser(r.Context(), w, &SessionUser{Key: user.Key, Email: user.Email, Name: user.Name})
}

// authenticate resolves and checks the credentials, spending the same work
// whether or not the account exists.
func (a *Auth) authenticate(ctx context.Context, login, password string) (*db.User, error) {
	a.verifying <- struct{}{}
	defer func() { <-a.verifying }()

	user, err := a.db.GetUserByEmail(ctx, login)
	if err != nil && !errors.Is(err, db.ErrNotFound) {
		return nil, fmt.Errorf("lookup: %w", err)
	}
	if user == nil || user.PasswordHash == "" {
		// No stored hash to compare against. Spend the work anyway so the
		// response time does not reveal that.
		BurnPassword(password)
		return nil, errors.New("no password set for this login")
	}
	if err := VerifyPassword(user.PasswordHash, password); err != nil {
		if !errors.Is(err, ErrPasswordMismatch) {
			// The stored hash is unusable. That is an operator problem, but the
			// client still only learns that sign-in failed.
			a.log.Error("stored password hash is unusable", "login", login, "err", err)
		}
		return nil, err
	}
	return user, nil
}

func (a *Auth) tooMany(w http.ResponseWriter, retry time.Duration, field, value string) {
	seconds := int(retry.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	a.log.Warn("login throttled", field, value, "retry_after_s", seconds)
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	http.Error(w, "too many sign-in attempts, try again later", http.StatusTooManyRequests)
}

// LogoutHandler drops the session cookie.
func (a *Auth) LogoutHandler(w http.ResponseWriter, r *http.Request) {
	sess, _ := a.store.Get(r, sessionName)
	sess.Values = map[any]any{}
	sess.Options.MaxAge = -1
	if err := sess.Save(r, w); err != nil {
		http.Error(w, "session save", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *Auth) MeHandler(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	a.writeUser(r.Context(), w, u)
}

func (a *Auth) writeUser(ctx context.Context, w http.ResponseWriter, u *SessionUser) {
	// The stored locale is read fresh rather than kept in the session: a
	// change made in one tab should reach the next request in another, and
	// the session cookie would hold a stale copy until sign-out.
	locale := ""
	if stored, err := a.db.GetUserByEmail(ctx, u.Email); err == nil && stored != nil {
		locale = stored.Locale
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		*SessionUser
		Admin  bool   `json:"admin"`
		Locale string `json:"locale"`
	}{u, a.cfg.IsAdmin(u.Email), locale})
}

// SetLocaleHandler records the reader's interface language.
//
// An empty locale is legal and means "follow the browser", which is how a
// reader undoes a choice rather than having to pick their own language back.
func (a *Auth) SetLocaleHandler(w http.ResponseWriter, r *http.Request) {
	u, ok := UserFromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		Locale string `json:"locale"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if !db.IsSupportedLocale(body.Locale) {
		http.Error(w, "unsupported locale", http.StatusBadRequest)
		return
	}
	if err := a.db.SetUserLocale(r.Context(), u.Key, body.Locale); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"locale": body.Locale})
}

func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess, _ := a.store.Get(r, sessionName)
		u, _ := sess.Values["user"].(*SessionUser)
		if u == nil || u.Key == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), userKey, u)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func UserFromContext(ctx context.Context) (*SessionUser, bool) {
	u, ok := ctx.Value(userKey).(*SessionUser)
	return u, ok && u != nil
}

func WithUser(ctx context.Context, u *SessionUser) context.Context {
	return context.WithValue(ctx, userKey, u)
}

// readCredentials accepts either a JSON body or a form post. The SPA sends
// JSON; the form path keeps a plain HTML submit working, which is what the
// browser falls back to with JavaScript disabled.
func readCredentials(w http.ResponseWriter, r *http.Request) (credentials, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxCredentialBytes)

	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err == nil && mediaType == "application/json" {
		var c credentials
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			return credentials{}, err
		}
		return c, nil
	}
	if err := r.ParseForm(); err != nil {
		return credentials{}, err
	}
	return credentials{
		Login:    r.PostFormValue("login"),
		Password: r.PostFormValue("password"),
	}, nil
}

// clientAddr is the rate-limiting key for a request's origin.
//
// chi's RealIP middleware has already rewritten RemoteAddr from
// X-Forwarded-For, which a client could forge if the process were exposed
// directly. It sits behind Caddy here, and the per-account limiter covers the
// case where the per-address one is evaded.
func clientAddr(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
