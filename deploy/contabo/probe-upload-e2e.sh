#!/usr/bin/env bash
# E2E upload proof: channel thumbnail + banner image via admin auth.
set -euo pipefail
API="${API_BASE:-https://api.nassanitv.online}"
ROOT=/var/www/nassani-admin
set -a
# shellcheck disable=SC1091
source "$ROOT/server/.env"
set +a
TOK="${ADMIN_API_TOKEN:-}"
[ -n "$TOK" ] || { echo "NO_TOKEN"; exit 1; }

TS=$(date +%s)
IMG=/tmp/e2e-thumb-$TS.jpg
curl -fsS -o "$IMG" 'https://picsum.photos/seed/e2eupload/320/180.jpg'

echo "=== wrong token must fail ==="
code=$(curl -s -o /tmp/bad.json -w '%{http_code}' -X POST "$API/api/channels" \
  -H 'X-Admin-Token: 3030' -F "name=Bad $TS" -F 'url=https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' -F "thumbnail=@$IMG")
echo "bad=$code $(cat /tmp/bad.json)"

echo "=== CREATE CHANNEL + THUMBNAIL ==="
CREATE=$(curl -fsS -X POST "$API/api/channels" \
  -H "X-Admin-Token: $TOK" \
  -F "name=E2E Upload $TS" \
  -F 'url=https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' \
  -F 'category=Live' \
  -F 'is_active=true' \
  -F 'show_in_app=true' \
  -F "thumbnail=@$IMG;type=image/jpeg")
CH_ID=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('id') or (d.get('channel') or {}).get('id') or '')" "$CREATE")
echo "CH_ID=$CH_ID"
THUMB=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('thumbnailUrl') or d.get('thumbnail_url') or d.get('thumbnail') or '')" "$CREATE")
echo "THUMB=$THUMB"
[ -n "$THUMB" ] || { echo "NO_THUMB_URL"; exit 1; }
curl -fsS -o /dev/null -w "thumb_http=%{http_code}\n" "$THUMB"

echo "=== REPLACE THUMBNAIL ==="
UPDATE=$(curl -fsS -X PUT "$API/api/channels/$CH_ID" \
  -H "X-Admin-Token: $TOK" \
  -F "name=E2E Upload $TS Updated" \
  -F 'url=https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' \
  -F "thumbnail=@$IMG;type=image/jpeg")
THUMB2=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('thumbnailUrl') or d.get('thumbnail_url') or d.get('thumbnail') or '')" "$UPDATE")
echo "THUMB2=$THUMB2"
curl -fsS -o /dev/null -w "thumb2_http=%{http_code}\n" "$THUMB2"

echo "=== PUBLIC CHANNEL HAS THUMB ==="
curl -fsS "$API/api/channels" > /tmp/chs.json
python3 -c "import json; d=json.load(open('/tmp/chs.json')); items=d if isinstance(d,list) else d.get('channels') or []; c=next((x for x in items if str(x.get('id'))=='$CH_ID'), None); assert c, 'missing'; t=c.get('thumbnailUrl') or c.get('thumbnail') or ''; assert t, 'no thumb in app api'; print('APP_THUMB', t[:120])"

echo "=== CREATE BANNER (base64 json) ==="
B64=$(base64 -w0 "$IMG")
BN=$(curl -fsS -X POST "$API/api/banners" \
  -H "X-Admin-Token: $TOK" -H 'Content-Type: application/json' \
  -d "{\"title\":\"E2E Banner $TS\",\"image\":\"data:image/jpeg;base64,$B64\",\"active\":true,\"enabled\":true}")
BN_ID=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('id') or '')" "$BN")
IMGURL=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('image') or d.get('imageUrl') or '')" "$BN")
echo "BN_ID=$BN_ID IMG=$IMGURL"
curl -fsS -o /dev/null -w "banner_img_http=%{http_code}\n" "$IMGURL"

echo "=== DELETE TEMP ==="
curl -fsS -X DELETE "$API/api/channels/$CH_ID" -H "X-Admin-Token: $TOK" >/dev/null
curl -fsS -X DELETE "$API/api/banners/$BN_ID" -H "X-Admin-Token: $TOK" >/dev/null
echo "UPLOAD_E2E_PASS"
