#!/usr/bin/env bash
# Apply shared Bunny CDN base URLs on Nassani VPS ONLY.
# Does NOT change Bunny dashboard, Osmani, or any Osmani infra.
set -euo pipefail

ROOT=/var/www/nassani-admin
ENVF=$ROOT/server/.env
CDN='https://osmanitv.b-cdn.net'

[[ "$(id -u)" -eq 0 ]] || { echo "run as root"; exit 1; }
[[ -f "$ENVF" ]] || { echo "missing $ENVF"; exit 1; }

ORIGIN=$(git -C "$ROOT" remote get-url origin)
case "$ORIGIN" in
  *nassani-admin*) ;;
  *osmani*) echo "refusing Osmani remote"; exit 1 ;;
  *) echo "unexpected origin: $ORIGIN"; exit 1 ;;
esac

if pm2 jlist 2>/dev/null | grep -qi osmani; then
  echo "Osmani PM2 detected — abort"; exit 1
fi

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

echo "==> Apply Nassani CDN base URLs (shared hostname, Nassani env only)"
upsert BUNNY_CDN_BASE_URL "$CDN"
upsert BUNNY_STREAM_CDN_BASE_URL "$CDN"
upsert BUNNY_STREAM_SEGMENT_PATH "hls/seg"
# Shared pull zone currently origins Osmani API — Nassani HMAC tokens get
# "Invalid signature" on CDN /hls/seg. Keep CDN base URLs configured, but deliver
# segments via stream-proxy until the shared zone can validate Nassani tokens
# (without changing Bunny dashboard / Osmani).
upsert STREAM_SEGMENT_DELIVERY "proxy"
upsert STREAM_SEGMENT_FORCE_PROXY "0"
upsert STREAM_SEGMENT_SELECTIVE_ROUTING "1"
upsert STREAM_SEGMENT_ROLLOUT_PERCENT "100"
# Keep origin auth unset — shared zone must not require Nassani-only header
# Do not set BUNNY_PULL_ORIGIN_SECRET

upsert NASSANI_GIT_COMMIT "$(git -C "$ROOT" rev-parse HEAD)"

echo "==> Restart nassani-admin-api only"
cd "$ROOT/server"
pm2 restart nassani-admin-api --update-env
sleep 3
pm2 list | grep nassani || true

echo "==> Env confirm"
grep -E '^(BUNNY_CDN_BASE_URL|BUNNY_STREAM_CDN_BASE_URL|STREAM_SEGMENT_DELIVERY)=' "$ENVF"

echo "==> Health"
curl -fsS http://127.0.0.1:10001/api/health
echo
curl -fsS http://127.0.0.1:10001/api/health/stream-delivery | python3 -c 'import sys,json;j=json.load(sys.stdin);s=j.get("segments")or{};print(json.dumps({"signing":j.get("signing_configured"),"seg":s.get("stream_segment_delivery"),"bunny":s.get("bunny_stream_cdn_base"),"offload":s.get("production_segment_offload_active")},indent=2))'
