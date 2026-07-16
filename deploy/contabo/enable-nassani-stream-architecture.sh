#!/usr/bin/env bash
# Enable Nassani streaming architecture on the Nassani Contabo VPS ONLY.
# Mirrors the Osmani control-plane design using Nassani-owned infra:
#   HMAC stream-direct → manifest rewrite → Bunny /hls/seg (or stream-proxy fallback)
#
# NEVER touches Osmani. NEVER reuses Osmani secrets or Bunny zones.
#
# Usage (as root on 169.58.18.86):
#   bash deploy/contabo/enable-nassani-stream-architecture.sh
#
# Optional:
#   BUNNY_API_KEY=...           # Nassani Bunny account — creates/reuses nassani-stream pull zone
#   BUNNY_CDN_BASE_URL=https://….b-cdn.net   # skip create; use existing Nassani zone
#   STREAM_CANARY_CHANNEL_IDS=3,4,5          # HLS canaries (default). Non-HLS stays upstream.
#   ROTATE_STREAM_SECRETS=1                  # force new DIRECT_STREAM_SIGNING_SECRET (default 1)
#
set -euo pipefail

ROOT="${NASSANI_ADMIN_ROOT:-/var/www/nassani-admin}"
ENVF="$ROOT/server/.env"
API_DIR="$ROOT/server"
CANARY_IDS="${STREAM_CANARY_CHANNEL_IDS:-3,4,5}"
ROTATE_STREAM_SECRETS="${ROTATE_STREAM_SECRETS:-1}"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "run as root on Nassani VPS"
[[ -d "$ROOT/.git" ]] || die "missing $ROOT"
[[ -f "$ENVF" ]] || die "missing $ENVF"

ORIGIN="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
case "$ORIGIN" in
  *nassani-admin*) ;;
  *osmani*) die "refusing Osmani remote: $ORIGIN" ;;
  *) die "origin must be sokalive/nassani-admin (got: $ORIGIN)" ;;
esac

# Refuse if an Osmani PM2 app is somehow present on this host
if pm2 jlist 2>/dev/null | grep -qi osmani; then
  die "Osmani PM2 process detected — aborting (Nassani-only host required)"
fi

upsert_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENVF"; then
    # portable in-place replace
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "$ENVF" >"$tmp"
    mv "$tmp" "$ENVF"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENVF"
  fi
}

ensure_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENVF"; then
    local cur
    cur="$(grep -E "^${key}=" "$ENVF" | head -1 | cut -d= -f2-)"
    if [[ -z "$cur" ]]; then
      upsert_env "$key" "$val"
    fi
  else
    upsert_env "$key" "$val"
  fi
}

echo "==> Nassani stream architecture enablement"
echo "    root=$ROOT"
echo "    commit=$(git -C "$ROOT" rev-parse HEAD)"
echo "    canary_channels=$CANARY_IDS"

# --- Secrets (Nassani-generated only) ---
if [[ "$ROTATE_STREAM_SECRETS" == "1" ]] || ! grep -qE '^DIRECT_STREAM_SIGNING_SECRET=.+' "$ENVF"; then
  NEW_SIGN="$(openssl rand -hex 32)"
  upsert_env DIRECT_STREAM_SIGNING_SECRET "$NEW_SIGN"
  echo "    rotated DIRECT_STREAM_SIGNING_SECRET (len=${#NEW_SIGN})"
else
  echo "    keeping existing DIRECT_STREAM_SIGNING_SECRET"
fi

# --- Core stream control plane (App-compatible) ---
# mode=direct: non-allowlisted channels keep upstream CDN/HTML player URLs (no APK break).
# allowlisted HLS canaries get signed /stream-direct playbackUrl.
upsert_env STREAM_DELIVERY_MODE "direct"
upsert_env DIRECT_STREAM_SIGNING_ENABLED "1"
upsert_env STREAM_PLAYBACK_FORCE_PROXY "0"
upsert_env DIRECT_STREAM_CUTOVER_ENABLED "1"
upsert_env DIRECT_STREAM_ROLLOUT_PERCENT "0"
upsert_env DIRECT_STREAM_ROLLOUT_CHANNEL_IDS "$CANARY_IDS"
upsert_env DIRECT_STREAM_TOKEN_TTL_SEC "120"
upsert_env STREAM_SEGMENT_TOKEN_TTL_SEC "600"
upsert_env STREAM_SEGMENT_SELECTIVE_ROUTING "1"
upsert_env STREAM_SEGMENT_FORCE_PROXY "0"
upsert_env STREAM_SEGMENT_ROLLOUT_PERCENT "100"
upsert_env STREAM_SEGMENT_ROLLOUT_SALT "nassani-seg-v1"
upsert_env BUNNY_STREAM_SEGMENT_PATH "hls/seg"
upsert_env BUNNY_SEGMENT_CACHE_MAX_AGE_SEC "86400"
ensure_env STREAM_API_BASE_URL "https://api.nassanitv.online"
ensure_env BASE_URL "https://api.nassanitv.online"
ensure_env DIRECT_STREAM_ROLLOUT_SALT "nassani-stream-rollout-v1"

CDN_BASE="${BUNNY_CDN_BASE_URL:-}"
ZONE_ID=""

if [[ -n "${BUNNY_API_KEY:-}" ]]; then
  echo "==> Provisioning Nassani Bunny Pull Zone via API"
  PROVISION_JSON="$(
    cd "$ROOT"
    BUNNY_API_KEY="$BUNNY_API_KEY" \
    BUNNY_PULL_ZONE_NAME="${BUNNY_PULL_ZONE_NAME:-nassani-stream}" \
    BUNNY_ORIGIN_URL="${BUNNY_ORIGIN_URL:-https://api.nassanitv.online}" \
    node deploy/contabo/provision-nassani-bunny-pullzone.mjs
  )"
  CDN_BASE="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.cdn_base_url||"")' "$PROVISION_JSON")"
  ZONE_ID="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(String(j.pull_zone_id||""))' "$PROVISION_JSON")"
  echo "    bunny_cdn=$CDN_BASE zone_id=$ZONE_ID"
  # Persist provision summary without secrets dump in git
  umask 077
  printf '%s\n' "$PROVISION_JSON" > /root/nassani-bunny-pullzone.json
  echo "    wrote /root/nassani-bunny-pullzone.json"
elif [[ -n "$CDN_BASE" ]]; then
  echo "==> Using provided BUNNY_CDN_BASE_URL=$CDN_BASE"
else
  # Reuse empty-or-set env if already present
  CDN_BASE="$(grep -E '^BUNNY_CDN_BASE_URL=' "$ENVF" | head -1 | cut -d= -f2- || true)"
  STREAM_CDN="$(grep -E '^BUNNY_STREAM_CDN_BASE_URL=' "$ENVF" | head -1 | cut -d= -f2- || true)"
  if [[ -n "$STREAM_CDN" ]]; then CDN_BASE="$STREAM_CDN"; fi
fi

if [[ -n "$CDN_BASE" ]]; then
  # Reject accidental Osmani hostnames
  case "$CDN_BASE" in
    *osmani*) die "refusing Osmani Bunny hostname: $CDN_BASE" ;;
  esac
  upsert_env BUNNY_CDN_BASE_URL "$CDN_BASE"
  upsert_env BUNNY_STREAM_CDN_BASE_URL "$CDN_BASE"
  [[ -n "$ZONE_ID" ]] && upsert_env BUNNY_PULL_ZONE_ID "$ZONE_ID"
  upsert_env STREAM_SEGMENT_DELIVERY "bunny"
  echo "    segment_delivery=bunny"
else
  upsert_env STREAM_SEGMENT_DELIVERY "proxy"
  echo "    WARN: No Nassani Bunny CDN configured — STREAM_SEGMENT_DELIVERY=proxy"
  echo "    Provide BUNNY_API_KEY (Nassani account) or BUNNY_CDN_BASE_URL and re-run."
fi

# Do NOT set BUNNY_PULL_ORIGIN_SECRET unless edge rule is confirmed
# (empty secret = origin auth disabled; safe for first bring-up)

echo "==> Restart nassani-admin-api only"
cd "$API_DIR"
pm2 restart nassani-admin-api --update-env
sleep 2
pm2 list | grep -i nassani || true

echo "==> Health checks"
curl -fsS http://127.0.0.1:10001/api/health | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d); if(!j.ok) process.exit(1); console.log("health ok commit="+j.commit);})'
curl -fsS http://127.0.0.1:10001/api/health/stream-delivery | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d); console.log(JSON.stringify({ok:j.ok,mode:j.stream_delivery_mode,signing:j.signing_configured,cutover:j.production_cutover_active,seg:j.segments&&j.segments.stream_segment_delivery,bunny:j.segments&&j.segments.bunny_stream_cdn_base,offload:j.segments&&j.segments.production_segment_offload_active,origin:j.routes&&j.routes.bunny_segment_origin},null,2)); if(!j.signing_configured) process.exit(1);})'

echo "==> Done"
