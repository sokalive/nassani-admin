#!/usr/bin/env bash
# One-shot production remediation for false-positive security spam + blocked Closed Testers.
# Nassani ONLY. Does not touch Osmani. Does not grant subscriptions.
set -euo pipefail

echo "=== BEFORE ==="
sudo -u postgres psql -d nassani_db -c "SELECT COUNT(*) AS events FROM security_events;"
sudo -u postgres psql -d nassani_db -c "SELECT security_level, admin_status, COUNT(*) FROM device_security_profiles GROUP BY 1,2 ORDER BY 3 DESC;"
sudo -u postgres psql -d nassani_db -c "SELECT COUNT(*) AS blocked_fp FROM device_security_profiles WHERE security_level IN ('blocked','critical') AND admin_status='monitoring' AND frida=false AND tampered_apk=false AND debugger=false AND clone_detected=false;"

echo "=== PURGE SPAM LEVEL-CHANGED WARNING EVENTS (keep real detections/blocks/admin) ==="
sudo -u postgres psql -d nassani_db -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM security_events
WHERE event_type = 'Security level changed'
  AND status = 'warning';
SQL

echo "=== CLEAR FALSE-POSITIVE HARD BLOCKS (no severe anti-tamper flags) ==="
sudo -u postgres psql -d nassani_db -v ON_ERROR_STOP=1 <<'SQL'
UPDATE device_security_profiles
SET security_level = 'warning',
    blocked = false,
    blocked_at = NULL,
    blocked_by = '',
    updated_at = now()
WHERE admin_status = 'monitoring'
  AND security_level IN ('blocked', 'critical')
  AND COALESCE(frida, false) = false
  AND COALESCE(tampered_apk, false) = false
  AND COALESCE(debugger, false) = false
  AND COALESCE(clone_detected, false) = false;

-- ROOT/EMULATOR-only monitoring → Smart Monitor
UPDATE device_security_profiles
SET admin_status = 'smart_monitor',
    smart_monitor_enabled = true,
    security_level = 'warning',
    blocked = false,
    blocked_at = NULL,
    blocked_by = '',
    unblocked_at = COALESCE(unblocked_at, now()),
    unblocked_by = CASE WHEN unblocked_at IS NULL THEN 'system:closed_test_remediation' ELSE unblocked_by END,
    updated_at = now()
WHERE admin_status = 'monitoring'
  AND (COALESCE(rooted, false) = true OR COALESCE(emulator, false) = true)
  AND COALESCE(frida, false) = false
  AND COALESCE(tampered_apk, false) = false
  AND COALESCE(debugger, false) = false
  AND COALESCE(clone_detected, false) = false;

-- Ensure admin_devices layer is not falsely blocking
UPDATE admin_devices SET is_blocked = false, block_reason = NULL, updated_at = now()
WHERE is_blocked = true
  AND device_id IN (
    SELECT device_id FROM device_security_profiles
    WHERE admin_status IN ('smart_monitor', 'allowed', 'whitelisted', 'monitoring')
      AND security_level NOT IN ('blocked', 'critical')
  );
SQL

echo "=== AFTER ==="
sudo -u postgres psql -d nassani_db -c "SELECT COUNT(*) AS events FROM security_events;"
sudo -u postgres psql -d nassani_db -c "SELECT status, COUNT(*) FROM security_events GROUP BY status ORDER BY 2 DESC;"
sudo -u postgres psql -d nassani_db -c "SELECT security_level, admin_status, COUNT(*) FROM device_security_profiles GROUP BY 1,2 ORDER BY 3 DESC;"
sudo -u postgres psql -d nassani_db -c "SELECT COUNT(*) AS still_hard_blocked FROM device_security_profiles WHERE security_level IN ('blocked','critical');"
echo "DONE"
