package auth

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"testing"

	"golang.org/x/crypto/argon2"
)

func TestHashPasswordRoundTrip(t *testing.T) {
	const pw = "correct horse battery staple"
	encoded, err := HashPassword(pw)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyPassword(encoded, pw); err != nil {
		t.Fatalf("verify own hash: %v", err)
	}
	if err := VerifyPassword(encoded, pw+"!"); !errors.Is(err, ErrPasswordMismatch) {
		t.Errorf("wrong password: err = %v, want ErrPasswordMismatch", err)
	}
	if err := VerifyPassword(encoded, ""); !errors.Is(err, ErrPasswordMismatch) {
		t.Errorf("empty password: err = %v, want ErrPasswordMismatch", err)
	}
}

func TestHashPasswordUsesAFreshSalt(t *testing.T) {
	a, err := HashPassword("same")
	if err != nil {
		t.Fatal(err)
	}
	b, err := HashPassword("same")
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("two hashes of one password are identical, so the salt is not random")
	}
	// Both must still verify: a shared password is not a shared hash.
	for i, encoded := range []string{a, b} {
		if err := VerifyPassword(encoded, "same"); err != nil {
			t.Errorf("hash %d: %v", i, err)
		}
	}
}

func TestHashPasswordEncodesTunedParameters(t *testing.T) {
	encoded, err := HashPassword("x")
	if err != nil {
		t.Fatal(err)
	}
	// The parameters are part of the stored string so they can be raised later
	// without invalidating existing passwords.
	wantPrefix := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$", argon2.Version, 19*1024, 2, 1)
	if !strings.HasPrefix(encoded, wantPrefix) {
		t.Errorf("hash = %q, want prefix %q", encoded, wantPrefix)
	}
	if n := len(strings.Split(encoded, "$")); n != 6 {
		t.Errorf("hash has %d $-separated fields, want 6", n)
	}
}

func TestHashPasswordRejectsEmpty(t *testing.T) {
	if _, err := HashPassword(""); err == nil {
		t.Fatal("hashing an empty password should fail")
	}
}

// A hash carrying parameters other than the current defaults must still
// verify, otherwise raising the cost later would lock everyone out.
func TestVerifyPasswordHonoursEmbeddedParameters(t *testing.T) {
	const pw = "legacy"
	salt := []byte("0123456789abcdef")
	var m uint32 = 8192
	var tt uint32 = 1
	var p uint8 = 1
	sum := argon2.IDKey([]byte(pw), salt, tt, m, p, 32)
	encoded := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, m, tt, p,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(sum))

	if err := VerifyPassword(encoded, pw); err != nil {
		t.Fatalf("hash with non-default parameters: %v", err)
	}
	if err := VerifyPassword(encoded, "wrong"); !errors.Is(err, ErrPasswordMismatch) {
		t.Errorf("err = %v, want ErrPasswordMismatch", err)
	}
}

func TestVerifyPasswordRejectsMalformedHashes(t *testing.T) {
	good, err := HashPassword("pw")
	if err != nil {
		t.Fatal(err)
	}
	fields := strings.Split(good, "$")

	cases := map[string]string{
		"empty":              "",
		"not phc":            "hunter2",
		"too few fields":     "$argon2id$v=19$m=19456,t=2,p=1$" + fields[4],
		"bcrypt":             "$2a$10$3U9SEf30swgNd17eO6G0hO.APdH95xSBigq1uf1zJCk.DI/j1T5Ly",
		"argon2i not id":     strings.Replace(good, "argon2id", "argon2i", 1),
		"unknown version":    strings.Replace(good, "v=19", "v=18", 1),
		"garbled version":    strings.Replace(good, "v=19", "v=xx", 1),
		"garbled params":     strings.Replace(good, "m=19456,t=2,p=1", "m=a,t=b,p=c", 1),
		"zero time":          strings.Replace(good, "t=2", "t=0", 1),
		"salt not base64":    "$argon2id$v=19$m=19456,t=2,p=1$!!!!$" + fields[5],
		"digest not base64":  "$argon2id$v=19$m=19456,t=2,p=1$" + fields[4] + "$!!!!",
		"empty salt":         "$argon2id$v=19$m=19456,t=2,p=1$$" + fields[5],
		"absurd memory cost": strings.Replace(good, "m=19456", "m=99999999", 1),
	}
	for name, encoded := range cases {
		t.Run(name, func(t *testing.T) {
			err := VerifyPassword(encoded, "pw")
			if err == nil {
				t.Fatal("want error, got nil")
			}
			// A malformed hash is a server-side problem, not a wrong password;
			// conflating them would let a corrupt row look like a typo.
			if errors.Is(err, ErrPasswordMismatch) {
				t.Errorf("err = %v, want a parse error rather than ErrPasswordMismatch", err)
			}
		})
	}
}

// An unknown account must cost the same as a known one, or response time
// reveals which addresses are registered.
func TestBurnPasswordDoesNotPanic(t *testing.T) {
	BurnPassword("")
	BurnPassword("anything")
}

func BenchmarkHashPassword(b *testing.B) {
	for i := 0; i < b.N; i++ {
		if _, err := HashPassword("benchmark password"); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkVerifyPassword(b *testing.B) {
	encoded, err := HashPassword("benchmark password")
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := VerifyPassword(encoded, "benchmark password"); err != nil {
			b.Fatal(err)
		}
	}
}
