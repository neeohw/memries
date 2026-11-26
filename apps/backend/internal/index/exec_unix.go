//go:build unix

package index

import (
	"os/exec"
	"syscall"
)

// setProcessGroup puts the child in a group of its own, so cancelling a run
// reaches what it started. The indexer runs ffmpeg per clip; signalling only
// the indexer would orphan a transcode mid-file.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminate(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return errNoProcess
	}
	// Negative pid is the group. Falls back to the process alone if the group
	// is gone, which happens when the child has already exited.
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM); err != nil {
		return cmd.Process.Signal(syscall.SIGTERM)
	}
	return nil
}
