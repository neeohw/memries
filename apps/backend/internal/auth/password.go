package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Password hashing is argon2id with the parameters OWASP recommends for a
// memory-constrained host: 19MiB, two passes, no parallelism (ADR 0016).
//
// The board this runs on has four Cortex-A53 cores and 2GB of RAM. The often
// quoted 64MiB profile would be both slow here and a denial-of-service lever,
// since every unauthenticated request could ask for 64MiB. 19MiB keeps a
// single verification near a tenth of a second on this class of CPU while
// staying far out of reach of GPU cracking.
const (
	argonMemory  = 19 * 1024 // KiB
	argonTime    = 2
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

// ErrPasswordMismatch is returned when a password does not match the hash. It
// is deliberately indistinguishable from a missing user at the HTTP layer.
var ErrPasswordMismatch = errors.New("password does not match")

// HashPassword returns a PHC-formatted argon2id hash:
//
//	$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
//
// The parameters travel with the hash, so they can be raised later without
// invalidating existing passwords.
func HashPassword(password string) (string, error) {
	if password == "" {
		return "", errors.New("password must not be empty")
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	sum := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		b64(salt), b64(sum)), nil
}

// VerifyPassword reports whether password matches the encoded argon2id hash.
// The comparison is constant time, so a near-miss leaks no more than a
// complete miss.
func VerifyPassword(encoded, password string) error {
	p, salt, want, err := parseHash(encoded)
	if err != nil {
		return err
	}
	got := argon2.IDKey([]byte(password), salt, p.time, p.memory, p.threads, uint32(len(want)))
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return ErrPasswordMismatch
	}
	return nil
}

// BurnPassword spends the same work VerifyPassword would, then throws the
// result away. The login handler calls it when no password hash exists for the
// submitted address, so an unknown account cannot be told from a wrong
// password by how long the response takes.
func BurnPassword(password string) {
	var salt [argonSaltLen]byte // a fixed salt is fine: the result is discarded
	_ = argon2.IDKey([]byte(password), salt[:], argonTime, argonMemory, argonThreads, argonKeyLen)
}

type argonParams struct {
	memory  uint32
	time    uint32
	threads uint8
}

// parseHash reads a PHC string. Only argon2id is accepted: silently treating
// another algorithm as valid would be worse than refusing to log the user in.
func parseHash(encoded string) (argonParams, []byte, []byte, error) {
	var p argonParams
	parts := strings.Split(encoded, "$")
	// "", "argon2id", "v=19", "m=...,t=...,p=...", salt, hash
	if len(parts) != 6 || parts[0] != "" {
		return p, nil, nil, errors.New("password hash is malformed")
	}
	if parts[1] != "argon2id" {
		return p, nil, nil, fmt.Errorf("password hash algorithm %q is not supported", parts[1])
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return p, nil, nil, errors.New("password hash version is malformed")
	}
	if version != argon2.Version {
		return p, nil, nil, fmt.Errorf("password hash version %d is not supported", version)
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return p, nil, nil, errors.New("password hash parameters are malformed")
	}
	if p.memory == 0 || p.time == 0 || p.threads == 0 {
		return p, nil, nil, errors.New("password hash parameters are out of range")
	}
	// A hash that demands more memory than this host is willing to spend would
	// turn one login into an outage, so refuse it rather than attempt it.
	if p.memory > 256*1024 {
		return p, nil, nil, errors.New("password hash memory cost is too high to verify")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return p, nil, nil, errors.New("password hash salt is malformed")
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return p, nil, nil, errors.New("password hash digest is malformed")
	}
	if len(salt) == 0 || len(want) == 0 {
		return p, nil, nil, errors.New("password hash is empty")
	}
	return p, salt, want, nil
}

func b64(b []byte) string { return base64.RawStdEncoding.EncodeToString(b) }
