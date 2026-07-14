#!/usr/bin/env bash
# Bootstrap a brand-new Ubuntu Contabo VPS for Nassani TV (Admin + API + PostgreSQL).
# Clone source: sokalive/nassani-admin ONLY — never Osmani.
#
# Usage (as root on the VPS):
#   export NASSANI_VPS_IP='YOUR.VPS.IP'
#   export NASSANI_ROOT_DOMAIN='nassanitv.com'          # optional until DNS ready
#   export NASSANI_API_DOMAIN='api.nassanitv.com'       # optional
#   export NASSANI_ADMIN_DOMAIN='admin.nassanitv.com'   # optional
#   export CERTBOT_EMAIL='admin@nassanitv.com'          # optional
#   export BUNNY_CDN_BASE_URL='https://YOUR.b-cdn.net'  # optional for thumbs
#   bash bootstrap-nassani-vps.sh
#
# Video HLS (.m3u8/.ts) must stay on CDN/storage — this VPS stores metadata only.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

NASSANI_ROOT="${NASSANI_ROOT:-/var/www/nassani-admin}"
NASSANI_REPO_URL="${NASSANI_REPO_URL:-https://github.com/sokalive/nassani-admin.git}"
NASSANI_BRANCH="${NASSANI_BRANCH:-main}"
NASSANI_VPS_IP="${NASSANI_VPS_IP:-}"
NASSANI_ROOT_DOMAIN="${NASSANI_ROOT_DOMAIN:-nassanitv.com}"
NASSANI_API_DOMAIN="${NASSANI_API_DOMAIN:-api.${NASSANI_ROOT_DOMAIN}}"
NASSANI_ADMIN_DOMAIN="${NASSANI_ADMIN_DOMAIN:-admin.${NASSANI_ROOT_DOMAIN}}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@${NASSANI_ROOT_DOMAIN}}"
API_PORT="${API_PORT:-10001}"
PG_DB="${PG_DB:-nassani_db}"
PG_USER="${PG_USER:-nassani}"
BUNNY_CDN_BASE_URL="${BUNNY_CDN_BASE_URL:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root" >&2
  exit 1
fi

if [[ -z "${NASSANI_VPS_IP}" ]]; then
  NASSANI_VPS_IP="$(curl -4 -fsS --max-time 8 ifconfig.me 2>/dev/null || true)"
fi
if [[ -z "${NASSANI_VPS_IP}" ]]; then
  NASSANI_VPS_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
echo "==> Nassani VPS bootstrap"
echo "    root=$NASSANI_ROOT ip=${NASSANI_VPS_IP:-unknown}"
echo "    domains: $NASSANI_API_DOMAIN / $NASSANI_ADMIN_DOMAIN / $NASSANI_ROOT_DOMAIN"
echo "    repo=$NASSANI_REPO_URL ($NASSANI_BRANCH)"

# Refuse Osmani repos
case "$NASSANI_REPO_URL" in
  *osmani*) echo "ERROR: refusing Osmani repository URL: $NASSANI_REPO_URL" >&2; exit 1 ;;
  *nassani-admin*) ;;
  *) echo "ERROR: repo must be sokalive/nassani-admin (got: $NASSANI_REPO_URL)" >&2; exit 1 ;;
esac

echo "==> SECTION A: apt packages"
apt-get update -y
apt-get install -y \
  ca-certificates curl gnupg lsb-release software-properties-common \
  git build-essential ufw fail2ban nginx certbot python3-certbot-nginx \
  postgresql postgresql-contrib \
  logrotate unzip jq

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE 'v(20|22|24)\.'; then
  echo "==> Installing Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2
pm2 startup systemd -u root --hp /root >/dev/null || true

echo "==> SECTION A: UFW + Fail2Ban"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban
systemctl enable --now nginx
systemctl enable --now postgresql

echo "==> SECTION C: PostgreSQL ($PG_DB / $PG_USER)"
PG_PASS="${PG_PASS:-$(openssl rand -hex 24)}"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PG_USER}') THEN
    CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASS}';
  ELSE
    ALTER ROLE ${PG_USER} WITH PASSWORD '${PG_PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE ${PG_DB} OWNER ${PG_USER}'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PG_DB}')\gexec
GRANT ALL PRIVILEGES ON DATABASE ${PG_DB} TO ${PG_USER};
SQL
sudo -u postgres psql -d "$PG_DB" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL ON SCHEMA public TO ${PG_USER};
ALTER SCHEMA public OWNER TO ${PG_USER};
SQL

mkdir -p /var/backups/nassani-pg
cat >/usr/local/bin/nassani-pg-backup.sh <<'BACKUP'
#!/usr/bin/env bash
set -euo pipefail
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="/var/backups/nassani-pg/nassani_db_${STAMP}.sql.gz"
sudo -u postgres pg_dump nassani_db | gzip -c > "$OUT"
find /var/backups/nassani-pg -type f -name 'nassani_db_*.sql.gz' -mtime +14 -delete
BACKUP
chmod 750 /usr/local/bin/nassani-pg-backup.sh
cat >/etc/cron.d/nassani-pg-backup <<'CRON'
15 3 * * * root /usr/local/bin/nassani-pg-backup.sh >/var/log/nassani-pg-backup.log 2>&1
CRON

echo "==> SECTION B: clone nassani-admin"
mkdir -p "$(dirname "$NASSANI_ROOT")"
if [[ -d "$NASSANI_ROOT/.git" ]]; then
  git -C "$NASSANI_ROOT" remote -v | grep -qi 'nassani-admin' || {
    echo "ERROR: existing checkout is not nassani-admin" >&2
    exit 1
  }
  git -C "$NASSANI_ROOT" fetch origin
  git -C "$NASSANI_ROOT" checkout "$NASSANI_BRANCH"
  git -C "$NASSANI_ROOT" reset --hard "origin/$NASSANI_BRANCH"
else
  rm -rf "$NASSANI_ROOT"
  git clone --branch "$NASSANI_BRANCH" "$NASSANI_REPO_URL" "$NASSANI_ROOT"
fi
# Hard assert remote
git -C "$NASSANI_ROOT" remote get-url origin | grep -qi 'nassani-admin' || {
  echo "ERROR: origin is not nassani-admin" >&2
  exit 1
}

echo "==> SECTION C: production secrets + env"
API_DIR="$NASSANI_ROOT/server"
UPLOAD_DIR="$API_DIR/uploads"
mkdir -p "$UPLOAD_DIR"
chmod 755 "$UPLOAD_DIR"

ADMIN_API_TOKEN="${ADMIN_API_TOKEN:-$(openssl rand -hex 24)}"
ADMIN_JWT_SECRET="${ADMIN_JWT_SECRET:-$(openssl rand -hex 48)}"
ADMIN_DEVICE_FP_SALT="${ADMIN_DEVICE_FP_SALT:-nassani-fp-v1}"
ADMIN_OTP_HASH_SALT="${ADMIN_OTP_HASH_SALT:-nassani-otp-v1}"
DIRECT_STREAM_SIGNING_SECRET="${DIRECT_STREAM_SIGNING_SECRET:-$(openssl rand -hex 32)}"
DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:5432/${PG_DB}"

PUBLIC_API_BASE="http://${NASSANI_VPS_IP}"
PUBLIC_ADMIN_BASE="http://${NASSANI_VPS_IP}"
if [[ -f "/etc/letsencrypt/live/${NASSANI_ROOT_DOMAIN}/fullchain.pem" ]]; then
  PUBLIC_API_BASE="https://${NASSANI_API_DOMAIN}"
  PUBLIC_ADMIN_BASE="https://${NASSANI_ADMIN_DOMAIN}"
fi

ENV_FILE="$API_DIR/.env"
umask 077
cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=${API_PORT}
NASSANI_VPS=1
NASSANI_LOAD_CUTOVER_ENV=1
NASSANI_ADMIN_ROOT=${NASSANI_ROOT}

DATABASE_URL=${DATABASE_URL}
PG_POOL_MAX=30
PG_POOL_STATS=1

BASE_URL=${PUBLIC_API_BASE}
STREAM_API_BASE_URL=${PUBLIC_API_BASE}
ADMIN_PUBLIC_URL=${PUBLIC_ADMIN_BASE}
BUNNY_CDN_BASE_URL=${BUNNY_CDN_BASE_URL}
ASSET_LEGACY_ORIGIN_HOSTS=${NASSANI_VPS_IP},${NASSANI_API_DOMAIN},${NASSANI_ADMIN_DOMAIN}

UPLOAD_DIR=${UPLOAD_DIR}
NOTIFICATION_IMAGE_PUBLIC_ORIGIN=${PUBLIC_API_BASE}
INSTRUCTION_VIDEO_PUBLIC_ORIGIN=${PUBLIC_API_BASE}
BEEM_SENDER_NAME=NASSANITVMAX

ADMIN_API_TOKEN=${ADMIN_API_TOKEN}
APP_UPDATE_ADMIN_TOKEN=${ADMIN_API_TOKEN}
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}
ADMIN_PANEL_AUTH_REQUIRED=false
ADMIN_DEVICE_FP_SALT=${ADMIN_DEVICE_FP_SALT}
ADMIN_OTP_HASH_SALT=${ADMIN_OTP_HASH_SALT}
DIRECT_STREAM_SIGNING_SECRET=${DIRECT_STREAM_SIGNING_SECRET}

# Metadata + auth/subscription on VPS; HLS media stays on CDN/storage URLs in channel rows.
STREAM_DELIVERY_MODE=direct
DIRECT_STREAM_SIGNING_ENABLED=0
STREAM_PLAYBACK_FORCE_PROXY=0
DIRECT_STREAM_CUTOVER_ENABLED=1
DIRECT_STREAM_ROLLOUT_PERCENT=100
EOF
chmod 600 "$ENV_FILE"

# Non-secret cutover defaults (git-tracked style mirror for PM2)
cat >"$API_DIR/.env.cutover" <<EOF
NODE_ENV=production
PORT=${API_PORT}
BASE_URL=${PUBLIC_API_BASE}
STREAM_API_BASE_URL=${PUBLIC_API_BASE}
ADMIN_PUBLIC_URL=${PUBLIC_ADMIN_BASE}
BUNNY_CDN_BASE_URL=${BUNNY_CDN_BASE_URL}
ASSET_LEGACY_ORIGIN_HOSTS=${NASSANI_VPS_IP},${NASSANI_API_DOMAIN},${NASSANI_ADMIN_DOMAIN}
UPLOAD_DIR=${UPLOAD_DIR}
NOTIFICATION_IMAGE_PUBLIC_ORIGIN=${PUBLIC_API_BASE}
INSTRUCTION_VIDEO_PUBLIC_ORIGIN=${PUBLIC_API_BASE}
BEEM_SENDER_NAME=NASSANITVMAX
STREAM_DELIVERY_MODE=direct
STREAM_PLAYBACK_FORCE_PROXY=0
DIRECT_STREAM_CUTOVER_ENABLED=1
DIRECT_STREAM_ROLLOUT_PERCENT=100
EOF

echo "==> SECTION E: build admin + install API deps"
cd "$NASSANI_ROOT"
# SPA talks same-origin /api via nginx
VITE_API_BASE_URL= npm ci
VITE_API_BASE_URL= npm run build
# nginx www-data must read SPA assets
chmod -R a+rX "$NASSANI_ROOT/dist"
cd "$API_DIR"
npm ci --omit=dev

echo "==> SECTION C/E: Nginx + PM2"
install -d /etc/nginx/snippets
install -m 644 "$NASSANI_ROOT/deploy/contabo/nginx/snippets/nassani-node-api.conf" /etc/nginx/snippets/nassani-node-api.conf
install -m 644 "$NASSANI_ROOT/deploy/contabo/nginx/snippets/ssl-params.conf" /etc/nginx/snippets/nassani-ssl-params.conf
# IP HTTP site until DNS/SSL
sed "s/__NASSANI_VPS_IP__/${NASSANI_VPS_IP}/g" \
  "$NASSANI_ROOT/deploy/contabo/nginx-nassani-admin.conf" \
  >/etc/nginx/sites-available/nassani-admin
ln -sfn /etc/nginx/sites-available/nassani-admin /etc/nginx/sites-enabled/nassani-admin
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

export NASSANI_ADMIN_ROOT="$NASSANI_ROOT"
export NASSANI_LOAD_CUTOVER_ENV=1
cd "$NASSANI_ROOT"
pm2 delete nassani-admin-api 2>/dev/null || true
pm2 start "$NASSANI_ROOT/deploy/contabo/ecosystem.config.cjs"
pm2 save

# Logrotate for PM2
pm2 install pm2-logrotate >/dev/null 2>&1 || true
pm2 set pm2-logrotate:max_size 50M >/dev/null 2>&1 || true
pm2 set pm2-logrotate:retain 10 >/dev/null 2>&1 || true
pm2 set pm2-logrotate:compress true >/dev/null 2>&1 || true

echo "==> SECTION C: optional SSL (requires DNS A records)"
if command -v dig >/dev/null 2>&1; then
  API_RESOLVED="$(dig +short "$NASSANI_API_DOMAIN" A | head -1 || true)"
else
  API_RESOLVED=""
fi
if [[ -n "$API_RESOLVED" && "$API_RESOLVED" == "$NASSANI_VPS_IP" ]]; then
  echo "    DNS matches — requesting Let's Encrypt"
  bash "$NASSANI_ROOT/deploy/contabo/setup-nassanitv-ssl.sh" || true
else
  echo "    DNS not pointed yet — serving HTTP on ${NASSANI_VPS_IP}"
  echo "    After DNS: bash $NASSANI_ROOT/deploy/contabo/setup-nassanitv-ssl.sh"
fi

echo "==> SECTION G: health checks"
sleep 2
curl -fsS "http://127.0.0.1:${API_PORT}/api/health" | head -c 400 || true
echo
curl -fsS "http://127.0.0.1/api/health" | head -c 200 || true
echo
pm2 status

cat >/root/nassani-bootstrap-credentials.txt <<EOF
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) — keep private (chmod 600)
NASSANI_VPS_IP=${NASSANI_VPS_IP}
DATABASE_URL=${DATABASE_URL}
PG_USER=${PG_USER}
PG_DB=${PG_DB}
PG_PASS=${PG_PASS}
ADMIN_API_TOKEN=${ADMIN_API_TOKEN}
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}
PUBLIC_API_BASE=${PUBLIC_API_BASE}
PUBLIC_ADMIN_BASE=${PUBLIC_ADMIN_BASE}
EOF
chmod 600 /root/nassani-bootstrap-credentials.txt

echo
echo "==> BOOTSTRAP COMPLETE"
echo "    Admin (HTTP): http://${NASSANI_VPS_IP}/"
echo "    API health:   http://${NASSANI_VPS_IP}/api/health"
echo "    Credentials:  /root/nassani-bootstrap-credentials.txt"
echo "    Video HLS remains on CDN — VPS holds metadata only."
