#!/usr/bin/env bash
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
echo "=== UPDATE-CHECK ==="
UC=$(curl -fsS "$API/api/update-check")
echo "$UC"
echo "$UC" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d.get('package_name')=='com.sportstv.tz.app'; assert int(d.get('version_code') or 0)==1; assert str(d.get('version_name'))=='1.0'; print('IDENTITY_OK')"

echo "=== CREATE CHANNEL ==="
CH=$(curl -fsS -X POST "$API/api/channels" \
  -H "X-Admin-Token: $TOK" -H 'Content-Type: application/json' \
  -d "{\"name\":\"TMP E2E $TS\",\"url\":\"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8\",\"is_active\":true,\"show_in_app\":true,\"category\":\"Live\"}")
CH_ID=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print((d.get('channel') or d).get('id') or '')" "$CH")
echo "CH_ID=$CH_ID"
curl -fsS "$API/api/channels" > /tmp/e2e-ch.json
python3 -c "import json; items=json.load(open('/tmp/e2e-ch.json')); items=items if isinstance(items,list) else items.get('channels') or []; assert any(str(c.get('id'))=='$CH_ID' for c in items); print('CHANNEL_APP_FOUND')"

echo "=== CREATE BANNER ==="
BN=$(curl -fsS -X POST "$API/api/banners" \
  -H "X-Admin-Token: $TOK" -H 'Content-Type: application/json' \
  -d "{\"title\":\"TMP Banner $TS\",\"image\":\"https://picsum.photos/seed/tmp$TS/1200/400\",\"active\":true,\"enabled\":true}")
BN_ID=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print((d.get('banner') or d).get('id') or '')" "$BN")
echo "BN_ID=$BN_ID"
curl -fsS "$API/api/banners" > /tmp/e2e-bn.json
python3 -c "import json; items=json.load(open('/tmp/e2e-bn.json')); items=items if isinstance(items,list) else items.get('banners') or []; assert any(str(c.get('id'))=='$BN_ID' for c in items); print('BANNER_APP_FOUND')"

echo "=== CREATE POPUP ==="
curl -fsS -X PUT "$API/api/popup-settings" \
  -H "X-Admin-Token: $TOK" -H 'Content-Type: application/json' \
  -d "{\"enabled\":true,\"title\":\"TMP Popup $TS\",\"message\":\"E2E popup verify $TS\",\"buttonText\":\"OK\",\"button_text\":\"OK\"}" > /tmp/e2e-popup-put.json
curl -fsS "$API/api/popup-settings" > /tmp/e2e-popup.json
python3 -c "import json; d=json.load(open('/tmp/e2e-popup.json')); blob=json.dumps(d); assert '$TS' in blob; print('POPUP_APP_FOUND')"

echo "=== DELETE TEMP ==="
curl -fsS -X DELETE "$API/api/channels/$CH_ID" -H "X-Admin-Token: $TOK" >/dev/null
curl -fsS -X DELETE "$API/api/banners/$BN_ID" -H "X-Admin-Token: $TOK" >/dev/null
curl -fsS -X PUT "$API/api/popup-settings" \
  -H "X-Admin-Token: $TOK" -H 'Content-Type: application/json' \
  -d '{"enabled":false,"title":"","message":"","buttonText":"OK","button_text":"OK"}' >/dev/null
curl -fsS "$API/api/channels" > /tmp/e2e-ch2.json
curl -fsS "$API/api/banners" > /tmp/e2e-bn2.json
python3 -c "import json; chs=json.load(open('/tmp/e2e-ch2.json')); chs=chs if isinstance(chs,list) else chs.get('channels') or []; bns=json.load(open('/tmp/e2e-bn2.json')); bns=bns if isinstance(bns,list) else bns.get('banners') or []; assert all(str(c.get('id'))!='$CH_ID' for c in chs); assert all(str(c.get('id'))!='$BN_ID' for c in bns); print('TEMP_CLEANED')"

echo "=== PUBLIC/ADMIN APIS ==="
for p in /api/health /api/channels /api/banners /api/plans /api/popup-settings /api/update-check /api/runtime/app-update /api/server-health /api/settings/public; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$API$p"); echo "$code $p"
done
for p in /api/transactions /api/users /api/notifications /api/analytics/overview /api/admin/payment-orders /api/admin/subscription-requests /api/settings/zenopay /api/settings/sonicpesa /api/settings/auraxpay /api/whatsapp-settings /api/settings/device-control /api/settings/trial-watch /api/settings/security-suite /api/transfer-codes /api/settings/payment-providers /api/settings/app-update /api/settings/beem; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Admin-Token: $TOK" "$API$p"); echo "$code $p"
done

echo "=== SERVICES ==="
pm2 status | head -20
systemctl is-active nginx
systemctl is-active postgresql
cd "$ROOT" && git rev-parse HEAD && git log -1 --oneline
curl -fsS "$API/api/health"
echo
echo "E2E_PASS"
