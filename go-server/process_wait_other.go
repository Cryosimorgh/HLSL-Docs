//go:build !windows

package main

import (
	"errors"
	"syscall"
	"time"
)

func waitForProcessExit(pid int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if err := syscall.Kill(pid, 0); err == syscall.ESRCH {
			return nil
		}
		time.Sleep(150 * time.Millisecond)
	}
	return errors.New("server did not exit before update timeout")
}
