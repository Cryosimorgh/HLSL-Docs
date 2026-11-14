//go:build windows

package main

import (
	"errors"
	"syscall"
	"time"
)

// Wait until the original Windows process releases its executable before replacement.
func waitForProcessExit(pid int, timeout time.Duration) error {
	h, err := syscall.OpenProcess(syscall.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return nil
	} // Already exited; helper has no handle to wait on.
	defer syscall.CloseHandle(h)
	ms := uint32(timeout / time.Millisecond)
	status, err := syscall.WaitForSingleObject(h, ms)
	if err != nil {
		return err
	}
	if status == syscall.WAIT_TIMEOUT {
		return errors.New("server did not exit before update timeout")
	}
	return nil
}
