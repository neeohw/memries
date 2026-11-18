package auth

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

// fakeClock lets the limiter be tested without sleeping.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time      { return c.t }
func (c *fakeClock) add(d time.Duration) { c.t = c.t.Add(d) }

func newTestLimiter(burst int, refill time.Duration) (*limiter, *fakeClock) {
	clock := &fakeClock{t: time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)}
	l := newLimiter(burst, refill)
	l.now = clock.now
	return l, clock
}

func TestLimiterAllowsBurstThenBlocks(t *testing.T) {
	l, _ := newTestLimiter(3, time.Minute)

	for i := 0; i < 3; i++ {
		if ok, _ := l.allow("ip"); !ok {
			t.Fatalf("attempt %d denied inside the burst", i+1)
		}
	}
	ok, retry := l.allow("ip")
	if ok {
		t.Fatal("fourth attempt allowed past a burst of 3")
	}
	if retry <= 0 || retry > time.Minute {
		t.Errorf("retry-after = %v, want >0 and <=1m", retry)
	}
}

func TestLimiterRefillsOverTime(t *testing.T) {
	l, clock := newTestLimiter(2, time.Minute)
	l.allow("ip")
	l.allow("ip")
	if ok, _ := l.allow("ip"); ok {
		t.Fatal("burst not exhausted")
	}

	clock.add(time.Minute)
	if ok, _ := l.allow("ip"); !ok {
		t.Fatal("one token should have refilled after one refill period")
	}
	if ok, _ := l.allow("ip"); ok {
		t.Fatal("only one token should have refilled")
	}

	// Refill must cap at the burst, not accumulate indefinitely.
	clock.add(10 * time.Hour)
	for i := 0; i < 2; i++ {
		if ok, _ := l.allow("ip"); !ok {
			t.Fatalf("attempt %d denied after a long idle period", i+1)
		}
	}
	if ok, _ := l.allow("ip"); ok {
		t.Fatal("idle time accumulated more than the burst")
	}
}

func TestLimiterKeysAreIndependent(t *testing.T) {
	l, _ := newTestLimiter(1, time.Minute)
	if ok, _ := l.allow("a"); !ok {
		t.Fatal("first key denied")
	}
	if ok, _ := l.allow("a"); ok {
		t.Fatal("first key not throttled")
	}
	// One throttled address must not throttle everyone else.
	if ok, _ := l.allow("b"); !ok {
		t.Fatal("second key denied because the first was throttled")
	}
}

func TestLimiterResetClearsBudget(t *testing.T) {
	l, _ := newTestLimiter(1, time.Minute)
	l.allow("ip")
	if ok, _ := l.allow("ip"); ok {
		t.Fatal("burst not exhausted")
	}
	// A successful sign-in clears the record, so earlier typos do not leave
	// the user throttled.
	l.reset("ip")
	if ok, _ := l.allow("ip"); !ok {
		t.Fatal("reset did not restore the budget")
	}
}

func TestLimiterPrunesIdleBuckets(t *testing.T) {
	l, clock := newTestLimiter(1, time.Minute)
	for i := 0; i < 1200; i++ {
		l.allow(fmt.Sprintf("ip-%d", i))
	}
	before := len(l.buckets)
	if before < 1024 {
		t.Fatalf("only %d buckets, test needs to cross the prune threshold", before)
	}
	// Everything is now idle; adding one more key triggers the sweep.
	clock.add(bucketTTL + time.Minute)
	l.allow("fresh")
	if len(l.buckets) != 1 {
		t.Errorf("after pruning there are %d buckets, want 1 (only the fresh key)", len(l.buckets))
	}
}

func TestLimiterIsConcurrencySafe(t *testing.T) {
	l := newLimiter(1000, time.Minute)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				l.allow(fmt.Sprintf("key-%d", n%5))
			}
		}(i)
	}
	wg.Wait()
	if len(l.buckets) != 5 {
		t.Errorf("got %d buckets, want 5", len(l.buckets))
	}
}
