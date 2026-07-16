#!/usr/bin/env bash
# Rebuild Admin SPA with production ADMIN_API_TOKEN baked into VITE_ADMIN_API_TOKEN.
set -euo pipefail
ROOT="${NASSANI_ADMIN_ROOT:-/var/www/nassani-admin}"
ENV_FILE="$ROOT/server/.env"
DIST_DIR="$ROOT/dist"

cd "$ROOT"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

ADMIN_TOKEN="$(grep '^ADMIN_API_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  echo "ERROR: ADMIN_API_TOKEN not set in $ENV_FILE" >&2
  exit 1
fi

echo "==> npm ci + build admin (VITE_ADMIN_API_TOKEN from server/.env)"
npm ci
VITE_API_BASE_URL= VITE_ADMIN_API_TOKEN="$ADMIN_TOKEN" npm run build
mkdir -p "$DIST_DIR"
rsync -a --delete dist/ "$DIST_DIR/" 2>/dev/null || cp -a dist/. "$DIST_DIR/"
chmod -R a+rX "$DIST_DIR"
echo "==> Admin dist updated at $DIST_DIR"
# Verify bundle no longer hardcodes 3030 fallback
if grep -q 'X-Admin-Token.*3030' "$DIST_DIR"/assets/*.js 2>/dev/null; then
  echo "WARN: built bundle may still reference 3030" >&2
else
  echo "OK: no hardcoded 3030 token in bundle"
fi
