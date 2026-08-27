#!/bin/bash
# Pulls the latest main, applies any new DB migrations, and rebuilds/
# restarts the production stack. Run from anywhere inside the repo
# checkout on the VM:
#
#   ./infra/deploy/update.sh
#
# Meant to be simple enough that anyone (not just whoever wrote the
# change) can run it safely — stops on the first failure rather than
# partially applying an update (set -e), and never touches git history
# beyond a fast-forward (a diverged local checkout is a sign something's
# wrong and should be looked at, not silently merged over).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "==> Pulling latest main..."
git pull --ff-only

echo "==> Installing host-side dependencies (for migrations)..."
pnpm install

echo "==> Ensuring Postgres is up..."
docker compose -f docker-compose.prod.yml up -d db

echo "==> Running migrations..."
set -a
source .env
set +a
export DATABASE_URL="postgres://law_portal:${POSTGRES_PASSWORD}@localhost:5432/law_portal"
pnpm db:migrate

echo "==> Rebuilding and restarting the stack..."
docker compose -f docker-compose.prod.yml up -d --build

echo "==> Checking health..."
sleep 3
curl -sf "https://${PORTAL_DOMAIN}/api/health" && echo || {
  echo "Health check failed — check: docker compose -f docker-compose.prod.yml logs --tail 50"
  exit 1
}

echo "==> Done."
