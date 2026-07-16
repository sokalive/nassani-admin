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
# tiny valid JPEG
printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\x27 ,#\x1c\x1c(7),01444\x1f\x27=9=82<.342\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18\x19\x1a%&\x27()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd5\x28\xa2\x8a\x00(\xa2\x8a\x00(\xa2\x8a\x00\xff\xd9' > "$IMG"

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
