# Build from the repo root: `docker build -f apps/portal/Dockerfile .`
# Needs the whole pnpm workspace as context (packages/db, packages/shared
# are real dependencies, not vendored) — that's why this isn't a
# self-contained apps/portal/-only build. See docs/PLAN.md "Hosting & data
# residency": this runs on the rack server directly, not a managed
# platform, so the image has to be genuinely self-contained at the end.

FROM node:24-alpine AS base
RUN corepack enable

# ---- deps: install once, cached across builds as long as lockfiles/package.json don't change ----
FROM base AS deps
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/portal/package.json apps/portal/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

# ---- builder: full source, produce Next.js standalone output ----
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/portal/node_modules ./apps/portal/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/portal apps/portal
COPY packages/db packages/db
COPY packages/shared packages/shared
RUN pnpm --filter @law-portal/portal build

# ---- runner: minimal production image ----
# `output: "standalone"` (next.config.ts) traces only the production
# node_modules actually reachable from the app, so this stage doesn't
# need pnpm, the workspace source, or a package manager at all.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# In a pnpm-workspace monorepo, standalone output mirrors the path from
# the repo root — the real entrypoint is apps/portal/server.js under
# here, not a flat server.js.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/portal/public ./apps/portal/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
# HOSTNAME=0.0.0.0 so the server accepts connections from outside the
# container (Next's standalone server otherwise binds localhost only) —
# it's the Sophos WAF/Cloudflare proxy in front that's the real edge, not
# this bind address.
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/portal/server.js"]
