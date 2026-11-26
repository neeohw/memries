package index

import (
	"strings"
	"testing"
)

func TestIndexerArgs(t *testing.T) {
	for _, tc := range []struct {
		name   string
		opts   Options
		config string
		want   string
	}{
		{
			name: "progress is always asked for, since that is how the run reports",
			want: "--progress json",
		},
		{
			name:   "the child reads the file the server read, not one it finds",
			config: "/etc/memries/config.yaml",
			want:   "--progress json --config /etc/memries/config.yaml",
		},
		{
			// One flag per Source, so the child walks exactly the set the
			// coordinator resolved and wrote onto the run row.
			name: "every resolved Source travels as its own flag",
			opts: Options{Prefixes: []string{"src-1", "src-2"}, Concurrency: 4},
			want: "--progress json --concurrency 4 --source src-1 --source src-2",
		},
		{
			name: "a forced run says so",
			opts: Options{Force: true},
			want: "--progress json --force",
		},
		{
			// Zero means "whatever the indexer's own default is", which is the
			// one place that number is written down.
			name: "no concurrency flag when none was chosen",
			opts: Options{Concurrency: 0},
			want: "--progress json",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := strings.Join(indexerArgs(tc.opts, tc.config), " ")
			if got != tc.want {
				t.Errorf("args %q, want %q", got, tc.want)
			}
		})
	}
}

func TestReadProgressForwardsEveryUpdateAndKeepsTheLast(t *testing.T) {
	out := strings.NewReader(`{"discovered":10,"processed":1}
{"discovered":10,"processed":5}
{"discovered":10,"processed":10,"indexed":7,"skipped":3}
`)
	var seen []int
	last := readProgress(out, func(p Result) { seen = append(seen, p.Processed) })

	if want := []int{1, 5, 10}; len(seen) != len(want) {
		t.Fatalf("forwarded %v, want %v", seen, want)
	}
	if last.Processed != 10 || last.Indexed != 7 || last.Skipped != 3 {
		t.Errorf("last update %+v, want the third line", last)
	}
}

// The contract is that the child's own output goes to stderr. A stray line on
// stdout is not worth abandoning a scan over, so it is skipped.
func TestReadProgressIgnoresAnythingThatIsNotAnUpdate(t *testing.T) {
	out := strings.NewReader("indexer start\n{\"processed\":2}\nnot json at all\n{bad\n")
	var seen int
	last := readProgress(out, func(Result) { seen++ })
	if seen != 1 {
		t.Errorf("forwarded %d updates, want 1", seen)
	}
	if last.Processed != 2 {
		t.Errorf("last update %+v, want processed 2", last)
	}
}

func TestTailWriterKeepsTheEnd(t *testing.T) {
	w := &tailWriter{limit: 8}
	for _, chunk := range []string{"aaaa", "bbbb", "cccc\n"} {
		if _, err := w.Write([]byte(chunk)); err != nil {
			t.Fatal(err)
		}
	}
	// The last few lines are what a failed run's error message is for, so the
	// front is what gets dropped.
	if got := w.String(); got != "bbbcccc" {
		t.Errorf("tail %q, want %q", got, "bbbcccc")
	}
}
