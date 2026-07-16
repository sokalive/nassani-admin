#!/usr/bin/env bash
set -euo pipefail
cd /var/www/nassani-admin
grep -E '^ADMIN_PANEL_AUTH_REQUIRED=|^ADMIN_API_TOKEN=' server/.env | sed 's/ADMIN_API_TOKEN=.*/ADMIN_API_TOKEN=SET/'
curl -fsS https://api.nassanitv.online/api/admin/auth/status
echo
sudo -u postgres psql -d nassani_db -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%admin%' ORDER BY 1;"
sudo -u postgres psql -d nassani_db -c "SELECT id, email FROM admin_users ORDER BY id LIMIT 5;" 2>/dev/null || echo "no admin_users table or empty"
# prove wrong token fails
code=$(curl -s -o /tmp/bad.json -w '%{http_code}' -X POST https://api.nassanitv.online/api/channels -H 'X-Admin-Token: 3030' -H 'Content-Type: application/json' -d '{"name":"x","url":"https://example.com/x.m3u8"}')
echo "POST channels with 3030 => $code $(head -c 80 /tmp/bad.json)"
