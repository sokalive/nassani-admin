#!/usr/bin/env bash
# Seed Nassani production catalog: 4 CDN-HLS channels + 3 banners + plans.
# Safe to re-run: upserts by name; does not touch Osmani.
set -euo pipefail
ROOT="${NASSANI_ADMIN_ROOT:-/var/www/nassani-admin}"
TOKEN="$(grep '^ADMIN_API_TOKEN=' "$ROOT/server/.env" | head -1 | cut -d= -f2-)"
API="${NASSANI_API_BASE:-https://api.nassanitv.online/api}"
AUTH=(-H "X-Admin-Token: ${TOKEN}" -H "Content-Type: application/json")

echo "==> Seed Nassani catalog via $API"
echo "    token_len=${#TOKEN}"

# Public HLS demo streams (CDN origin — not hosted on VPS)
declare -a CHANNELS=(
  'Nassani Sports|https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8|Sports|Home'
  'Nassani News|https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8|News|Home'
  'Nassani Movies|https://test-streams.mux.dev/test_001/stream.m3u8|Movies|Home'
  'Nassani Kids|https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8|Kids|Home'
)

# Ensure at least 4 working channels
existing="$(curl -fsS "$API/channels")"
python3 - <<'PY' "$existing"
import json,sys
rows=json.loads(sys.argv[1])
print('existing_channels', len(rows))
for r in rows:
  print(' ', r.get('id'), r.get('name'), (r.get('url') or '')[:50])
PY

create_channel() {
  local name="$1" url="$2" category="$3" tab="$4"
  curl -fsS -X POST "$API/channels" "${AUTH[@]}" -d "$(python3 - <<PY
import json
print(json.dumps({
  "name": "$name",
  "url": "$url",
  "category": "$category",
  "bottomTab": "$tab",
  "is_active": True,
  "show_in_app": True,
  "is_live": True,
  "is_hd": True,
  "access_type": "free",
  "player_type": "direct_hls",
}))
PY
)" | python3 -c "import sys,json; d=json.load(sys.stdin); print('created', d.get('id'), d.get('name'), 'playback=', (d.get('playbackUrl') or '')[:80])"
}

# Delete empty VIDEO placeholder and prior SYNC_PROBE junk if present
python3 - <<'PY' > /tmp/nassani-cleanup-ids.json
import json,urllib.request,os
api=os.environ.get('API','')
PY
for id_name in $(curl -fsS "$API/channels" | python3 -c "import sys,json; 
rows=json.load(sys.stdin)
for r in rows:
  n=str(r.get('name') or '')
  u=str(r.get('url') or '').strip()
  if n in ('VIDEO','SYNC_PROBE_CH') or (n=='VIDEO' and not u) or n.startswith('SYNC_PROBE'):
    print(r['id'])
"); do
  echo "cleanup channel id=$id_name"
  curl -fsS -X DELETE "$API/channels/$id_name" "${AUTH[@]}" -o /dev/null -w "delete=%{http_code}\n" || true
done

# Create 4 channels if fewer than 4 remain after cleanup
count=$(curl -fsS "$API/channels" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "channels_after_cleanup=$count"
if [[ "$count" -lt 4 ]]; then
  for row in "${CHANNELS[@]}"; do
    IFS='|' read -r name url category tab <<<"$row"
    # skip if name already exists
    if curl -fsS "$API/channels" | python3 -c "import sys,json; rows=json.load(sys.stdin); raise SystemExit(0 if any(r.get('name')=='$name' for r in rows) else 1)"; then
      echo "skip existing $name"
      continue
    fi
    create_channel "$name" "$url" "$category" "$tab"
  done
fi

# Update first empty-url channel if any remain
curl -fsS "$API/channels" | python3 -c "
import json,sys,urllib.request,os
rows=json.load(sys.stdin)
print('channels_now', len(rows))
for r in rows:
  print(r.get('id'), r.get('name'), 'eff=', r.get('stream_delivery_effective'), 'playback=', (r.get('playbackUrl') or '')[:70])
"

# Banners — need https images
declare -a BANNERS=(
  'Welcome Nassani|Karibu Nassani TV|https://picsum.photos/seed/nassani1/1280/720'
  'Sports Night|Mechi za usiku|https://picsum.photos/seed/nassani2/1280/720'
  'New Season|Msimu mpya|https://picsum.photos/seed/nassani3/1280/720'
)

# cleanup probe banner
for id_name in $(curl -fsS "$API/banners" | python3 -c "import sys,json
rows=json.load(sys.stdin)
for r in rows:
  if str(r.get('title') or '').startswith('SYNC_PROBE'):
    print(r['id'])
" 2>/dev/null || true); do
  curl -fsS -X DELETE "$API/banners/$id_name" "${AUTH[@]}" -o /dev/null || true
done

bn_count=$(curl -fsS "$API/banners" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "banners_now=$bn_count"
if [[ "$bn_count" -lt 3 ]]; then
  for row in "${BANNERS[@]}"; do
    IFS='|' read -r title desc image <<<"$row"
    if curl -fsS "$API/banners" | python3 -c "import sys,json; rows=json.load(sys.stdin); raise SystemExit(0 if any(r.get('title')=='$title' for r in rows) else 1)"; then
      echo "skip banner $title"
      continue
    fi
    curl -fsS -X POST "$API/banners" "${AUTH[@]}" -d "$(python3 - <<PY
import json
print(json.dumps({
  "title": "$title",
  "description": "$desc",
  "image": "$image",
  "active": True,
  "enabled": True,
  "badge": "NEW",
  "badge_enabled": True,
}))
PY
)" | python3 -c "import sys,json; d=json.load(sys.stdin); print('banner', d.get('id'), d.get('title'), d.get('image','')[:60])"
  done
fi

# Plans
pl_count=$(curl -fsS "$API/plans" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "plans_now=$pl_count"
if [[ "$pl_count" -lt 2 ]]; then
  for spec in 'Siku 1|500|1' 'Wiki 1|2500|7' 'Mwezi 1|8000|30'; do
    IFS='|' read -r pname price days <<<"$spec"
    if curl -fsS "$API/plans" | python3 -c "import sys,json; rows=json.load(sys.stdin); raise SystemExit(0 if any(r.get('name')=='$pname' for r in rows) else 1)"; then
      echo "skip plan $pname"
      continue
    fi
    # remove SYNC_PROBE_PLAN
    true
    curl -fsS -X POST "$API/plans" "${AUTH[@]}" -d "{\"name\":\"$pname\",\"price\":$price,\"durationDays\":$days,\"isActive\":true}" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('plan', d.get('id'), d.get('name'), d.get('price'))"
  done
fi
# delete probe plan
for id_name in $(curl -fsS "$API/plans" | python3 -c "import sys,json
rows=json.load(sys.stdin)
for r in rows:
  if str(r.get('name') or '').startswith('SYNC_PROBE'):
    print(r['id'])
"); do
  curl -fsS -X DELETE "$API/plans/$id_name" "${AUTH[@]}" -o /dev/null -w "del_plan=%{http_code}\n" || true
done

echo "==> PUBLIC PROOF (App endpoints)"
echo -n "channels="; curl -fsS "$API/channels" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d));
[print(' ',c['id'],c['name'],'eff=',c.get('stream_delivery_effective'),'url=',(c.get('url') or '')[:55],'playback=',(c.get('playbackUrl') or '')[:55]) for c in d]"
echo -n "banners="; curl -fsS "$API/banners" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d));
[print(' ',b.get('id'),b.get('title'), (b.get('image') or '')[:50]) for b in d]"
echo -n "plans="; curl -fsS "$API/plans" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d));
[print(' ',p.get('id'),p.get('name'),p.get('price')) for p in d]"
echo DONE
