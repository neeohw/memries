package sources

import (
	"context"
	"errors"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/memries/memries/internal/db"
	"github.com/memries/memries/internal/index"
	"github.com/memries/memries/internal/storage"
)

// A dry run reads a folder tree and writes nothing, so its only costs are
// time and the size of the answer. All three bounds exist because the folder
// an admin types is unverified: it may be the whole disk.
const (
	// previewTimeout bounds one dry run. A local walk of a 12k-photo library
	// is well under a second; a WebDAV one is a PROPFIND per folder, which is
	// where this matters. The partial tree is still returned, marked
	// truncated, because half an answer beats an error.
	//
	// Under the server's own 30s request timeout, so the bound that fires is
	// this one and the reader gets a truncated tree rather than a cut-off
	// request.
	previewTimeout = 20 * time.Second
	// previewMaxFiles stops counting rather than letting a mistyped root walk
	// a filesystem to the end.
	previewMaxFiles = 200_000
	// previewMaxNodes bounds the response. A photo library is tens to
	// hundreds of folders; a thousand is already more tree than anyone reads.
	previewMaxNodes = 1_000
)

// PreviewTree is one folder in the dry run's tree.
//
// Only folders holding photos somewhere below them are included: the question
// is which folders a scan would add, and a folder with no photo in it is not
// an answer to that.
type PreviewTree struct {
	Name string `json:"name"`
	// Path is relative to the Source root; empty for the root itself.
	Path string `json:"path"`
	// Photos is the count directly inside this folder, Total the whole subtree.
	Photos int `json:"photos"`
	Total  int `json:"total"`
	// Excluded is the pattern that keeps this folder out, inherited from the
	// nearest excluded ancestor. Empty means the folder would be indexed.
	Excluded string         `json:"excluded,omitempty"`
	Children []*PreviewTree `json:"children,omitempty"`
	// More counts children dropped to stay within previewMaxNodes.
	More int `json:"more,omitempty"`

	// others is the non-media file count, kept per folder only so the totals
	// can leave out what sits under an exclude. Not part of the response: a
	// tree of folders is about photos.
	others int
}

// Preview is what a scan of a Source would find, without having run one.
type Preview struct {
	Name     string `json:"name"`
	Location string `json:"location"`
	// Photos would be indexed; Skipped sit under an excluded folder; Others
	// are files that are not media at all.
	Photos  int `json:"photos"`
	Skipped int `json:"skipped"`
	Others  int `json:"others"`
	// Folders counts the folders that would contribute photos.
	Folders int `json:"folders"`
	// Truncated means a bound was hit and the counts are a floor.
	Truncated bool         `json:"truncated"`
	Tree      *PreviewTree `json:"tree,omitempty"`
}

// errPreviewFull stops a Walk that has counted enough.
var errPreviewFull = errors.New("preview full")

// Preview walks a Source form's location and reports what a scan would find,
// writing nothing: no Source row, no catalog row, no thumbnail.
//
// id is the Source being edited, or "" for one being added. It is only read
// to recover a stored password when the form left the field blank, which is
// how Update treats a nil password.
func (r *Registry) Preview(ctx context.Context, id string, in Input) (Preview, error) {
	typ := strings.ToLower(strings.TrimSpace(in.Type))
	loc, err := normalizeLocation(typ, in.Location, r.Roots)
	if err != nil {
		return Preview{}, err
	}
	match, err := ExcludeMatcher(in.Excludes)
	if err != nil {
		return Preview{}, err
	}

	// Excludes are deliberately *not* compiled into the store. The walk visits
	// what they skip so each excluded folder can be named and counted — the
	// patterns are the destructive half of a scan, and a folder quietly
	// missing from the tree is exactly what a dry run is meant to prevent.
	src := db.Source{Type: typ, Location: loc, Username: strings.TrimSpace(in.Username)}
	if typ != TypeLocal {
		if src.Secret, err = r.previewSecret(ctx, id, in); err != nil {
			return Preview{}, err
		}
	}
	st, err := r.openSource(src)
	if err != nil {
		return Preview{}, invalidf("cannot open %s: %v", loc, err)
	}
	defer closeStore(st)

	ctx, cancel := context.WithTimeout(ctx, previewTimeout)
	defer cancel()

	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = defaultName(loc)
	}
	return walkPreview(ctx, st, loc, name, match)
}

// previewSecret seals the typed password, or keeps the stored one when the
// field was left blank on an edit.
func (r *Registry) previewSecret(ctx context.Context, id string, in Input) (string, error) {
	if in.Password != nil {
		return r.Sealer.Seal(*in.Password)
	}
	if id == "" {
		return "", nil
	}
	stored, err := r.Repo.GetSource(ctx, id)
	if err != nil {
		return "", err
	}
	return stored.Secret, nil
}

type dirCount struct{ photos, others int }

func walkPreview(ctx context.Context, st storage.Storage, loc, name string, match func(string) string) (Preview, error) {
	out := Preview{Name: name, Location: loc}
	counts := map[string]*dirCount{}
	files := 0

	err := st.Walk(ctx, "", func(o storage.ObjectInfo) error {
		files++
		if files > previewMaxFiles {
			return errPreviewFull
		}
		dir := path.Dir(strings.Trim(o.Key, "/"))
		if dir == "." || dir == "/" {
			dir = ""
		}
		c := counts[dir]
		if c == nil {
			c = &dirCount{}
			counts[dir] = c
		}
		if index.IsMedia(o.Key) {
			c.photos++
		} else {
			c.others++
		}
		return nil
	})
	switch {
	case err == nil:
	case errors.Is(err, errPreviewFull), errors.Is(err, context.DeadlineExceeded):
		// Both are "enough": keep what was counted and say so.
		out.Truncated = true
	default:
		return Preview{}, invalidf("cannot read %s: %v", loc, err)
	}

	root := buildPreviewTree(counts, name, match)
	rollup(root)
	// Tallied before the prune, so files in a folder holding no photo still
	// count towards Others: they were found, they are simply not shown.
	tally(root, &out)
	prune(root)
	if capNodes(root, previewMaxNodes) {
		out.Truncated = true
	}
	out.Tree = root
	return out, nil
}

// buildPreviewTree turns the per-folder counts into a tree, creating every
// ancestor so the result reads as the folder structure rather than as a flat
// list of the folders that happen to hold a file.
func buildPreviewTree(counts map[string]*dirCount, name string, match func(string) string) *PreviewTree {
	root := &PreviewTree{Name: name}
	nodes := map[string]*PreviewTree{"": root}
	// Sorted so a parent's children arrive in a stable order whatever order
	// the map hands them over in.
	dirs := make([]string, 0, len(counts))
	for dir := range counts {
		dirs = append(dirs, dir)
	}
	sort.Strings(dirs)
	for _, dir := range dirs {
		n := ensureNode(nodes, dir, match)
		n.Photos = counts[dir].photos
		n.others = counts[dir].others
	}
	return root
}

func ensureNode(nodes map[string]*PreviewTree, p string, match func(string) string) *PreviewTree {
	if n, ok := nodes[p]; ok {
		return n
	}
	parent := ""
	if i := strings.LastIndex(p, "/"); i >= 0 {
		parent = p[:i]
	}
	// The root is seeded by the caller, so this terminates.
	pn := ensureNode(nodes, parent, match)
	n := &PreviewTree{Name: path.Base(p), Path: p}
	// An excluded folder's children are never reached by a real scan, so the
	// pattern is inherited rather than re-tested.
	if pn.Excluded != "" {
		n.Excluded = pn.Excluded
	} else if match != nil {
		n.Excluded = match(p)
	}
	nodes[p] = n
	pn.Children = append(pn.Children, n)
	return n
}

func rollup(n *PreviewTree) int {
	n.Total = n.Photos
	for _, c := range n.Children {
		n.Total += rollup(c)
	}
	return n.Total
}

// prune drops folders with no photo anywhere below them. They are the bulk of
// a real tree — every parent directory on the way down — and none of them is
// an answer to "what would be added".
func prune(n *PreviewTree) {
	kept := n.Children[:0]
	for _, c := range n.Children {
		if c.Total == 0 {
			continue
		}
		prune(c)
		kept = append(kept, c)
	}
	n.Children = kept
}

func tally(n *PreviewTree, out *Preview) {
	if n.Excluded != "" {
		out.Skipped += n.Photos
	} else {
		out.Photos += n.Photos
		out.Others += n.others
		if n.Photos > 0 {
			out.Folders++
		}
	}
	for _, c := range n.Children {
		tally(c, out)
	}
}

// capNodes trims the tree breadth-first to max nodes, so what survives is the
// top of the tree — the part a reader looks at first — and each parent says
// how many children were dropped.
func capNodes(root *PreviewTree, max int) bool {
	count, truncated := 1, false
	for queue := []*PreviewTree{root}; len(queue) > 0; {
		n := queue[0]
		queue = queue[1:]
		keep := 0
		for _, c := range n.Children {
			if count >= max {
				break
			}
			count++
			keep++
			queue = append(queue, c)
		}
		if keep < len(n.Children) {
			n.More = len(n.Children) - keep
			n.Children = n.Children[:keep]
			truncated = true
		}
	}
	return truncated
}
