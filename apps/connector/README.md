# Connector

Go service installed on-prem at each firm. Bridges the firm's SMB file
server to the hosted portal over outbound-only HTTPS — no VPN, no inbound
firewall rule. See [`docs/PLAN.md`](../../docs/PLAN.md) "Tunnel-free file
flow" for the full design and [`docs/PLAN.md`](../../docs/PLAN.md) Phase 1
for build/exit criteria.

## Status

Long-poll loop, stage_download/receive_upload/scan_reconcile job handling,
AES-256-GCM relay encryption, and the Windows-service wrapper are
scaffolded and build clean: `go build ./...`, `go vet ./...`, and
`gofmt -l .` all pass, cross-compiles to `GOOS=windows`, and
`go test ./...` passes (round-trip, wrong-key, and tampered-ciphertext
cases for the crypto; file-hashing and `.dmsversions` exclusion for the
scanner). **Not yet tested against a real portal or a real SMB share** —
the portal-side endpoints it calls (`/api/connector/.../poll`,
`/relay/put-url`, `/relay/get-url`, `/result`) don't exist yet, and the
enrollment/pairing flow, NTFS ACL import, and OCR are all unbuilt. See
docs/PLAN.md Phase 1 for the actual exit criteria (a file opening in a
browser with no tunnel, relay blob provably expiring).

## Layout

- `cmd/connector` — entrypoint: enrollment, long-poll loop, job dispatch.
- `internal/jobs` — job/result types. Hand-kept in sync with
  `packages/shared/src/jobs.ts` on the portal side — these two files are the
  cross-language contract; change them together.
- `internal/relay` — AES-256-GCM encrypt/decrypt and presigned-URL
  PUT/GET against the object storage relay (Wasabi initially, see
  docs/PLAN.md Risk R1 — kept behind an interface so swapping to S3 is a
  small change).
- `internal/scan` — SMB/UNC directory walk, content hashing, and the
  reconciliation scan (docs/PLAN.md "SMB Reconciliation"). Currently a
  polling-based stub; `ReadDirectoryChangesW`-based live watching and the
  NTFS USN Journal fast path are follow-up work once the polling path is
  proven against a real share.
- `internal/svc` — Windows service lifecycle
  (`golang.org/x/sys/windows/svc`), gated behind a `windows` build tag so
  the rest of the package still builds on a non-Windows dev machine.

## Deliberately deferred

- NTFS ACL import/drift-detection (docs/PLAN.md "Permissions Model").
- OCR/text extraction (Phase 4).
- Auto-update and health telemetry beyond the basic heartbeat (Phase 6).
