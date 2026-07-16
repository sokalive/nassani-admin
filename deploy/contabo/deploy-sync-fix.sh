#!/usr/bin/env bash
set -euo pipefail
ROOT=/var/www/nassani-admin
cd "$ROOT"
ORIGIN=$(git remote get-url origin)
echo "origin=$ORIGIN"
case "$ORIGIN" in
  *osmani*) echo "ERROR refusing Osmani" >&2; exit 1 ;;
  *nassani-admin*) ;;
  *) echo "ERROR unexpected remote" >&2; exit 1 ;;
esac

echo "==> BEFORE"
git rev-parse HEAD
pm2 status
curl -fsS https://api.nassanitv.online/api/health | head -c 200; echo

echo "==> Pull"
git fetch origin main
git checkout -- server/.env.cutover 2>/dev/null || true
git merge --ff-only origin/main
git rev-parse HEAD

# Ensure stream delivery env for CDN HLS metadata mode
ENVF=server/.env
upsert() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$ENVF" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENVF"
  else
    echo "${k}=${v}" >> "$ENVF"
  fi
}
upsert STREAM_DELIVERY_MODE direct
upsert STREAM_PLAYBACK_FORCE_PROXY 0
upsert DIRECT_STREAM_CUTOVER_ENABLED 1
upsert DIRECT_STREAM_ROLLOUT_PERCENT 100
upsert DIRECT_STREAM_SIGNING_ENABLED 0
upsert BASE_URL https://api.nassanitv.online
upsert STREAM_API_BASE_URL https://api.nassanitv.online
upsert ADMIN_PUBLIC_URL https://admin.nassanitv.online

echo "==> Restart API from ecosystem (reload env)"
export NASSANI_ADMIN_ROOT="$ROOT"
export NASSANI_LOAD_CUTOVER_ENV=1
pm2 delete nassani-admin-api 2>/dev/null || true
pm2 start "$ROOT/deploy/contabo/ecosystem.config.cjs"
pm2 save
sleep 3
curl -fsS https://api.nassanitv.online/api/health; echo

echo "==> Seed catalog"
sed -i 's/\r$//' "$ROOT/deploy/contabo/seed-nassani-catalog.sh" || true
bash "$ROOT/deploy/contabo/seed-nassani-catalog.sh"

echo "==> AFTER VERIFY"
pm2 status
curl -fsS https://api.nassanitv.online/api/health/db | head -c 250; echo
curl -fsS https://api.nassanitv.online/api/health/stream-delivery | head -c 400; echo || true
echo DONE
