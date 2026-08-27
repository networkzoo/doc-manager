# Deploying the app onto the provisioned VM

Follows on from [`infra/proxmox/README.md`](../proxmox/README.md), which
provisions the OS only. This covers getting the actual app running:
cloning the private repo, secrets, migrations, and bringing up
[`docker-compose.prod.yml`](../../docker-compose.prod.yml) (repo root).

Run everything below **on the VM**, over the SSH session from
`infra/proxmox/README.md` step 6.

Steps 1-6 below are the one-time initial setup. For every update after
that, [`infra/deploy/update.sh`](update.sh) does the whole
pull-migrate-rebuild-restart sequence in one command:

```bash
./infra/deploy/update.sh
```

It's deliberately conservative rather than clever: `git pull --ff-only`
(refuses to run if the local checkout has diverged, rather than silently
merging), `pnpm db:migrate` before touching containers, then
`docker compose up -d --build`, then a health check. Stops on the first
failure (`set -e`) instead of partially applying an update. Safe for
anyone to run, not just whoever made the change.

## 1. Deploy key (repo is private)

Generate a keypair on the VM and give it read-only access to just this
repo — cleaner than a personal token, and it can't do anything but pull.

```bash
ssh-keygen -t ed25519 -C "doc-manager-portal-vm" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Paste that public key into **github.com/networkzoo/doc-manager → Settings
→ Deploy keys → Add deploy key** (leave "Allow write access" unchecked).

```bash
git clone git@github.com:networkzoo/doc-manager.git
cd doc-manager
```

## 2. Node.js + pnpm (needed for migrations, not just the app)

The portal's Docker image is self-contained, but running database
migrations from the host needs the same toolchain as local dev —
`packages/db`'s migrate/seed scripts (`drizzle-kit`, `tsx`) aren't part of
the pruned production image.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm
pnpm install
```

## 3. Secrets

```bash
cp .env.production.example .env
chmod 600 .env
```

Fill in `.env`:

```bash
openssl rand -base64 24   # -> POSTGRES_PASSWORD
openssl rand -base64 32   # -> AUTH_SECRET
```

Leave `AUTH_MICROSOFT_ENTRA_ID_ID` / `AUTH_GOOGLE_ID` and their secrets
empty for now — see "What still needs real values" below.

## 4. Bring up Postgres and run migrations

```bash
docker compose -f docker-compose.prod.yml up -d db
```

Migrations run from the host, against the port `db` publishes to
localhost only (`docker-compose.prod.yml` binds it to `127.0.0.1:5432` —
reachable from the VM itself, not the network):

```bash
set -a; source .env; set +a
export DATABASE_URL="postgres://law_portal:${POSTGRES_PASSWORD}@localhost:5432/law_portal"
pnpm db:migrate
```

**Do not run `pnpm db:seed` here** — it inserts fixture data (a fake dev
tenant, a sample matter) meant for local development, not a real
deployment.

## 5. Bring up the app

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f portal   # Ctrl-C once it's settled
curl http://localhost:3000/api/health
# {"status":"ok","db":"reachable"}
```

If that curl comes back clean, the plumbing works: container boots,
reaches Postgres, serves requests.

## 6. TLS via Caddy + ClouDNS

Entra ID and Google both require an HTTPS redirect URI — even for
LAN-only access, that means real TLS, not just skipping it because
nothing's internet-facing. [`infra/caddy`](../caddy) is a custom Caddy
build ([Dockerfile](../caddy/Dockerfile)) with the
[ClouDNS DNS-01 plugin](https://github.com/caddy-dns/cloudns) baked in —
it proves domain ownership through a DNS record it creates/removes
itself via the ClouDNS API, so this VM never needs to be reachable from
the public internet for a certificate to issue or renew.

**DNS:** in your ClouDNS control panel, point your chosen hostname (e.g.
`portal.yourdomain.com`) at this VM's LAN IP — an internal-only A record
is fine, nothing needs to resolve publicly.

**Credentials:** ClouDNS control panel → API Access (a full account) or
→ Sub-Users (a scoped sub-account) → generate a password. Use one or the
other, not both.

**Fill in `.env`** (added to `.env.production.example`):
```
PORTAL_DOMAIN=portal.yourdomain.com
CLOUDNS_AUTH_ID=            # OR CLOUDNS_SUB_AUTH_ID, whichever you generated
CLOUDNS_AUTH_PASSWORD=
```

**Open the firewall for it** — `ufw` currently only allows 22 and 3000:
```bash
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp   # Caddy's HTTP->HTTPS redirect
```

**Bring Caddy up:**
```bash
docker compose -f docker-compose.prod.yml up -d --build caddy
docker compose -f docker-compose.prod.yml logs -f caddy
```
Watch for it obtaining a certificate (look for `certificate obtained
successfully` in the logs, not a repeating retry loop). Then, from
anywhere that resolves `PORTAL_DOMAIN` (your LAN, or your Netbird mesh):
```bash
curl https://portal.yourdomain.com/api/health
```
should return the same clean response as the direct `:3000` check, but
now over a real, valid certificate.

## What still needs real values

**Sign-in will not work yet, and that's expected at this stage** — not a
bug to chase. `NODE_ENV=production` disables the dev-fixed-session
fallback unconditionally (see `apps/portal/src/lib/session.ts`), and with
`AUTH_MICROSOFT_ENTRA_ID_ID`/`AUTH_GOOGLE_ID` empty, there's no working
identity provider for `auth()` to hand back a session. `/api/health`
proves the deploy works independent of all that.

Getting real sign-in working needs, in order:

1. **An Entra ID app registration** (Azure Portal → App registrations →
   New → multitenant → add `openid profile email User.Read` API
   permissions → create a client secret → redirect URI
   `https://<PORTAL_DOMAIN>/api/auth/callback/microsoft-entra-id`) and/or
   a **Google OAuth client** (similar, via Google Cloud Console, redirect
   URI `https://<PORTAL_DOMAIN>/api/auth/callback/google`) — their
   IDs/secrets go into `.env`, then `docker compose -f
   docker-compose.prod.yml up -d --build portal` to pick them up.
2. **A `tenant_sso_domains` row per real firm** before anyone there can
   sign in — the design deliberately rejects unrecognized domains rather
   than auto-provisioning a tenant (docs/PLAN.md "SSO"). There's no admin
   UI for this yet (Phase 2), so today it's a manual insert:
   ```bash
   docker compose -f docker-compose.prod.yml exec db \
     psql -U law_portal -d law_portal -c \
     "insert into tenants (name, slug) values ('Smith Law LLP', 'smith-law') returning id;"
   # then, using the returned id:
   docker compose -f docker-compose.prod.yml exec db \
     psql -U law_portal -d law_portal -c \
     "insert into tenant_sso_domains (tenant_id, email_domain) values ('<id>', 'smithlawllp.ca');"
   ```

None of that is needed to confirm today's deploy worked — just flagging
it so `/matters` failing to load isn't mistaken for something broken.

## Also still pending

- **Netbird join** — the client installed via cloud-init but was
  deliberately left unjoined. `netbird up --setup-key <key>` once you
  have one from your management console (docs/PLAN.md: admin access
  only, never the client-facing portal traffic).
- **Backups** — no automated `pg_dump`/WAL archiving yet (docs/PLAN.md
  Phase 6). The `portal_pgdata` Docker volume is durable across container
  restarts but isn't backed up anywhere off this VM.
