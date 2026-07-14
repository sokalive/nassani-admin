#!/usr/bin/env bash
# Provision Let's Encrypt TLS for nassanitv.online branded hosts on Contabo VPS.
#
# Prerequisites:
#   A records → VPS IP for api.nassanitv.online, admin.nassanitv.online, nassanitv.online
#
# Usage (on VPS as root):
#   CERTBOT_EMAIL=you@nassanitv.online bash deploy/contabo/setup-nassanitv-ssl.sh
set -euo pipefail

ROOT="${NASSANI_ADMIN_ROOT:-/var/www/nassani-admin}"
EMAIL="${CERTBOT_EMAIL:-admin@nassanitv.online}"
CERT_NAME="nassanitv.online"
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
    -d api.nassanitv.online -d admin.nassanitv.online -d nassanitv.online \
    --email "$EMAIL" --agree-tos --non-interactive --no-eff-email

  echo "==> Phase 2: HTTPS vhosts"
  deploy_ssl_vhosts
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable certbot.timer 2>/dev/null || true
  systemctl start certbot.timer 2>/dev/null || true
fi

upsert_env BASE_URL "https://api.nassanitv.online"
upsert_env STREAM_API_BASE_URL "https://api.nassanitv.online"
upsert_env ADMIN_PUBLIC_URL "https://admin.nassanitv.online"
upsert_env NOTIFICATION_IMAGE_PUBLIC_ORIGIN "https://api.nassanitv.online"
upsert_env INSTRUCTION_VIDEO_PUBLIC_ORIGIN "https://api.nassanitv.online"
upsert_env ASSET_LEGACY_ORIGIN_HOSTS "169.58.18.86,api.nassanitv.online,admin.nassanitv.online,nassanitv.online"

# Also refresh git-tracked cutover defaults when present
CUTOVER="$API_DIR/.env.cutover"
if [[ -f "$CUTOVER" ]]; then
  for pair in \
    "BASE_URL=https://api.nassanitv.online" \
    "STREAM_API_BASE_URL=https://api.nassanitv.online" \
    "ADMIN_PUBLIC_URL=https://admin.nassanitv.online" \
    "NOTIFICATION_IMAGE_PUBLIC_ORIGIN=https://api.nassanitv.online" \
    "INSTRUCTION_VIDEO_PUBLIC_ORIGIN=https://api.nassanitv.online"
  do
    key="${pair%%=*}"
    val="${pair#*=}"
    if grep -q "^${key}=" "$CUTOVER" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$CUTOVER"
    else
      echo "${key}=${val}" >> "$CUTOVER"
    fi
  done
fi

# Ensure landing + admin SPA readable by nginx
chmod -R a+rX "$ROOT/dist" "$ROOT/deploy/contabo/public-nassanitv" 2>/dev/null || true

export NASSANI_ADMIN_ROOT="$ROOT"
export NASSANI_LOAD_CUTOVER_ENV=1
# Reload env from disk via ecosystem (restart --update-env does not re-read .env files)
pm2 delete nassani-admin-api 2>/dev/null || true
pm2 start "$ROOT/deploy/contabo/ecosystem.config.cjs"
pm2 save

echo "==> SSL complete"
sleep 2
curl -fsSI "https://api.nassanitv.online/api/health" | head -8 || true
curl -fsSI "https://admin.nassanitv.online/" | head -8 || true
curl -fsSI "https://nassanitv.online/" | head -8 || true
curl -fsS "https://api.nassanitv.online/api/health" || true
echo
