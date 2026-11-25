#!/bin/sh
# Migrates (under an advisory lock, safe with many replicas), then starts the role.
set -e
cd /app
node_modules/.bin/tsx scripts/migrate.ts
if [ "${SEED_DEMO:-false}" = "true" ]; then
  node_modules/.bin/tsx scripts/seed.ts --if-empty
fi
case "${ROLE:-all}" in
  worker) exec node_modules/.bin/tsx scripts/worker.ts ;;
  web|all) exec node_modules/.bin/next start -p "${PORT:-3000}" -H "${HOSTNAME:-0.0.0.0}" ;;
  *) echo "Unknown ROLE=$ROLE (all | web | worker)"; exit 1 ;;
esac
