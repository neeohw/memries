//go:build !unix

package index

import "os/exec"

// No process groups to speak of here. Cancelling kills the indexer itself and
// leaves anything it spawned to its own timeouts; the box this runs on is
// Debian, and this file exists so a Windows dev host still builds (ADR 0004).
func setProcessGroup(*exec.Cmd) {}

func terminate(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return errNoProcess
	}
	return cmd.Process.Kill()
}
