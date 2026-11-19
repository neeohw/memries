package sources

import (
	"strings"
	"testing"
)

func TestCompileExcludesMatchesPathBelowRoot(t *testing.T) {
	skip, err := CompileExcludes([]string{`^2019/`, `(^|/)\.thumbs$`, `/RAW/`})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	cases := []struct {
		dir  string
		want bool
	}{
		{"2019", false},      // the pattern needs the slash, so the year itself stays
		{"2019/08", true},    // pinned to one branch
		{"2020/2019", false}, // anchored, so the same name elsewhere is kept
		{".thumbs", true},
		{"holiday/.thumbs", true},
		{"holiday/.thumbsx", false},
		{"a/RAW/b", true},
		{"RAW", false}, // `/RAW/` needs both slashes; a bare RAW is a different rule
		{"holiday/2026", false},
	}
	for _, tc := range cases {
		if got := skip(tc.dir); got != tc.want {
			t.Errorf("skip(%q) = %v, want %v", tc.dir, got, tc.want)
		}
	}
}

func TestCompileExcludesNeverSkipsTheRoot(t *testing.T) {
	// A pattern that matches everything must still leave the Source's own
	// root walkable, or the Source would silently index nothing.
	skip, err := CompileExcludes([]string{`.*`})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if skip("") {
		t.Fatal("the source root was skipped")
	}
	if !skip("anything") {
		t.Fatal("a child should have been skipped")
	}
}

func TestCompileExcludesIsNilWithNothingToDo(t *testing.T) {
	// nil, not a function that always says no: the backends check for nil to
	// keep their cheaper path.
	for _, patterns := range [][]string{nil, {}, {"", "   "}} {
		skip, err := CompileExcludes(patterns)
		if err != nil {
			t.Fatalf("compile(%v): %v", patterns, err)
		}
		if skip != nil {
			t.Fatalf("compile(%v) returned a filter, want nil", patterns)
		}
	}
}

func TestCompileExcludesTrimsLeadingAndTrailingSlashes(t *testing.T) {
	skip, err := CompileExcludes([]string{`^2019/`})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	// A backend may hand over "/2019/08/" or "2019/08"; both are the same
	// directory and must decide the same way.
	if !skip("/2019/08/") || !skip("2019/08") {
		t.Fatal("slash handling differs between equivalent paths")
	}
}

func TestValidateExcludesRejectsWhatWillNotCompile(t *testing.T) {
	if _, err := ValidateExcludes([]string{`^2019/`, `(unclosed`}); err == nil {
		t.Fatal("expected an error for an invalid expression")
	} else if !strings.Contains(err.Error(), "(unclosed") {
		t.Fatalf("error should name the offending pattern, got %v", err)
	}
}

func TestValidateExcludesDropsBlanksAndKeepsOrder(t *testing.T) {
	got, err := ValidateExcludes([]string{"  ^a/  ", "", "   ", "^b/"})
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if len(got) != 2 || got[0] != "^a/" || got[1] != "^b/" {
		t.Fatalf("got %q", got)
	}
}

func TestValidateExcludesCaps(t *testing.T) {
	many := make([]string, MaxExcludes+1)
	for i := range many {
		many[i] = "^x/"
	}
	if _, err := ValidateExcludes(many); err == nil {
		t.Fatal("expected a cap on the number of patterns")
	}
	long := []string{strings.Repeat("a", MaxExcludeLength+1)}
	if _, err := ValidateExcludes(long); err == nil {
		t.Fatal("expected a cap on pattern length")
	}
}
