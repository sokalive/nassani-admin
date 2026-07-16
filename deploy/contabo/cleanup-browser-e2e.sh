#!/usr/bin/env bash
set -euo pipefail
ROOT=/var/www/nassani-admin
set -a
# shellcheck disable=SC1091
source "$ROOT/server/.env"
set +a
API="${API_BASE:-https://api.nassanitv.online}"
curl -fsS "$API/api/channels" -H "X-Admin-Token: $ADMIN_API_TOKEN" > /tmp/chs.json
python3 - <<'PY'
import json, os, subprocess
api = os.environ.get('API_BASE', 'https://api.nassanitv.online')
tok = os.environ['ADMIN_API_TOKEN']
d = json.load(open('/tmp/chs.json'))
items = d if isinstance(d, list) else d.get('channels', [])
for c in items:
    n = str(c.get('name', ''))
    if 'Browser E2E' in n or n.startswith('E2E Upload'):
        cid = c.get('id')
        subprocess.run([
            'curl', '-fsS', '-X', 'DELETE',
            f'{api}/api/channels/{cid}',
            '-H', f'X-Admin-Token: {tok}',
        ], check=True)
        print('deleted channel', cid, n)
PY
