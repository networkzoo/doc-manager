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
- `docker-compose.yml` — local Postgres for development.

## Status

Phase 0 (foundations) in progress. See `docs/PLAN.md` for build phases.

## Local setup

```
pnpm install
docker compose up -d        # Postgres on localhost:5432 (requires Docker)
pnpm db:migrate
pnpm dev
```

Go toolchain is required to build `apps/connector` — not yet installed in
this environment. Portal and DB packages run on plain Node.
