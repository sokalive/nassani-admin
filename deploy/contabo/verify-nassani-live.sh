#!/usr/bin/env bash
set -euo pipefail
echo "=== DB ==="
sudo -u postgres psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE '%nassani%';"
sudo -u postgres psql -d nassani_db -c "SELECT current_database() AS db, current_user AS role;"
sudo -u postgres psql -d nassani_db -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;"
echo "=== ENDPOINTS ==="
for p in /api/health /api/health/db /api/plans /api/channels /api/runtime/cutover-status; do
  code=$(curl -sS -o /tmp/out.json -w "%{http_code}" "http://127.0.0.1:10001${p}" || echo ERR)
  echo "${p} -> ${code}"
  head -c 220 /tmp/out.json; echo
done
echo "=== NGINX PUBLIC ==="
curl -sS -o /dev/null -w "local_root=%{http_code}\n" http://127.0.0.1/
curl -sS -o /dev/null -w "local_api=%{http_code}\n" http://127.0.0.1/api/health
curl -sS -o /dev/null -w "public_root=%{http_code}\n" http://169.58.18.86/
curl -sS -o /dev/null -w "public_api=%{http_code}\n" http://169.58.18.86/api/health
nginx -t
ls -la /etc/nginx/sites-enabled/
echo "=== SERVICES ENABLED ==="
systemctl is-enabled pm2-root nginx postgresql fail2ban || true
echo "=== ENV (redacted) ==="
grep -E '^(BASE_URL|STREAM_|ADMIN_PUBLIC|STREAM_DELIVERY|STREAM_PLAYBACK|UPLOAD_DIR|NODE_ENV|PORT|BUNNY|ASSET_)' /var/www/nassani-admin/server/.env || true
grep -E '^DATABASE_URL=' /var/www/nassani-admin/server/.env | sed 's/=.*/=[REDACTED local postgres]/'
echo "=== OSMANI GUARD ==="
if grep -Ri osmani /var/www/nassani-admin/server/.env /etc/nginx/sites-enabled/ 2>/dev/null; then
  echo FAIL_OSMANI_PRESENT
  exit 1
fi
echo OK_NO_OSMANI
echo "=== GIT ==="
git -C /var/www/nassani-admin remote -v
git -C /var/www/nassani-admin rev-parse HEAD
echo "=== PM2 ==="
pm2 status
echo "=== DONE ==="
