#!/bin/sh
set -e

# Apply committed migrations before the server accepts traffic.
#
# `migrate deploy` only applies migrations that are already in the repository —
# it never generates or resets — and Prisma takes a Postgres advisory lock, so
# several instances starting at once do not race (docs/ARCHITECTURE.md 17.4).
#
# Seeding is deliberately NOT run here: a redeploy must never be able to
# overwrite live data with demo records. Run `npm run db:seed` by hand.

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "Applying database migrations..."
  ./node_modules/prisma/build/index.js migrate deploy
fi

exec "$@"
