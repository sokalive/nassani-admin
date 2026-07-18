#!/usr/bin/env bash
# Forensic census of Nassani security tables (no secrets printed).
set -euo pipefail
ROOT=/var/www/nassani-admin
ENV="$ROOT/server/.env"

echo "=== DB IDENTITY (fingerprints only) ==="
# Show host/db name only from DATABASE_URL without password
python3 - <<'PY'
import os,re
from urllib.parse import urlparse
env={}
for line in open("/var/www/nassani-admin/server/.env"):
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1)
    env[k]=v
u=env.get("DATABASE_URL","")
p=urlparse(u)
print("db_host=", p.hostname)
print("db_port=", p.port or 5432)
print("db_name=", (p.path or "/").lstrip("/").split("?")[0])
print("db_user=", p.username)
print("contains_osmani_name=", "osmani" in (u or "").lower())
print("commit=", env.get("NASSANI_GIT_COMMIT","?"))
print("base_url=", env.get("BASE_URL","?"))
PY

echo "=== SECURITY TABLE COUNTS ==="
sudo -u postgres psql -d nassani_db -v ON_ERROR_STOP=1 <<'SQL'
SELECT current_database() AS db, current_user AS role;
SELECT COUNT(*) AS security_events_total FROM security_events;
SELECT status, COUNT(*) FROM security_events GROUP BY status ORDER BY COUNT(*) DESC;
SELECT COUNT(*) AS active_like FROM security_events WHERE status IN ('failed','blocked','warning','pending');
SELECT COUNT(*) AS profiles_total FROM device_security_profiles;
SELECT security_level, admin_status, COUNT(*) FROM device_security_profiles GROUP BY 1,2 ORDER BY 3 DESC;
SELECT COUNT(*) AS blocked_profiles FROM device_security_profiles WHERE security_level IN ('blocked','critical') OR blocked = true OR admin_status IN ('perm_block','temp_block');
SELECT COUNT(*) AS admin_devices_blocked FROM admin_devices WHERE is_blocked = true;
SELECT COUNT(*) AS admin_devices_whitelisted FROM admin_devices WHERE whitelisted = true;
SELECT MIN(created_at) AS oldest_event, MAX(created_at) AS newest_event FROM security_events;
SELECT MIN(first_seen_at) AS oldest_profile, MAX(last_seen_at) AS newest_profile FROM device_security_profiles;
SQL

echo "=== EVENT TYPE TOP 20 ==="
sudo -u postgres psql -d nassani_db -c "SELECT event_type, status, COUNT(*) c FROM security_events GROUP BY 1,2 ORDER BY c DESC LIMIT 20;"

echo "=== BLOCKED DEVICE SAMPLE (no PII beyond truncated device_id) ==="
sudo -u postgres psql -d nassani_db <<'SQL'
SELECT LEFT(device_id,12) AS device_prefix,
       security_level, admin_status, blocked, risk_score,
       detection_flags, last_reason,
       first_seen_at, last_seen_at, blocked_at, unblocked_at
FROM device_security_profiles
WHERE security_level IN ('blocked','critical') OR blocked = true OR admin_status IN ('perm_block','temp_block')
ORDER BY last_seen_at DESC NULLS LAST
LIMIT 30;
SQL

echo "=== OS MANI STRING HUNT IN SECURITY METADATA ==="
sudo -u postgres psql -d nassani_db -c "SELECT COUNT(*) AS events_mentioning_osmani FROM security_events WHERE detail ILIKE '%osmani%' OR metadata::text ILIKE '%osmani%' OR actor ILIKE '%osmani%';"
sudo -u postgres psql -d nassani_db -c "SELECT COUNT(*) AS profiles_mentioning_osmani FROM device_security_profiles WHERE detection_flags::text ILIKE '%osmani%' OR last_reason ILIKE '%osmani%';"

echo "=== APP SETTINGS SECURITY MODE ==="
sudo -u postgres psql -d nassani_db -c "SELECT key, value FROM app_settings WHERE key LIKE 'security%' OR key LIKE '%protection%' ORDER BY key;"

echo "=== CHANNELS/USERS SCALE (prove not Osmani-sized) ==="
sudo -u postgres psql -d nassani_db -c "SELECT (SELECT COUNT(*) FROM channels) AS channels, (SELECT COUNT(*) FROM device_subscriptions) AS subscriptions, (SELECT COUNT(*) FROM device_security_profiles) AS security_profiles;"
