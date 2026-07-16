#!/usr/bin/env bash
# Full live image verification: API + DB + filesystem + public URL + app catalog sync.
set -euo pipefail
ROOT=/var/www/nassani-admin
set -a
# shellcheck disable=SC1091
source "$ROOT/server/.env"
set +a
API="${API_BASE:-https://api.nassanitv.online}"
TOK="${ADMIN_API_TOKEN:-}"
UP="${UPLOAD_DIR:-$ROOT/server/uploads}"
TS=$(date +%s)
TAG="LIVE VERIFY $TS"
STREAM="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
IMG1=/tmp/live-verify-a-$TS.jpg
IMG2=/tmp/live-verify-b-$TS.jpg
export IMG1 IMG2

python3 - <<'PY'
import os
from pathlib import Path
jpg = bytes([
0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,
0x00,0x01,0x00,0x00,0xFF,0xDB,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,
0x07,0x07,0x07,0x09,0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,
0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,0x24,0x2E,0x27,0x20,
0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,
0x39,0x3D,0x38,0x32,0x3C,0x2E,0x33,0x34,0x32,0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,
0x00,0x01,0x01,0x01,0x11,0x00,0xFF,0xC4,0x00,0x1F,0x00,0x00,0x01,0x05,0x01,0x01,
0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,
0x05,0x06,0x07,0x08,0x09,0x0A,0x0B,0xFF,0xC4,0x00,0xB5,0x10,0x00,0x02,0x01,0x03,
0x03,0x02,0x04,0x03,0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7D,0x01,0x02,0x03,0x00,
0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,
0x81,0x91,0xA1,0x08,0x23,0x42,0xB1,0xC1,0x15,0x52,0xD1,0xF0,0x24,0x33,0x62,0x72,
0x82,0x09,0x0A,0x16,0x17,0x18,0x19,0x1A,0x25,0x26,0x27,0x28,0x29,0x2A,0x34,0x35,
0x36,0x37,0x38,0x39,0x3A,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x53,0x54,0x55,
0x56,0x57,0x58,0x59,0x5A,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6A,0x73,0x74,0x75,
0x76,0x77,0x78,0x79,0x7A,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8A,0x92,0x93,0x94,
0x95,0x96,0x97,0x98,0x99,0x9A,0xA2,0xA3,0xA4,0xA5,0xA6,0xA7,0xA8,0xA9,0xAA,0xB2,
0xB3,0xB4,0xB5,0xB6,0xB7,0xB8,0xB9,0xBA,0xC2,0xC3,0xC4,0xC5,0xC6,0xC7,0xC8,0xC9,
0xCA,0xD2,0xD3,0xD4,0xD5,0xD6,0xD7,0xD8,0xD9,0xDA,0xE1,0xE2,0xE3,0xE4,0xE5,0xE6,
0xE7,0xE8,0xE9,0xEA,0xF1,0xF2,0xF3,0xF4,0xF5,0xF6,0xF7,0xF8,0xF9,0xFA,0xFF,0xDA,
0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,0xFB,0xD5,0x28,0xA2,0x8A,0x00,0x28,0xA2,
0x8A,0x00,0x28,0xA2,0x8A,0x00,0xFF,0xD9])
for p in [os.environ['IMG1'], os.environ['IMG2']]:
    Path(p).write_bytes(jpg)
    print('wrote', p, len(jpg))
PY

basename_from_url() {
  python3 -c "import sys; from urllib.parse import urlparse; print(urlparse(sys.argv[1]).path.rsplit('/',1)[-1])" "$1"
}

check_file() {
  local f="$UP/$1"
  if [[ ! -f "$f" ]]; then echo "MISSING_FILE $f"; exit 1; fi
  local sz
  sz=$(stat -c%s "$f")
  echo "FILE_OK $f bytes=$sz"
}

check_db_channel() {
  local id="$1"
  psql "$DATABASE_URL" -tAc \
    "SELECT id,name,thumbnail,url,category FROM channels WHERE id=$id;" | sed 's/^/DB_CHANNEL=/'
}

check_db_banner() {
  local id="$1"
  psql "$DATABASE_URL" -tAc \
    "SELECT id,title,image FROM banners WHERE id=$id;" | sed 's/^/DB_BANNER=/'
}

check_app_channel() {
  local id="$1"
  curl -fsS "$API/api/channels" > /tmp/app-ch.json
  python3 -c "import json,sys; d=json.load(open('/tmp/app-ch.json')); items=d if isinstance(d,list) else d.get('channels',[]); c=next(x for x in items if str(x.get('id'))==sys.argv[1]); print('APP_CHANNEL', c.get('name'), c.get('thumbnailUrl') or c.get('thumbnail'), c.get('url') or c.get('playbackUrl'), c.get('category'))" "$id"
}

check_app_banner() {
  local id="$1"
  curl -fsS "$API/api/banners" > /tmp/app-bn.json
  python3 -c "import json,sys; d=json.load(open('/tmp/app-bn.json')); items=d if isinstance(d,list) else d.get('banners',[]); b=next(x for x in items if str(x.get('id'))==sys.argv[1]); print('APP_BANNER', b.get('title'), b.get('image') or b.get('imageUrl'))" "$id"
}

echo "=== STEP 2: CREATE CHANNEL + THUMBNAIL ==="
CREATE=$(curl -fsS -X POST "$API/api/channels" \
  -H "X-Admin-Token: $TOK" \
  -F "name=$TAG Channel" \
  -F "url=$STREAM" \
  -F 'category=Sports' \
  -F 'is_active=true' \
  -F 'show_in_app=true' \
  -F "thumbnail=@$IMG1;type=image/jpeg")
echo "$CREATE" | head -c 300; echo
CH_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "$CREATE")
THUMB=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('thumbnailUrl') or d.get('thumbnail') or '')" "$CREATE")
FILE1=$(basename_from_url "$THUMB")
curl -fsS -o /dev/null -w "PUBLIC_THUMB_HTTP=%{http_code}\n" "$THUMB"
check_file "$FILE1"
check_db_channel "$CH_ID"
check_app_channel "$CH_ID"

echo "=== STEP 3: REPLACE THUMBNAIL ==="
UPDATE=$(curl -fsS -X PUT "$API/api/channels/$CH_ID" \
  -H "X-Admin-Token: $TOK" \
  -F "name=$TAG Channel Updated" \
  -F "url=$STREAM" \
  -F 'category=Sports' \
  -F "thumbnail=@$IMG2;type=image/jpeg")
THUMB2=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('thumbnailUrl') or d.get('thumbnail') or '')" "$UPDATE")
FILE2=$(basename_from_url "$THUMB2")
curl -fsS -o /dev/null -w "PUBLIC_THUMB2_HTTP=%{http_code}\n" "$THUMB2"
check_file "$FILE2"
if [[ -f "$UP/$FILE1" ]]; then echo "OLD_FILE_STILL_PRESENT $FILE1"; else echo "OLD_FILE_REMOVED $FILE1"; fi
check_db_channel "$CH_ID"
check_app_channel "$CH_ID"

echo "=== STEP 5: CREATE BANNER ==="
B64=$(base64 -w0 "$IMG1")
BN=$(curl -fsS -X POST "$API/api/banners" \
  -H "X-Admin-Token: $TOK" -H 'Content-Type: application/json' \
  -d "{\"title\":\"$TAG Banner\",\"description\":\"live verify\",\"image\":\"data:image/jpeg;base64,$B64\",\"active\":true,\"enabled\":true,\"isActive\":true,\"isEnabled\":true}")
BN_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['id'])" "$BN")
BIMG=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('image') or d.get('imageUrl') or '')" "$BN")
BFILE=$(basename_from_url "$BIMG")
curl -fsS -o /dev/null -w "PUBLIC_BANNER_HTTP=%{http_code}\n" "$BIMG"
check_file "$BFILE"
check_db_banner "$BN_ID"
check_app_banner "$BN_ID"

echo "=== EDIT BANNER IMAGE ==="
B64B=$(base64 -w0 "$IMG2")
BN2=$(curl -fsS -X PUT "$API/api/banners/$BN_ID" \
  -H "X-Admin-Token: $TOK" -H 'Content-Type: application/json' \
  -d "{\"title\":\"$TAG Banner Updated\",\"description\":\"live verify\",\"image\":\"data:image/jpeg;base64,$B64B\",\"active\":true,\"enabled\":true,\"isActive\":true,\"isEnabled\":true}")
BIMG2=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('image') or d.get('imageUrl') or '')" "$BN2")
BFILE2=$(basename_from_url "$BIMG2")
curl -fsS -o /dev/null -w "PUBLIC_BANNER2_HTTP=%{http_code}\n" "$BIMG2"
check_file "$BFILE2"
check_db_banner "$BN_ID"
check_app_banner "$BN_ID"

echo "=== STEP 9: DELETE FROM ADMIN (app sync) ==="
curl -fsS -X DELETE "$API/api/channels/$CH_ID" -H "X-Admin-Token: $TOK" >/dev/null
curl -fsS -X DELETE "$API/api/banners/$BN_ID" -H "X-Admin-Token: $TOK" >/dev/null
curl -fsS "$API/api/channels" > /tmp/app-ch-after.json
curl -fsS "$API/api/banners" > /tmp/app-bn-after.json
python3 -c "import json; d=json.load(open('/tmp/app-ch-after.json')); items=d if isinstance(d,list) else d.get('channels',[]); assert not any('$TAG' in str(x.get('name','')) for x in items); print('APP_CHANNEL_REMOVED_OK')"
python3 -c "import json; d=json.load(open('/tmp/app-bn-after.json')); items=d if isinstance(d,list) else d.get('banners',[]); assert not any('$TAG' in str(x.get('title','')) for x in items); print('APP_BANNER_REMOVED_OK')"
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM channels WHERE id=$CH_ID;" | awk '{print "DB_CHANNEL_COUNT_AFTER_DELETE="$1}'
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM banners WHERE id=$BN_ID;" | awk '{print "DB_BANNER_COUNT_AFTER_DELETE="$1}'

echo "LIVE_IMAGE_VERIFY_PASS tag=$TAG ch=$CH_ID bn=$BN_ID"
