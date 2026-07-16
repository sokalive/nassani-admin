#!/usr/bin/env bash
set -euo pipefail
cd /var/www/nassani-admin
echo "HEAD=$(git rev-parse HEAD)"
echo "cwd_server_git=$(cd server && git rev-parse HEAD)"
pm2 env 4 2>/dev/null | grep -iE 'GIT_|COMMIT|RENDER|GITHUB_SHA|NASSANI_GIT' || true
echo "=== update-check ==="
curl -fsS https://api.nassanitv.online/api/update-check
echo
echo "=== health ==="
curl -fsS https://api.nassanitv.online/api/health
echo
echo "=== DB foreign identity ==="
sudo -u postgres psql -d nassani_db -c "SELECT key, value FROM app_settings WHERE value ILIKE '%burudani%' OR value ILIKE '%osmani%' OR value ILIKE '%osmantv%' ORDER BY key;"
echo "=== update keys ==="
sudo -u postgres psql -d nassani_db -c "SELECT key, value FROM app_settings WHERE key LIKE 'update_%' ORDER BY key;"
echo "=== grep data/env ==="
grep -RInE 'burudanitv|osmanitv\.com|com\.burudani|com\.osmani' server/data server/.env .env 2>/dev/null | head -50 || true
