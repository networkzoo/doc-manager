//go:build !windows

// Non-Windows stub so `go build ./...` and `go vet ./...` work on a Linux
// or macOS dev machine even though production deployment targets Windows
// (docs/PLAN.md "Filesystem access from the connector" covers the
// non-Windows deployment option — a Linux NAS running the connector
// directly, without the Windows service wrapper).
package svc

import "context"

type RunFn func(ctx context.Context)

func Run(run RunFn) error {
	run(context.Background())
	return nil
}

func IsService() (bool, error) {
	return false, nil
}
