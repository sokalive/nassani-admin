#!/usr/bin/env bash
set -euo pipefail
ROOT=/var/www/nassani-admin
cd "$ROOT"
ORIGIN=$(git remote get-url origin)
echo "origin=$ORIGIN"
case "$ORIGIN" in
  *osmani*) echo "ERROR: Osmani remote refused" >&2; exit 1 ;;
  *nassani-admin*) ;;
  *) echo "ERROR: unexpected remote" >&2; exit 1 ;;
esac

echo "==> BEFORE"
echo "commit=$(git rev-parse HEAD)"
grep -E '^(BASE_URL|STREAM_API_BASE_URL|ADMIN_PUBLIC_URL)=' server/.env || true
pm2 status || true
ls /etc/letsencrypt/live 2>/dev/null || echo NO_CERTS

echo "==> Pull nassani-admin main"
git fetch origin main
# Bootstrap may have rewritten .env.cutover with IP defaults — discard local cutover drift (secrets stay in server/.env)
git checkout -- server/.env.cutover || true
git merge --ff-only origin/main
echo "commit_now=$(git rev-parse HEAD)"

chmod -R a+rX "$ROOT/dist" "$ROOT/deploy/contabo/public-nassanitv" 2>/dev/null || true

export NASSANI_ADMIN_ROOT="$ROOT"
export CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@nassanitv.online}"
bash "$ROOT/deploy/contabo/setup-nassanitv-ssl.sh"

echo "==> AFTER"
echo "commit=$(git rev-parse HEAD)"
grep -E '^(BASE_URL|STREAM_API_BASE_URL|ADMIN_PUBLIC_URL|NOTIFICATION_IMAGE_PUBLIC_ORIGIN|INSTRUCTION_VIDEO_PUBLIC_ORIGIN)=' server/.env || true
pm2 status
nginx -t
ls -la /etc/nginx/sites-enabled/
ls -la /etc/letsencrypt/live/nassanitv.online/ || true
openssl x509 -in /etc/letsencrypt/live/nassanitv.online/fullchain.pem -noout -subject -dates -ext subjectAltName 2>/dev/null || true

echo "==> HTTPS probes"
for u in \
  https://nassanitv.online/ \
  https://admin.nassanitv.online/ \
  https://api.nassanitv.online/api/health \
  http://nassanitv.online/ \
  http://admin.nassanitv.online/ \
  http://api.nassanitv.online/api/health
do
  code=$(curl -sS -o /dev/null -w '%{http_code}' -L --max-redirs 0 "$u" 2>/dev/null || echo ERR)
  # without -L for redirect check
  code2=$(curl -sS -o /dev/null -w '%{http_code}' "$u" 2>/dev/null || echo ERR)
  echo "$u -> $code2"
done
curl -fsS https://api.nassanitv.online/api/health
echo
echo DONE
