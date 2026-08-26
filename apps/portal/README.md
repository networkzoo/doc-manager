# Portal

Next.js app: matter dashboards, document search, time tracking, and the
long-poll/relay endpoints the connector talks to. See
[`docs/PLAN.md`](../../docs/PLAN.md) for the full architecture.

## Local development

```
cp .env.example .env.local
pnpm install          # from the repo root
docker compose up -d  # Postgres — requires Docker; see repo root README
pnpm db:migrate
pnpm db:seed          # optional — populates a dev tenant/matter
pnpm dev
```

Without `AUTH_MICROSOFT_ENTRA_ID_ID` / `AUTH_GOOGLE_ID` set in
`.env.local`, every request runs as a fixed dev session (see
`src/lib/session.ts`) — no real sign-in needed to work on most of the app.
Set those two once you're testing the actual SSO flow (`src/lib/auth.ts`);
see docs/PLAN.md "SSO (build, not buy — Auth.js)" for how tenant
resolution works and why an unregistered domain gets rejected at sign-in.

## Deployment

**Not Vercel.** The portal runs on your own rack server (docs/PLAN.md
"Hosting & data residency"), behind the Sophos WAF or a Cloudflare proxy —
ordinary containers, not a managed platform.

```
docker build -f apps/portal/Dockerfile -t law-portal-portal .   # from repo root
docker run -p 3000:3000 --env-file apps/portal/.env.local law-portal-portal
```

**Not yet built or run in this environment** — no Docker installed here.
Written against documented Next.js `output: "standalone"` monorepo
behavior (see comments in the Dockerfile for the path-mirroring gotcha
that trips people up), but unverified until it's actually built once
Docker exists on the rack or a dev machine.
