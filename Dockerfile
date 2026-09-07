# syntax=docker/dockerfile:1

# Multi-stage build for the Next standalone server.
#
# bookworm-slim rather than Alpine: argon2 ships glibc prebuilds, and on musl it
# rebuilds from source, which turns a routine install into a recurring build
# failure (docs/ARCHITECTURE.md 17.1).
#
# Prisma 7 compiles queries in-process and talks to Postgres through the pg
# driver adapter, so there is no query-engine binary in the image and no
# OpenSSL/binaryTargets matching to get wrong.

ARG NODE_VERSION=22-bookworm-slim

# --- deps: install once, cached on the lockfile alone --------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# node-gyp toolchain, needed only if a native prebuild is unavailable.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: generate the client and build --------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No DATABASE_URL here on purpose: the build is hermetic. DB-driven routes use
# ISR with on-demand revalidation rather than generateStaticParams, so nothing
# queries Postgres at build time (docs/ARCHITECTURE.md 17.2).
RUN npm run build

# --- runner: non-root, and able to run its own migrations and seed -----------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# curl, solely so an HTTP health check has something to run with. This base
# image ships neither curl nor wget, so Coolify's `curl -f .../api/health`
# probe exits 127 and the container is marked unhealthy while it is serving
# perfectly well (docs/DEPLOYMENT.md §4).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# The whole dependency tree, devDependencies included.
#
# The entrypoint runs the Prisma 7 CLI, whose transitive closure is ~130
# packages — `effect` among them. Copying only node_modules/{prisma,@prisma,
# dotenv} left every one of those unresolvable and the container died on boot
# with "Cannot find module 'effect'". `npm ci --omit=dev` is not the fix
# either: prisma, tsx and dotenv are all devDependencies, so pruning dev is
# exactly what removes the CLI. The image is correspondingly large; that is a
# deliberate trade for a runner that can migrate and seed itself.
#
# This has to land BEFORE the standalone output so that Next's traced
# node_modules is laid on top of it, not overwritten by it. The two overlap
# only on identical files from the same install.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Standalone output: server.js at /app/server.js, plus its traced dependencies
# and the compiled server bundle under .next/. Next copies the project's real
# package.json here too, scripts and all, which is what makes `npm run db:seed`
# resolvable inside the container.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations, for the entrypoint's `migrate deploy`.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma7.config.ts ./prisma7.config.ts

# `npm run db:seed` — i.e. `tsx prisma/seed.ts` — is how the first super admin
# is created, so it has to run in the deployed image rather than only on a
# developer's machine (docs/DEPLOYMENT.md §5). Beyond prisma/ and tsx, it needs:
#   generated/     seed.ts imports ../generated/prisma/client.js, and the
#                  Prisma 7 client generator emits TypeScript, not JavaScript —
#                  the server bundle has it compiled in, but tsx needs source.
#   lib/           ../lib/auth/permissions.js and ../lib/email/templates.js,
#                  the latter importing @/lib/email/types.
#   tsconfig.json  resolves that `@/*` path alias for tsx.
# Together these are under 10 MB, which next to the node_modules above is noise.
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
