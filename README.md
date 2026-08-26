# Law Portal

Hosted, multi-tenant document management + time tracking portal for Canadian
law firms, backed by each firm's own on-prem SMB file server. See
[`docs/PLAN.md`](docs/PLAN.md) for the full architecture and rationale.

## Layout

- `apps/portal` — Next.js web app (matters, documents, search, time tracking).
- `apps/connector` — Go service installed on-prem; bridges SMB <-> relay.
- `packages/db` — Postgres schema, Drizzle migrations, RLS policies.
- `packages/shared` — types and contracts shared between portal and connector
  (job payloads, encryption envelope format).
- `infra/proxmox` — cloud-init + Proxmox walkthrough for provisioning the
  portal's host VM (docs/PLAN.md "Hosting & data residency": self-hosted on
  the rack, not managed cloud).
- `docker-compose.yml` — local Postgres for development.

## Status

Phase 0 (foundations) in progress. See `docs/PLAN.md` for build phases.
Portal (Next.js + real Auth.js SSO) and `packages/db` (schema + RLS
migrations) build/typecheck/lint clean. `apps/connector` (Go) builds,
vets, and passes its tests. Nothing has been run against a live Postgres
instance yet — Docker isn't installed in every dev environment this has
been worked in.

## Local setup

```
pnpm install
docker compose up -d        # Postgres on localhost:5432 (requires Docker)
pnpm db:migrate
pnpm db:seed                # optional — dev tenant/matter
pnpm dev
```

`apps/connector` needs the Go toolchain (1.23+) separately — see
`apps/connector/README.md`.
