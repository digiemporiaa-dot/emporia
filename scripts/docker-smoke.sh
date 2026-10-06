#!/usr/bin/env bash
# Boot the production image against an empty PostgreSQL and check what a first
# deploy depends on. Used by CI (.github/workflows/ci.yml) and runnable on any
# machine with Docker:
#
#   docker build -t emporia:smoke .
#   IMAGE=emporia:smoke scripts/docker-smoke.sh
#
# It creates its own network, database and app container, and removes them on
# exit. Nothing here talks to anything outside the machine.
set -euo pipefail

IMAGE="${IMAGE:-emporia:smoke}"
NET="emporia-smoke-$$"
DB="emporia-smoke-db-$$"
APP="emporia-smoke-app-$$"
PORT="${SMOKE_PORT:-3999}"
SECRET="$(head -c 32 /dev/urandom | base64)"
CRON="$(head -c 32 /dev/urandom | base64)"

fail() { echo "SMOKE FAIL: $*" >&2; docker logs "$APP" 2>&1 | tail -60 >&2 || true; exit 1; }
pass() { echo "  ok  $*"; }
cleanup() { docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_USER=emporia -e POSTGRES_PASSWORD=emporia -e POSTGRES_DB=emporia postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$DB" pg_isready -U emporia >/dev/null 2>&1 && break; sleep 1; done
docker exec "$DB" pg_isready -U emporia >/dev/null || fail "postgres did not start"

echo "Booting $IMAGE against an empty database..."
docker run -d --name "$APP" --network "$NET" -p "127.0.0.1:${PORT}:3000" \
  -e DATABASE_URL="postgresql://emporia:emporia@${DB}:5432/emporia" \
  -e AUTH_SECRET="$SECRET" \
  -e SITE_URL="https://emporia.example" \
  -e AUTH_URL="https://emporia.example" \
  -e CRON_SECRET="$CRON" \
  "$IMAGE" >/dev/null

# The image's own HEALTHCHECK is the signal Coolify uses; wait for it.
for _ in $(seq 1 120); do
  state="$(docker inspect -f '{{.State.Health.Status}}' "$APP" 2>/dev/null || echo missing)"
  [ "$state" = healthy ] && break
  [ "$(docker inspect -f '{{.State.Running}}' "$APP")" = true ] || fail "container exited during boot"
  sleep 2
done
[ "$state" = healthy ] || fail "container never became healthy (last: $state)"
pass "container healthy (migrations applied, platform synced, server up)"

logs="$(docker logs "$APP" 2>&1)"
grep -q "All migrations have been successfully applied\|No pending migrations" <<<"$logs" || fail "migrations did not report success"
grep -q "starter pages: created" <<<"$logs" || fail "starter pages were not created on first boot"
pass "boot log: migrations applied, homepage and starter pages created"

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
[ "$(code "http://127.0.0.1:${PORT}/api/health")" = 200 ] || fail "/api/health"
[ "$(code "http://127.0.0.1:${PORT}/")" = 200 ] || fail "/ did not serve"
[ "$(code "http://127.0.0.1:${PORT}/auth/login")" = 200 ] || fail "/auth/login did not serve"
[ "$(code "http://127.0.0.1:${PORT}/privacy-policy")" = 404 ] || fail "a starter draft is publicly visible"
pass "health, home and sign-in serve; starter drafts stay private"

location="$(curl -s -o /dev/null -D - -H 'Host: emporia.example' -H 'X-Forwarded-Proto: https' "http://127.0.0.1:${PORT}/admin" | tr -d '\r' | awk 'tolower($1)=="location:" {print $2}')"
[ "$location" = "https://emporia.example/auth/login?redirectTo=%2Fadmin" ] || fail "signed-out redirect went to '$location'"
pass "signed-out /admin redirects to the public host"

curl -s "http://127.0.0.1:${PORT}/robots.txt" | grep -q "Sitemap: https://emporia.example/sitemap.xml" || fail "robots.txt does not use SITE_URL"
cookies="$(curl -s -o /dev/null -D - "http://127.0.0.1:${PORT}/" | tr -d '\r' | grep -i '^set-cookie: em_vid')"
grep -qi "secure" <<<"$cookies" || fail "visitor cookie is not Secure"
pass "robots uses SITE_URL; cookies are Secure"

docker exec -e SEED_SUPER_ADMIN_EMAIL=owner@smoke.example -e SEED_SUPER_ADMIN_PASSWORD=smoke-test-password-1 "$APP" npm run db:seed >/tmp/smoke-seed.log 2>&1 || { cat /tmp/smoke-seed.log >&2; fail "db:seed failed inside the container"; }
grep -q "super admin: owner@smoke.example" /tmp/smoke-seed.log || fail "seed did not create the super admin"
pass "npm run db:seed creates the first super admin inside the container"

[ "$(docker exec "$APP" id -u)" = 1001 ] || fail "container does not run as the nextjs user"
docker exec "$APP" sh -c 'command -v chromium >/dev/null && chromium --version' >/dev/null || fail "chromium is missing (invoice PDFs)"
docker exec "$APP" sh -c 'test ! -d node_modules/eslint && test ! -d node_modules/vitest' || fail "development tooling is in the image"
docker exec "$APP" sh -c 'test ! -e .env' || fail "an .env file is in the image"
pass "runs as uid 1001; chromium present; no dev tooling or .env in the image"

[ "$(code -H "Authorization: Bearer ${CRON}" "http://127.0.0.1:${PORT}/api/cron")" = 200 ] || fail "/api/cron with the secret"
[ "$(code "http://127.0.0.1:${PORT}/api/cron")" = 401 ] || fail "/api/cron without the secret should be refused"
pass "scheduler endpoint runs with CRON_SECRET and refuses without it"

echo "SMOKE PASS"
