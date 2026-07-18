#!/usr/bin/env bash
set -euo pipefail
echo "code playOnly:"; grep -n "playOnly\|play_app_signing" /var/www/nassani-admin/server/src/lib/deviceSecurityStore.js | head -20
sudo -u postgres psql -d nassani_db <<'SQL'
UPDATE device_security_profiles
SET security_level = 'warning',
    blocked = false,
    blocked_at = NULL,
    blocked_by = '',
    updated_at = now()
WHERE admin_status = 'smart_monitor'
  AND security_level IN ('blocked', 'critical')
  AND COALESCE(frida, false) = false
  AND COALESCE(debugger, false) = false
  AND COALESCE(clone_detected, false) = false;

SELECT security_level, admin_status, COUNT(*) FROM device_security_profiles GROUP BY 1,2 ORDER BY 3 DESC;
SQL
