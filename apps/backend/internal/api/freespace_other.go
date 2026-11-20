//go:build !linux && !darwin

package api

// freeBytes has no portable implementation; 0 means "unknown" and the UI
// leaves the figure out rather than showing a wrong one.
func freeBytes(string) uint64 { return 0 }
