package sources

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"github.com/memries/memries/internal/db"
)

type relocation struct{ old, new string }

type memRepo struct {
	mu        sync.Mutex
	next      int
	sources   map[string]db.Source
	migrated  map[string]bool
	relocated []relocation
}

func newMemRepo() *memRepo {
	return &memRepo{sources: map[string]db.Source{}, migrated: map[string]bool{}}
}

func (m *memRepo) ListSources(context.Context) ([]db.Source, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []db.Source
	for _, s := range m.sources {
		out = append(out, s)
	}
	return out, nil
}

func (m *memRepo) GetSource(_ context.Context, key string) (*db.Source, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sources[key]
	if !ok {
		return nil, db.ErrNotFound
	}
	return &s, nil
}

func (m *memRepo) CreateSource(_ context.Context, s *db.Source) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.next++
	s.Key = strconv.Itoa(1000 + m.next)
	m.sources[s.Key] = *s
	return nil
}

func (m *memRepo) ReplaceSource(_ context.Context, s *db.Source) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sources[s.Key]; !ok {
		return db.ErrNotFound
	}
	m.sources[s.Key] = *s
	return nil
}

func (m *memRepo) DeleteSource(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sources[key]; !ok {
		return db.ErrNotFound
	}
	delete(m.sources, key)
	return nil
}

func (m *memRepo) RelocatePhotoPrefix(_ context.Context, old, new string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.relocated = append(m.relocated, relocation{strings.Clone(old), new})
	return nil
}
