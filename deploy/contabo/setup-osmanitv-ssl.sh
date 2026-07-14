#!/usr/bin/env bash
# Provision Let's Encrypt TLS for nassanitv.com branded hosts on Contabo VPS.
# Does NOT change Render production — VPS testing domains only.
#
# Prerequisites:
#   A records → 62.171.131.113 for api.nassanitv.com, admin.nassanitv.com, nassanitv.com
#
# Usage (on VPS as root):
#   CERTBOT_EMAIL=you@nassanitv.com bash deploy/contabo/setup-nassanitv-ssl.sh
set -euo pipefail

ROOT="${NASSANI_ADMIN_ROOT:-/var/www/nassani-admin}"
EMAIL="${CERTBOT_EMAIL:-admin@nassanitv.com}"
DOMAINS=(api.nassanitv.com admin.nassanitv.com nassanitv.com)
CERT_NAME="nassanitv.com"
CERT_DIR="/etc/letsencrypt/live/${CERT_NAME}"

echo "==> Nassani TV domain TLS setup"
echo "    root: $ROOT"
echo "    email: $EMAIL"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root on the VPS" >&2
  exit 1
fi

mkdir -p /var/www/certbot
mkdir -p /etc/nginx/snippets

echo "==> Install nginx snippets"
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

if [[ -f "$CERT_DIR/fullchain.pem" ]]; then
  echo "==> Existing certificate found — deploying HTTPS vhosts"
  deploy_ssl_vhosts
else
  echo "==> Phase 1: HTTP ACME webroot"
  deploy_acme_http

  if ! command -v certbot >/dev/null 2>&1; then
    echo "==> Installing certbot"
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

echo "==> Certbot renewal timer"
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable certbot.timer 2>/dev/null || true
  systemctl start certbot.timer 2>/dev/null || true
fi

echo "==> Smoke checks"
for url in \
  "https://api.nassanitv.com/api/health" \
  "https://admin.nassanitv.com/" \
  "https://nassanitv.com/"; do
  if curl -fsS "$url" >/dev/null; then
    echo "    OK $url"
  else
    echo "    WARN failed $url" >&2
  fi
done

echo "Done. Branded HTTPS hosts are live on VPS (Render unchanged)."
