#!/usr/bin/env bash
# One command to run the app locally: ./dev.sh
#   ./dev.sh --reseed   wipe and reseed the demo data (dates move to "last 60 days from today")
#   ./dev.sh --setup    set everything up but don't start the server
# Safe to re-run: every step skips itself when already done.
# Runs the web app and the pipeline worker in one process. With no keys in .env, AI providers are mocked.
set -euo pipefail
cd "$(dirname "$0")"

RESEED=0; START=1
for arg in "$@"; do
  case "$arg" in
    --reseed) RESEED=1 ;;
    --setup) START=0 ;;
    -h|--help) sed -n 2,5p "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 1 ;;
  esac
done

step() { printf "\n\033[1;35m▸ %s\033[0m\n" "$1"; }
die() { printf "\033[1;31m✗ %s\033[0m\n" "$1"; exit 1; }

step "Checking prerequisites"
command -v node >/dev/null || die "Node.js 20+ is required (https://nodejs.org)"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node.js 20+ is required (found $(node -v))"
command -v docker >/dev/null || die "Docker is required (Docker Desktop, OrbStack or Colima)"
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start it and re-run."
echo "node $(node -v), docker ok"

if [ ! -f .env ]; then
  step "Creating .env from .env.example"
  cp .env.example .env
fi

step "Starting Postgres (localhost:5433)"
docker compose up -d db
for i in $(seq 1 30); do
  docker compose exec -T db pg_isready -U insights -d insights >/dev/null 2>&1 && break
  [ "$i" = 30 ] && die "Postgres did not become ready in 30 s (check: docker compose logs db)"
  sleep 1
done
echo "Postgres ready"

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  step "Installing dependencies"
  npm install
fi

step "Applying database migrations"
out=$(npm run --silent db:migrate 2>&1) || { echo "$out"; die "Migrations failed"; }
echo "Schema up to date"

USERS=$(docker compose exec -T db psql -U insights -d insights -tAc "select count(*) from users" 2>/dev/null || echo 0)
if [ "$RESEED" = 1 ] || [ "${USERS// /}" = 0 ]; then
  step "Seeding demo data (~1,330 conversations)"
  npm run --silent db:seed
else
  echo "Demo data already present ($USERS users). Use --reseed to reset it."
fi

[ "$START" = 1 ] || { step "Setup complete. Run ./dev.sh to start."; exit 0; }

PORT="${PORT:-3000}"
PROVIDERS=$(grep -E '^(ANTHROPIC|OPENAI|GEMINI|SARVAM|DEEPGRAM)_API_KEY=.+|^OPENAI_COMPAT_BASE_URL=.+' .env | cut -d= -f1 | tr '\n' ' ')
echo "AI providers: ${PROVIDERS:-none configured, using mocks (add keys to .env, then npm run providers:check)}"
step "Starting the app on http://localhost:$PORT (pick a demo user on the login page)"
exec npx next dev -p "$PORT"
