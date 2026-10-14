#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
mkdir -p .agent-work
umask 077
{
  printf '%s\n' 'SWIFTBUILD_DB_NAME=swiftbuild_test' 'PORT=3307' 'SWIFTBUILD_URL=http://localhost:3307'
  for setting in SWIFTBUILD_DB_ADMIN_PASSWORD SWIFTBUILD_DB_RUNTIME_PASSWORD SWIFTBUILD_AUTH_SECRET SWIFTBUILD_COMPUTATION_TOKEN; do
    printf '%s=%s\n' "$setting" "$(openssl rand -hex 32)"
  done
} > .agent-work/ci-server.env
compose() { docker compose --env-file .agent-work/ci-server.env -f compose.yaml -f compose.server.yaml -p swiftbuild-engineering-smoke "$@"; }
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then compose logs --tail 40; fi
  compose down -v
  rm -f .agent-work/ci-server.env
  exit "$status"
}
trap cleanup EXIT
compose up --build --wait --wait-timeout 240
export SWIFTBUILD_SMOKE_RESTART_ID="$(openssl rand -hex 16)"
export SWIFTBUILD_SMOKE_RESTART_PASSWORD="$(openssl rand -hex 32)"
compose run --rm -e SWIFTBUILD_SMOKE_RESTART_ID -e SWIFTBUILD_SMOKE_RESTART_PASSWORD migrate pnpm --filter @swiftbuild/server-core exec tsx src/deployment-smoke.ts
# Recreate the services against the same named volume and private configuration.
compose down
compose up --wait --wait-timeout 240
compose run --rm -e SWIFTBUILD_SMOKE_RESTART_ID -e SWIFTBUILD_SMOKE_RESTART_PASSWORD migrate pnpm --filter @swiftbuild/server-core exec tsx src/deployment-restart-smoke.ts
