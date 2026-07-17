#!/usr/bin/env python3
"""Production E2E verify Nassani Notifications (API-level; Nassani only)."""
import json
import os
import subprocess
import urllib.error
import urllib.request

API = os.environ.get("API_BASE", "https://api.nassanitv.online")
ADMIN = "https://admin.nassanitv.online"
ok_all = True


def get(path):
    with urllib.request.urlopen(API + path, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def check(name, cond, detail=""):
    global ok_all
    print(("PASS" if cond else "FAIL"), name + (f" — {detail}" if detail else ""))
    if not cond:
        ok_all = False


# Health
st, health = get("/api/health")
check("api_health", st == 200 and health.get("ok") and health.get("service") == "nassani-admin-api")

st, _ = get("/api/notifications/runtime?audience=all")
check("runtime_feed", st == 200)

# OneSignal configured (via internal probe script on VPS if available)
try:
    probe = subprocess.check_output(["python3", "/tmp/probe-notifications-env.py"], text=True, timeout=15)
    check("onesignal_app_id_set", "ONESIGNAL_APP_ID=0c40ffbf" in probe or "ONESIGNAL_APP_ID=SET" in probe or "len=36" in probe.split("ONESIGNAL_APP_ID=")[-1][:20] if "ONESIGNAL_APP_ID=" in probe else False, probe.split("ONESIGNAL_APP_ID=")[-1].split()[0] if "ONESIGNAL_APP_ID=" in probe else "missing")
    check("onesignal_key_set", "ONESIGNAL_REST_API_KEY=SET len=" in probe and "EMPTY" not in probe.split("ONESIGNAL_REST_API_KEY=")[-1][:30], "")
except Exception as e:
    print("probe_skip", e)

# Diagnostics endpoint requires admin auth — test unauthenticated returns 401/403
try:
    urllib.request.urlopen(API + "/api/notifications/onesignal-diagnostics", timeout=20)
    check("diagnostics_auth", False, "expected auth required")
except urllib.error.HTTPError as e:
    check("diagnostics_auth", e.code in (401, 403), f"status={e.code}")

# DB table exists
try:
    cols = subprocess.check_output(
        [
            "sudo",
            "-u",
            "postgres",
            "psql",
            "-d",
            "nassani_db",
            "-tAc",
            "SELECT count(*) FROM information_schema.columns WHERE table_name='notifications';",
        ],
        text=True,
    ).strip()
    check("notifications_table", int(cols) >= 20, f"cols={cols}")
except Exception as e:
    check("notifications_table", False, str(e))

# Image storage origin
try:
    st, media = get("/api/health/media")
    check("uploads_dir", media.get("exists") is True and media.get("writable") is True)
except Exception as e:
    check("uploads_dir", False, str(e))

# Admin SPA
try:
    with urllib.request.urlopen(ADMIN + "/", timeout=20) as r:
        check("admin_http", r.status == 200)
except Exception as e:
    check("admin_http", False, str(e))

# Channels for destination selector
st, channels = get("/api/channels")
check("channels_api", st == 200 and isinstance(channels, list))

# Banners / home-logos (sidebar ecosystem)
for path in ("/api/banners", "/api/home-logos"):
    try:
        st, data = get(path)
        check(f"get_{path.split('/')[-1]}", st == 200)
    except Exception as e:
        check(f"get_{path.split('/')[-1]}", False, str(e))

print("RESULT", "PASS" if ok_all else "FAIL")
raise SystemExit(0 if ok_all else 1)
