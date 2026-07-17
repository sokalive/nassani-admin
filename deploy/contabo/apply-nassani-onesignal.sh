#!/usr/bin/env bash
# Configure Nassani OneSignal credentials on VPS ONLY (never commit secrets).
# Credentials from Nassani OneSignal app (nassantv) Keys & IDs screenshot.
set -euo pipefail

ROOT=/var/www/nassani-admin
ENVF=$ROOT/server/.env

ONESIGNAL_APP_ID="${ONESIGNAL_APP_ID:?ONESIGNAL_APP_ID required}"
ONESIGNAL_REST_API_KEY="${ONESIGNAL_REST_API_KEY:?ONESIGNAL_REST_API_KEY required}"

[[ "$(id -u)" -eq 0 ]] || { echo "run as root"; exit 1; }
[[ -f "$ENVF" ]] || { echo "missing $ENVF"; exit 1; }

ORIGIN=$(git -C "$ROOT" remote get-url origin)
case "$ORIGIN" in
  *nassani-admin*) ;;
  *osmani*) echo "refusing Osmani remote"; exit 1 ;;
  *) echo "unexpected origin: $ORIGIN"; exit 1 ;;
esac

upsert() {
  local key="$1" val="$2" tmp
  tmp=$(mktemp)
  if grep -qE "^${key}=" "$ENVF"; then
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "$ENVF" >"$tmp"
    mv "$tmp" "$ENVF"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENVF"
  fi
}

echo "==> Configure Nassani OneSignal (VPS env only)"
upsert ONESIGNAL_APP_ID "$ONESIGNAL_APP_ID"
upsert ONESIGNAL_REST_API_KEY "$ONESIGNAL_REST_API_KEY"
upsert NOTIFICATION_IMAGE_PUBLIC_ORIGIN "https://api.nassanitv.online"
upsert NOTIFICATION_IMAGE_STORAGE "local"
upsert NASSANI_VPS "1"
upsert UPLOADS_SERVE_FROM_ORIGIN "1"
upsert NASSANI_GIT_COMMIT "$(git -C "$ROOT" rev-parse HEAD)"

echo "==> Restart nassani-admin-api only"
cd "$ROOT/server"
pm2 restart nassani-admin-api --update-env
sleep 3

echo "==> Confirm (no secret values)"
grep -E '^(ONESIGNAL_APP_ID|NOTIFICATION_IMAGE_PUBLIC_ORIGIN|NOTIFICATION_IMAGE_STORAGE)=' "$ENVF"
grep -E '^ONESIGNAL_REST_API_KEY=' "$ENVF" | sed 's/=.*$/=SET/'

curl -fsS http://127.0.0.1:10001/api/health | python3 -c 'import sys,json; j=json.load(sys.stdin); print("health ok", j.get("service"), j.get("commit"))'
