#!/usr/bin/env bash
# Provision Let's Encrypt TLS for nassanitv.com branded hosts on Contabo VPS.
#
# Prerequisites:
#   A records → VPS IP for api.nassanitv.com, admin.nassanitv.com, nassanitv.com
#
# Usage (on VPS as root):
#   CERTBOT_EMAIL=you@nassanitv.com bash deploy/contabo/setup-nassanitv-ssl.sh
set -euo pipefail

ROOT="${NASSANI_ADMIN_ROOT:-/var/www/nassani-admin}"
EMAIL="${CERTBOT_EMAIL:-admin@nassanitv.com}"
CERT_NAME="nassanitv.com"
CERT_DIR="/etc/letsencrypt/live/${CERT_NAME}"
API_DIR="$ROOT/server"
ENV_FILE="$API_DIR/.env"

echo "==> Nassani TV domain TLS setup"
echo "    root: $ROOT"
echo "    email: $EMAIL"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root on the VPS" >&2
  exit 1
fi

mkdir -p /var/www/certbot
mkdir -p /etc/nginx/snippets

cp "$ROOT/deploy/contabo/nginx/snippets/ssl-params.conf" /etc/nginx/snippets/nassani-ssl-params.conf
cp "$ROOT/deploy/contabo/nginx/snippets/nassani-node-api.conf" /etc/nginx/snippets/nassani-node-api.conf

deploy_acme_http() {
  cp "$ROOT/deploy/contabo/nginx/nassanitv-acme-http.conf" /etc/nginx/sites-available/nassanitv-domains
  ln -sf /etc/nginx/sites-available/nassanitv-domains /etc/nginx/sites-enabled/nassanitv-domains
  nginx -t
  systemctl reload nginx
}

deploy_ssl_vhosts() {
  if [[ ! -f "$CERT_DIR/fullchain.pem" ]]; then
    echo "ERROR: cert missing at $CERT_DIR" >&2
    exit 1
  fi
  cp "$ROOT/deploy/contabo/nginx/nassanitv-domains.conf" /etc/nginx/sites-available/nassanitv-domains
  ln -sf /etc/nginx/sites-available/nassanitv-domains /etc/nginx/sites-enabled/nassanitv-domains
  nginx -t
  systemctl reload nginx
}

upsert_env() {
  local key="$1" val="$2"
  if [[ ! -f "$ENV_FILE" ]]; then
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

if [[ -f "$CERT_DIR/fullchain.pem" ]]; then
  echo "==> Existing certificate found — deploying HTTPS vhosts"
  deploy_ssl_vhosts
else
  echo "==> Phase 1: HTTP ACME webroot"
  deploy_acme_http

  if ! command -v certbot >/dev/null 2>&1; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
  fi

  echo "==> Requesting certificate (webroot)"
  certbot certonly --webroot -w /var/www/certbot \
    --cert-name "$CERT_NAME" \
    -d api.nassanitv.com -d admin.nassanitv.com -d nassanitv.com \
    --email "$EMAIL" --agree-tos --non-interactive --no-eff-email

  echo "==> Phase 2: HTTPS vhosts"
  deploy_ssl_vhosts
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable certbot.timer 2>/dev/null || true
  systemctl start certbot.timer 2>/dev/null || true
fi

upsert_env BASE_URL "https://api.nassanitv.com"
upsert_env STREAM_API_BASE_URL "https://api.nassanitv.com"
upsert_env ADMIN_PUBLIC_URL "https://admin.nassanitv.com"
upsert_env NOTIFICATION_IMAGE_PUBLIC_ORIGIN "https://api.nassanitv.com"
upsert_env INSTRUCTION_VIDEO_PUBLIC_ORIGIN "https://api.nassanitv.com"

export NASSANI_ADMIN_ROOT="$ROOT"
pm2 restart nassani-admin-api --update-env || pm2 start "$ROOT/deploy/contabo/ecosystem.config.cjs"
pm2 save

echo "==> SSL complete"
curl -fsSI "https://api.nassanitv.com/api/health" | head -5 || true
curl -fsSI "https://admin.nassanitv.com/" | head -5 || true
