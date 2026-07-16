#!/usr/bin/env bash
set -euo pipefail
ROOT=/var/www/nassani-admin
echo "=== IDENTITY ==="
hostname -I | awk '{print $1}'
git -C "$ROOT" remote get-url origin
git -C "$ROOT" rev-parse HEAD
echo "=== PM2 ==="
pm2 status
echo "=== ENV (redacted) ==="
grep -E '^(BASE_URL|STREAM_|ADMIN_PUBLIC|NODE_ENV|PORT|NASSANI_|STREAM_DELIVERY|STREAM_PLAYBACK|BUNNY|ADMIN_API_TOKEN|ADMIN_PANEL|API_CACHE)' "$ROOT/server/.env" | sed 's/ADMIN_API_TOKEN=.*/ADMIN_API_TOKEN=[REDACTED]/' || true
grep -E '^(BASE_URL|STREAM_|ADMIN_PUBLIC|STREAM_DELIVERY)' "$ROOT/server/.env.cutover" || true
echo "=== HEALTH ==="
curl -fsS https://api.nassanitv.online/api/health; echo
curl -fsS https://api.nassanitv.online/api/health/db; echo
echo "=== PUBLIC CATALOG ==="
echo -n "channels_http="; curl -sS -o /tmp/ch.json -w '%{http_code}' https://api.nassanitv.online/api/channels; echo
python3 - <<'PY'
import json
ch=json.load(open('/tmp/ch.json'))
print('channels_count', len(ch) if isinstance(ch,list) else type(ch))
if isinstance(ch,list):
  for c in ch[:10]:
    print(' ch', c.get('id'), c.get('name'), 'url=', (c.get('stream_url') or c.get('url') or '')[:80])
PY
echo -n "banners_http="; curl -sS -o /tmp/bn.json -w '%{http_code}' https://api.nassanitv.online/api/banners; echo
python3 - <<'PY'
import json
bn=json.load(open('/tmp/bn.json'))
print('banners_count', len(bn) if isinstance(bn,list) else bn)
if isinstance(bn,list):
  for b in bn[:10]:
    print(' bn', b.get('id'), b.get('title') or b.get('name'), 'active=', b.get('is_active', b.get('active')))
PY
echo -n "plans_http="; curl -sS -o /tmp/pl.json -w '%{http_code}' https://api.nassanitv.online/api/plans; echo
python3 - <<'PY'
import json
pl=json.load(open('/tmp/pl.json'))
print('plans_count', len(pl) if isinstance(pl,list) else pl)
PY
echo -n "popup_http="; curl -sS -o /tmp/pop.json -w '%{http_code}' https://api.nassanitv.online/api/popup-settings; echo
head -c 300 /tmp/pop.json; echo
echo -n "update_http="; curl -sS -o /tmp/up.json -w '%{http_code}' https://api.nassanitv.online/api/update-check; echo
head -c 300 /tmp/up.json; echo
echo -n "server_health_http="; curl -sS -o /dev/null -w '%{http_code}' https://api.nassanitv.online/api/server-health; echo
echo "=== DB TABLES / COUNTS ==="
sudo -u postgres psql -d nassani_db -c "SELECT 'channels' t, count(*)::int c FROM channels UNION ALL SELECT 'banners', count(*) FROM banners UNION ALL SELECT 'plans', count(*) FROM plans UNION ALL SELECT 'app_settings', count(*) FROM app_settings;"
echo "=== CHANNEL SAMPLE ==="
sudo -u postgres psql -d nassani_db -c "SELECT id, name, LEFT(COALESCE(stream_url,url,''),60) AS stream, is_active FROM channels ORDER BY id LIMIT 10;" 2>/dev/null || sudo -u postgres psql -d nassani_db -c "SELECT column_name FROM information_schema.columns WHERE table_name='channels' ORDER BY ordinal_position;"
echo "=== BANNER SAMPLE ==="
sudo -u postgres psql -d nassani_db -c "SELECT id, title, is_active FROM banners ORDER BY id LIMIT 10;" 2>/dev/null || sudo -u postgres psql -d nassani_db -c "SELECT column_name FROM information_schema.columns WHERE table_name='banners' ORDER BY ordinal_position;"
echo "=== OSMANI GUARD ==="
git -C "$ROOT" remote get-url origin | grep -qi osmani && echo FAIL || echo OK_NO_OSMANI
echo "=== PM2 LOGS (tail) ==="
pm2 logs nassani-admin-api --lines 40 --nostream 2>/dev/null | tail -60
