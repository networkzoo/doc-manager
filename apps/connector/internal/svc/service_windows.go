//go:build windows

// Package svc wraps the connector's run loop as a Windows service, so
// firm IT can install it with `sc.exe create` and forget about it rather
// than needing a console session kept open. See docs/PLAN.md "Connector —
// Go" for why a single static binary + native service support is the
// reason Go was chosen for this component over Node/Python.
package svc

import (
	"context"
	"time"

	"golang.org/x/sys/windows/svc"
)

const ServiceName = "LawPortalConnector"

// RunFn is the connector's actual work loop (cmd/connector's run()),
// injected here so this package stays a thin adapter and doesn't need to
// import cmd/connector (which would be a cyclical/awkward dependency for
// a `main` package anyway).
type RunFn func(ctx context.Context)

// Run starts the service. Call this from main() when the process detects
// it's running under the Windows Service Control Manager (see IsService
// below); otherwise call RunFn directly for interactive/console runs,
// which is how the Phase 1 proof-of-concept is exercised.
func Run(run RunFn) error {
	return svc.Run(ServiceName, &handler{run: run})
}

// IsService reports whether the process was started by the Windows SCM.
// main() uses this to decide between svc.Run (production) and a direct,
// blocking call to run() (local/interactive testing).
func IsService() (bool, error) {
	return svc.IsWindowsService()
}

type handler struct {
	run RunFn
}

func (h *handler) Execute(args []string, r <-chan svc.ChangeRequest, s chan<- svc.Status) (svcSpecificEC bool, exitCode uint32) {
	s <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		h.run(ctx)
		close(done)
	}()

	s <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

	for {
		select {
		case <-done:
			// run() returned on its own (shouldn't normally happen —
			// it's meant to loop until ctx is cancelled); report stopped.
			s <- svc.Status{State: svc.Stopped}
			return false, 0

		case req := <-r:
			switch req.Cmd {
			case svc.Interrogate:
				s <- req.CurrentStatus
			case svc.Stop, svc.Shutdown:
				s <- svc.Status{State: svc.StopPending}
				cancel()
				select {
				case <-done:
				case <-time.After(30 * time.Second):
					// run() didn't exit promptly; report stopped anyway so
					// the SCM doesn't hang waiting on us indefinitely.
				}
				s <- svc.Status{State: svc.Stopped}
				return false, 0
			}
		}
	}
}
