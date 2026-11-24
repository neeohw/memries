package sources

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

// previewRegistry roots the registry at a real tree so a dry run has
// something to walk.
func previewRegistry(t *testing.T, tree map[string]string) (*Registry, string) {
	t.Helper()
	root := t.TempDir()
	for rel, body := range tree {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	sealer, err := NewSealer("test-secret")
	if err != nil {
		t.Fatal(err)
	}
	reg := &Registry{
		Repo:   newMemRepo(),
		Sealer: sealer,
		Roots:  []string{root},
		Log:    slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	return reg, root
}

func child(t *testing.T, n *PreviewTree, name string) *PreviewTree {
	t.Helper()
	for _, c := range n.Children {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no child %q under %q (has %v)", name, n.Name, names(n))
	return nil
}

func names(n *PreviewTree) []string {
	out := make([]string, 0, len(n.Children))
	for _, c := range n.Children {
		out = append(out, c.Name)
	}
	return out
}

// The dry run is the whole point of this file: pressing it must answer "here
// is what would be added" and leave nothing behind (ADR 0027).
func TestPreviewCountsPhotosPerFolderAndSavesNothing(t *testing.T) {
	reg, root := previewRegistry(t, map[string]string{
		"2019/summer/a.jpg":   "x",
		"2019/summer/b.HEIC":  "x",
		"2019/winter/c.png":   "x",
		"2019/notes.txt":      "x",
		"2020/d.jpeg":         "x",
		"empty/readme.md":     "x",
		"deep/a/b/c/e.webp":   "x",
		"2019/summer/.DS_Str": "x",
	})

	p, err := reg.Preview(context.Background(), "", Input{Type: TypeLocal, Location: root})
	if err != nil {
		t.Fatal(err)
	}
	if p.Photos != 5 {
		t.Errorf("Photos = %d, want 5", p.Photos)
	}
	if p.Others != 3 {
		t.Errorf("Others = %d, want 3", p.Others)
	}
	// summer, winter, 2020, deep/a/b/c — the folders holding photos.
	if p.Folders != 4 {
		t.Errorf("Folders = %d, want 4", p.Folders)
	}
	if p.Skipped != 0 || p.Truncated {
		t.Errorf("Skipped = %d, Truncated = %v", p.Skipped, p.Truncated)
	}

	// A folder with no photo anywhere below it is not an answer to "what
	// would be added", so it is left out entirely.
	for _, n := range names(p.Tree) {
		if n == "empty" {
			t.Error("a folder holding no photos should not be in the tree")
		}
	}

	y2019 := child(t, p.Tree, "2019")
	if y2019.Photos != 0 || y2019.Total != 3 {
		t.Errorf("2019 = %d direct / %d total, want 0/3", y2019.Photos, y2019.Total)
	}
	if got := child(t, y2019, "summer").Photos; got != 2 {
		t.Errorf("summer photos = %d, want 2", got)
	}
	if p.Tree.Total != 5 {
		t.Errorf("root total = %d, want 5", p.Tree.Total)
	}

	// Ancestors with no file of their own are still folders in the tree, so
	// the shape reads as the filesystem rather than as a list of leaves.
	leaf := child(t, child(t, child(t, child(t, p.Tree, "deep"), "a"), "b"), "c")
	if leaf.Path != "deep/a/b/c" || leaf.Photos != 1 {
		t.Errorf("leaf = %+v", leaf)
	}

	// Nothing written: no Source row, and the folder is untouched.
	if list, err := reg.Repo.ListSources(context.Background()); err != nil || len(list) != 0 {
		t.Errorf("sources = %v, err = %v; a dry run must save nothing", list, err)
	}
}

// The excludes are the destructive half of a scan, so a dry run names the
// folders they drop instead of quietly omitting them.
func TestPreviewNamesTheExcludeThatSkipsAFolder(t *testing.T) {
	reg, root := previewRegistry(t, map[string]string{
		"keep/a.jpg":         "x",
		"RAW/b.jpg":          "x",
		"RAW/nested/c.jpg":   "x",
		"2019/.thumbs/d.jpg": "x",
	})

	p, err := reg.Preview(context.Background(), "", Input{
		Type:     TypeLocal,
		Location: root,
		Excludes: []string{"^RAW", `(^|/)\.thumbs$`},
	})
	if err != nil {
		t.Fatal(err)
	}
	if p.Photos != 1 {
		t.Errorf("Photos = %d, want 1", p.Photos)
	}
	if p.Skipped != 3 {
		t.Errorf("Skipped = %d, want 3", p.Skipped)
	}
	if p.Folders != 1 {
		t.Errorf("Folders = %d, want 1", p.Folders)
	}

	raw := child(t, p.Tree, "RAW")
	if raw.Excluded != "^RAW" {
		t.Errorf("RAW excluded by %q, want ^RAW", raw.Excluded)
	}
	// A child of an excluded folder is never reached by a real scan, so it
	// carries the ancestor's pattern rather than none.
	if got := child(t, raw, "nested").Excluded; got != "^RAW" {
		t.Errorf("RAW/nested excluded by %q, want the parent's pattern", got)
	}
	if got := child(t, child(t, p.Tree, "2019"), ".thumbs").Excluded; got != `(^|/)\.thumbs$` {
		t.Errorf(".thumbs excluded by %q", got)
	}
	if got := child(t, p.Tree, "keep").Excluded; got != "" {
		t.Errorf("keep excluded by %q, want nothing", got)
	}
}

func TestPreviewRejectsAFolderOutsideTheAllowedRoots(t *testing.T) {
	reg, _ := previewRegistry(t, nil)
	_, err := reg.Preview(context.Background(), "", Input{Type: TypeLocal, Location: t.TempDir()})
	if err == nil {
		t.Fatal("a folder outside the roots should be refused")
	}
}

func TestPreviewRejectsABadExclude(t *testing.T) {
	reg, root := previewRegistry(t, map[string]string{"a.jpg": "x"})
	_, err := reg.Preview(context.Background(), "", Input{
		Type: TypeLocal, Location: root, Excludes: []string{"("},
	})
	if err == nil {
		t.Fatal("an uncompilable pattern should be refused")
	}
}

// A WebDAV folder being edited leaves the password field blank to keep the
// stored one, exactly as Update does.
func TestPreviewKeepsTheStoredPasswordOnAnEdit(t *testing.T) {
	srv, _ := davServer(t, "me", "right", map[string][]byte{"/holiday/a.jpg": {1}})
	repo := newMemRepo()
	reg := newRegistry(t, repo)
	ctx := context.Background()

	v, err := reg.Create(ctx, Input{Type: TypeWebDAV, Location: srv.URL, Username: "me", Password: ptr("right")})
	if err != nil {
		t.Fatal(err)
	}

	p, err := reg.Preview(ctx, v.ID, Input{Type: TypeWebDAV, Location: srv.URL, Username: "me"})
	if err != nil {
		t.Fatalf("preview with a blank password: %v", err)
	}
	if p.Photos != 1 {
		t.Errorf("Photos = %d, want 1", p.Photos)
	}

	// Without the id there is no stored password to fall back on, so the
	// same form is refused rather than silently reporting an empty folder.
	if _, err := reg.Preview(ctx, "", Input{Type: TypeWebDAV, Location: srv.URL, Username: "me"}); err == nil {
		t.Error("an unauthenticated dry run should report the failure")
	}
}

// previewMaxNodes keeps the response bounded; the top of the tree survives and
// each parent says how many children were dropped.
func TestCapNodesTrimsBreadthFirstAndCountsWhatItDropped(t *testing.T) {
	root := &PreviewTree{Name: "root"}
	for i := 0; i < 5; i++ {
		root.Children = append(root.Children, &PreviewTree{Name: "a", Children: []*PreviewTree{{Name: "b"}}})
	}
	if !capNodes(root, 4) {
		t.Fatal("capNodes should report that it trimmed")
	}
	if len(root.Children) != 3 || root.More != 2 {
		t.Errorf("root kept %d children, More = %d; want 3 and 2", len(root.Children), root.More)
	}
	// The cap is reached by the root's own children, so no grandchild fits.
	for _, c := range root.Children {
		if len(c.Children) != 0 || c.More != 1 {
			t.Errorf("child kept %d children, More = %d", len(c.Children), c.More)
		}
	}
	if capNodes(&PreviewTree{Name: "root"}, 4) {
		t.Error("a tree within the cap should not be reported as trimmed")
	}
}
