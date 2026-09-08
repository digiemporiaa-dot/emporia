#!/bin/sh
set -e

# Apply committed migrations before the server accepts traffic.
#
# `migrate deploy` only applies migrations that are already in the repository —
# it never generates or resets — and Prisma takes a Postgres advisory lock, so
# several instances starting at once do not race (docs/ARCHITECTURE.md 17.4).

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "Applying database migrations..."
  ./node_modules/prisma/build/index.js migrate deploy
fi

# Bring platform data in line with the code that is about to run.
#
# A schema migration is only half of a release. The other half is the data the
# code assumes exists: the permission catalogue, which permissions each system
# role holds, the email templates, and the `home` page that `/` renders. A
# release that adds a permission and does not grant it 403s the new feature for
# everyone until somebody remembers to run a command by hand — so this runs it.
#
# It is not the seed. It creates no users, sets no passwords and writes no demo
# content; prisma/platform.ts documents exactly what it touches and what it
# refuses to overwrite. The super admin stays in `npm run db:seed`, which stays
# manual.
#
# Failing here stops the boot on purpose: serving with permissions that do not
# match the deployed code is worse than not serving.

if [ "${SKIP_DB_SYNC:-0}" != "1" ]; then
  echo "Syncing platform data..."
  ./node_modules/.bin/tsx prisma/sync.ts
fi

exec "$@"
