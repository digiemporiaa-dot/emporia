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

# --- runner: minimal, non-root ---------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output carries only the traced dependencies.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations and the CLI are needed by the entrypoint's `migrate deploy`.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma7.config.ts ./prisma7.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/dotenv ./node_modules/dotenv
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
