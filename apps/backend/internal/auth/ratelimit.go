package auth

import (
	"sync"
	"time"
)

// Login attempts are rate limited per client address and per account.
//
// Two reasons, not one. Throttling by address slows credential stuffing from a
// single host; throttling by account slows a distributed guess at one known
// address. Either limit alone leaves the other attack untouched.
//
// There is a second motive here. Each verification spends 19MiB and about a
// tenth of a second (see password.go), so unthrottled login attempts are a
// memory and CPU amplifier against a 2GB board, quite apart from guessing.
const (
	// burst is how many attempts are allowed back to back before the refill
	// rate starts to bite. Enough for a few genuine typos.
	loginBurst = 8
	// refill is how long one attempt takes to come back, so the sustained rate
	// is two attempts a minute once the burst is spent.
	loginRefill = 30 * time.Second
	// idle buckets are dropped after this long, so the map cannot grow without
	// bound from one-off addresses.
	bucketTTL = 30 * time.Minute
)

type bucket struct {
	tokens float64
	seen   time.Time
}

// limiter is a token bucket per key. It is safe for concurrent use.
type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	burst   float64
	refill  time.Duration
	// now is swappable so the tests do not have to sleep.
	now func() time.Time
}

func newLimiter(burst int, refill time.Duration) *limiter {
	return &limiter{
		buckets: map[string]*bucket{},
		burst:   float64(burst),
		refill:  refill,
		now:     time.Now,
	}
}

// allow spends one token for key and reports whether it was available, along
// with how long until the next one is.
func (l *limiter) allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()

	b, ok := l.buckets[key]
	if !ok {
		l.pruneLocked(now)
		b = &bucket{tokens: l.burst, seen: now}
		l.buckets[key] = b
	} else {
		b.tokens += now.Sub(b.seen).Seconds() / l.refill.Seconds()
		if b.tokens > l.burst {
			b.tokens = l.burst
		}
		b.seen = now
	}

	if b.tokens < 1 {
		// Time until the bucket holds one whole token.
		missing := 1 - b.tokens
		return false, time.Duration(missing * float64(l.refill))
	}
	b.tokens--
	return true, 0
}

// reset clears a key's budget. The login handler calls it after a successful
// sign-in, so one person's forgotten password does not leave them throttled.
func (l *limiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.buckets, key)
}

// pruneLocked drops buckets nobody has touched recently. It runs only when a
// new key arrives, which is the only time the map can grow.
func (l *limiter) pruneLocked(now time.Time) {
	if len(l.buckets) < 1024 {
		return
	}
	for key, b := range l.buckets {
		if now.Sub(b.seen) > bucketTTL {
			delete(l.buckets, key)
		}
	}
}
