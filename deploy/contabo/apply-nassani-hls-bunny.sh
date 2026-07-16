#!/usr/bin/env bash
# Configure Nassani Bunny ONLY for HLS streaming (nassanitv.b-cdn.net).
# Static /uploads/* stay on https://api.nassanitv.online — never rewritten to Bunny.
# Nassani VPS only. Never touches Osmani.
set -euo pipefail

ROOT=/var/www/nassani-admin
ENVF=$ROOT/server/.env
STREAM_CDN='https://nassanitv.b-cdn.net'

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

echo "==> Nassani HLS-only Bunny CDN"
echo "    stream_cdn=$STREAM_CDN"
echo "    static uploads remain on api.nassanitv.online"

# CRITICAL: empty static CDN base — do not rewrite /uploads to Bunny
upsert BUNNY_CDN_BASE_URL ""
# Remove legacy shared Osmani hostname from static CDN if present as BUNNY_CDN_URL
upsert BUNNY_CDN_URL ""

# Stream-only CDN
upsert BUNNY_STREAM_CDN_BASE_URL "$STREAM_CDN"
upsert BUNNY_STREAM_SEGMENT_PATH "hls/seg"
upsert BUNNY_SEGMENT_CACHE_MAX_AGE_SEC "86400"
upsert STREAM_SEGMENT_DELIVERY "bunny"
upsert STREAM_SEGMENT_FORCE_PROXY "0"
upsert STREAM_SEGMENT_SELECTIVE_ROUTING "1"
upsert STREAM_SEGMENT_ROLLOUT_PERCENT "100"
upsert STREAM_SEGMENT_ROLLOUT_SALT "nassani-seg-v1"

# Explicit: all /uploads on VPS origin
upsert UPLOADS_SERVE_FROM_ORIGIN "1"
upsert NASSANI_VPS "1"

# Keep signing / canary playback as already configured
upsert DIRECT_STREAM_SIGNING_ENABLED "1"
upsert STREAM_DELIVERY_MODE "direct"
upsert STREAM_PLAYBACK_FORCE_PROXY "0"
upsert DIRECT_STREAM_CUTOVER_ENABLED "1"
# allowlist HLS canaries; HTML player stays upstream
if ! grep -qE '^DIRECT_STREAM_ROLLOUT_CHANNEL_IDS=.+' "$ENVF"; then
  upsert DIRECT_STREAM_ROLLOUT_CHANNEL_IDS "3,4,5"
fi
upsert DIRECT_STREAM_ROLLOUT_PERCENT "0"

upsert NASSANI_GIT_COMMIT "$(git -C "$ROOT" rev-parse HEAD)"

echo "==> Restart nassani-admin-api only"
cd "$ROOT/server"
pm2 restart nassani-admin-api --update-env
sleep 3

echo "==> Env confirm"
grep -E '^(BUNNY_CDN_BASE_URL|BUNNY_STREAM_CDN_BASE_URL|STREAM_SEGMENT_DELIVERY|UPLOADS_SERVE_FROM_ORIGIN)=' "$ENVF" || true

curl -fsS http://127.0.0.1:10001/api/health
echo
curl -fsS http://127.0.0.1:10001/api/health/stream-delivery | python3 -c 'import sys,json;j=json.load(sys.stdin);s=j.get("segments")or{};print(json.dumps({"signing":j.get("signing_configured"),"seg":s.get("stream_segment_delivery"),"bunny":s.get("bunny_stream_cdn_base"),"offload":s.get("production_segment_offload_active")},indent=2))'
