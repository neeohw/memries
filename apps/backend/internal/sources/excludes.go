package sources

import (
	"regexp"
	"strings"

	"github.com/memries/memries/internal/storage"
)

// MaxExcludes caps the patterns on one Source. Each one is tried against
// every directory the walk reaches, and a hundred of them is a configuration
// mistake rather than a library that needs them.
const MaxExcludes = 64

// MaxExcludeLength caps one pattern, so a pathological regex cannot be stored
// in the first place.
const MaxExcludeLength = 512

// CompileExcludes turns a Source's patterns into the directory filter its
// storage backend applies (ADR 0020).
//
// Patterns are matched against the directory's path below the Source root,
// slash-separated with no leading or trailing slash, so `^2019/` pins to one
// place and `(^|/)\.thumbs$` catches every occurrence. The match is
// unanchored, as `regexp.MatchString` is, which is what makes a bare `RAW`
// mean "anywhere".
//
// Returns nil when there is nothing to exclude, so the backend keeps its
// cheaper path instead of calling a filter that always says no.
func CompileExcludes(patterns []string) (storage.SkipDirFunc, error) {
	match, err := ExcludeMatcher(patterns)
	if err != nil || match == nil {
		return nil, err
	}
	return func(dir string) bool { return match(dir) != "" }, nil
}

// ExcludeMatcher is the same test, reporting the pattern that matched rather
// than a bool. The dry run names it, so a folder it leaves out is explained
// by the rule responsible instead of being silently absent (ADR 0027).
//
// Returns nil when there is nothing to exclude, like CompileExcludes.
func ExcludeMatcher(patterns []string) (func(dir string) string, error) {
	cleaned, err := ValidateExcludes(patterns)
	if err != nil {
		return nil, err
	}
	if len(cleaned) == 0 {
		return nil, nil
	}
	res := make([]*regexp.Regexp, 0, len(cleaned))
	for _, p := range cleaned {
		re, err := regexp.Compile(p)
		if err != nil {
			return nil, invalidf("exclude %q is not a valid expression: %v", p, err)
		}
		res = append(res, re)
	}
	return func(dir string) string {
		dir = strings.Trim(dir, "/")
		if dir == "" {
			return ""
		}
		for _, re := range res {
			if re.MatchString(dir) {
				return re.String()
			}
		}
		return ""
	}, nil
}

// ValidateExcludes trims, drops blanks, and reports anything that would not
// compile — at the point the reader is saving the Source, rather than hours
// later in a scan log they are not watching.
func ValidateExcludes(patterns []string) ([]string, error) {
	out := make([]string, 0, len(patterns))
	for _, raw := range patterns {
		p := strings.TrimSpace(raw)
		if p == "" {
			continue
		}
		if len(p) > MaxExcludeLength {
			return nil, invalidf("exclude pattern is longer than %d characters", MaxExcludeLength)
		}
		if _, err := regexp.Compile(p); err != nil {
			return nil, invalidf("exclude %q is not a valid expression: %v", p, err)
		}
		out = append(out, p)
	}
	if len(out) > MaxExcludes {
		return nil, invalidf("a source may have at most %d exclude patterns", MaxExcludes)
	}
	return out, nil
}
