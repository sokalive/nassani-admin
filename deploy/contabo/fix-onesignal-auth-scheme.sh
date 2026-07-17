#!/usr/bin/env bash
# Set Nassani OneSignal auth scheme to Key (rich API keys) and retest.
set -euo pipefail
ENVF=/var/www/nassani-admin/server/.env
ROOT=/var/www/nassani-admin

ORIGIN=$(git -C "$ROOT" remote get-url origin)
case "$ORIGIN" in
  *nassani-admin*) ;;
  *) echo "refusing non-nassani remote"; exit 1 ;;
esac

if grep -qE '^ONESIGNAL_AUTH_SCHEME=' "$ENVF"; then
  awk 'BEGIN{FS=OFS="="} $1=="ONESIGNAL_AUTH_SCHEME"{$0="ONESIGNAL_AUTH_SCHEME=key"} {print}' "$ENVF" >"$ENVF.tmp"
  mv "$ENVF.tmp" "$ENVF"
else
  echo 'ONESIGNAL_AUTH_SCHEME=key' >>"$ENVF"
fi
grep -E '^ONESIGNAL_AUTH_SCHEME=' "$ENVF"

cd "$ROOT/server"
pm2 restart nassani-admin-api --update-env
sleep 3
python3 /tmp/diagnose-onesignal-send.py
