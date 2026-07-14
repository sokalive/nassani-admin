#!/usr/bin/env bash
# Apply nassanitv.com nginx vhosts from repo and reload (no cert changes).
# Run on VPS as root after git push updates deploy/contabo/nginx/*.
#
#   curl -fsSL https://raw.githubusercontent.com/sokalive/nassani-admin/main/deploy/contabo/reload-nassanitv-nginx.sh | bash
set -euo pipefail

ROOT="${NASSANI_ADMIN_ROOT:-/var/www/nassani-admin}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root on the VPS" >&2
  exit 1
fi

cd "$ROOT"
git fetch origin main
git reset --hard origin/main
echo "commit: $(git rev-parse HEAD)"

mkdir -p /etc/nginx/snippets
cp "$ROOT/deploy/contabo/nginx/snippets/ssl-params.conf" /etc/nginx/snippets/nassani-ssl-params.conf
cp "$ROOT/deploy/contabo/nginx/snippets/nassani-node-api.conf" /etc/nginx/snippets/nassani-node-api.conf
cp "$ROOT/deploy/contabo/nginx/nassanitv-domains.conf" /etc/nginx/sites-available/nassanitv-domains
ln -sf /etc/nginx/sites-available/nassanitv-domains /etc/nginx/sites-enabled/nassanitv-domains

nginx -t
systemctl reload nginx

if [[ -f "$ROOT/deploy/contabo/patch-vps-https-env.sh" ]]; then
  echo "==> Patch VPS .env for branded HTTPS"
  bash "$ROOT/deploy/contabo/patch-vps-https-env.sh"
fi

echo "==> verify"
curl -fsSI "https://api.nassanitv.com" | head -1
curl -fsS "https://api.nassanitv.com/api/health"
echo
node "$ROOT/deploy/contabo/verify-nassanitv-domains.mjs"
node "$ROOT/deploy/contabo/verify-vps-infrastructure.mjs" || true
