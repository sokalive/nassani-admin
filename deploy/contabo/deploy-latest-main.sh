#!/usr/bin/env bash
set -euo pipefail
ROOT=/var/www/nassani-admin
cd "$ROOT"

echo "=== BEFORE ==="
git rev-parse HEAD
curl -fsS https://api.nassanitv.online/api/update-check | head -c 400
echo

echo "=== PULL ==="
git fetch origin main
git merge --ff-only origin/main
git rev-parse HEAD
git log -1 --oneline

echo "=== RESTART PM2 ==="
export NASSANI_ADMIN_ROOT="$ROOT"
export NASSANI_LOAD_CUTOVER_ENV=1
pm2 restart nassani-admin-api --update-env || {
  pm2 delete nassani-admin-api || true
  pm2 start deploy/contabo/ecosystem.config.cjs
}
pm2 save
sleep 3

echo "=== AFTER UPDATE-CHECK ==="
curl -fsS https://api.nassanitv.online/api/update-check
echo
echo "=== HEALTH ==="
curl -fsS https://api.nassanitv.online/api/health
echo
echo "=== DB APP SETTINGS ==="
sudo -u postgres psql -d nassani_db -c "SELECT key, value FROM app_settings WHERE key LIKE 'update_%' ORDER BY key;"
echo "=== SERVICES ==="
pm2 status
systemctl is-active nginx
systemctl is-active postgresql
