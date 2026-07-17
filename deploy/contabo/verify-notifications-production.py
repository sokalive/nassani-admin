#!/usr/bin/env python3
"""Full Nassani notifications production verify (requires admin token on VPS)."""
import json
import os
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://api.nassanitv.online"
ok_all = True


def load_admin_token():
    envf = "/var/www/nassani-admin/server/.env"
    for line in open(envf, encoding="utf-8", errors="replace"):
        if line.startswith("ADMIN_API_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def req(method, path, body=None, token=""):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Admin-Token"] = token
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw.decode()) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            j = json.loads(raw.decode())
        except Exception:
            j = {"raw": raw.decode("utf-8", "replace")[:300]}
        return e.code, j


def check(name, cond, detail=""):
    global ok_all
    print(("PASS" if cond else "FAIL"), name + (f" — {detail}" if detail else ""))
    if not cond:
        ok_all = False


token = load_admin_token()
check("admin_token", bool(token), "len=" + str(len(token)))

# OneSignal diagnostics
st, diag = req("GET", "/api/notifications/onesignal-diagnostics", token=token)
check("onesignal_diagnostics", st == 200 and isinstance(diag, dict), f"status={st} keys={list(diag.keys())[:8] if isinstance(diag, dict) else diag}")
if isinstance(diag, dict):
    check("onesignal_configured", diag.get("configured") is True or "app" in diag or "appId" in str(diag), str(diag)[:200])

# List notifications
st, rows = req("GET", "/api/notifications", token=token)
check("list_notifications", st == 200 and isinstance(rows, list), f"status={st} n={len(rows) if isinstance(rows, list) else '?'}")

# Channels for destination
st, channels = req("GET", "/api/channels", token=token)
ch_id = None
if isinstance(channels, list):
    for c in channels:
        if c.get("url"):
            ch_id = c.get("id")
            break
check("channels_for_destination", st == 200 and ch_id is not None, f"channel_id={ch_id}")

# Schedule home notification (no immediate push spam — schedule 2h ahead)
schedule_at = (datetime.now(timezone.utc) + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
st, created = req(
    "POST",
    "/api/notifications",
    {
        "title": "Nassani verify home",
        "message": "Scheduled home destination verification",
        "status": "scheduled",
        "scheduleAt": schedule_at,
        "destinationType": "home",
        "recurrenceKind": "once",
        "sendPush": True,
    },
    token=token,
)
nid_home = created.get("id") if isinstance(created, dict) else None
check("schedule_home", st in (200, 201) and nid_home, f"status={st} id={nid_home}")

# Schedule channel notification
if ch_id:
    st, created_ch = req(
        "POST",
        "/api/notifications",
        {
            "title": "Nassani verify channel",
            "message": "Scheduled channel destination verification",
            "status": "scheduled",
            "scheduleAt": schedule_at,
            "destinationType": "channel",
            "channelId": ch_id,
            "recurrenceKind": "once",
            "sendPush": True,
        },
        token=token,
    )
    nid_ch = created_ch.get("id") if isinstance(created_ch, dict) else None
    check("schedule_channel", st in (200, 201) and nid_ch, f"status={st} id={nid_ch}")
else:
    nid_ch = None

# Custom link
st, created_custom = req(
    "POST",
    "/api/notifications",
    {
        "title": "Nassani verify custom",
        "message": "Custom deep link verification",
        "status": "scheduled",
        "scheduleAt": schedule_at,
        "destinationType": "custom",
        "customDeepLink": "nassani://settings",
        "recurrenceKind": "once",
        "sendPush": False,
    },
    token=token,
)
nid_custom = created_custom.get("id") if isinstance(created_custom, dict) else None
check("schedule_custom", st in (200, 201) and nid_custom, f"status={st}")

# Recurring daily template
st, created_rec = req(
    "POST",
    "/api/notifications",
    {
        "title": "Nassani verify daily",
        "message": "Daily recurrence verification",
        "status": "scheduled",
        "scheduleAt": schedule_at,
        "destinationType": "home",
        "recurrenceKind": "daily",
        "sendPush": False,
    },
    token=token,
)
nid_rec = created_rec.get("id") if isinstance(created_rec, dict) else None
check("schedule_daily_recurrence", st in (200, 201) and nid_rec, f"status={st}")

# Cancel scheduled home
if nid_home:
    st, updated = req(
        "PUT",
        f"/api/notifications/{nid_home}",
        {"status": "cancelled"},
        token=token,
    )
    check("cancel_scheduled", st == 200 and (updated or {}).get("status") == "cancelled", f"status={st}")

# Reschedule channel
if nid_ch:
    new_at = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    st, updated = req(
        "PUT",
        f"/api/notifications/{nid_ch}",
        {"scheduleAt": new_at},
        token=token,
    )
    check("reschedule", st == 200 and (updated or {}).get("scheduleAt"), f"status={st}")

# Delete test rows
for nid in [nid_home, nid_ch, nid_custom, nid_rec]:
    if not nid:
        continue
    st, _ = req("DELETE", f"/api/notifications/{nid}", token=token)
    check(f"delete_{str(nid)[:8]}", st in (200, 204), f"status={st}")

# Runtime feed
st, runtime = req("GET", "/api/notifications/runtime?audience=all")
check("runtime_feed", st == 200 and isinstance(runtime, dict) and "notifications" in runtime)

# Image prepare requires multipart — verify uploads dir has notif files pattern
try:
    out = subprocess.check_output(
        ["ls", "-1", "/var/www/nassani-admin/server/uploads"],
        text=True,
    )
    has_uploads = any("notif-" in ln or ln.endswith((".jpg", ".png", ".webp")) for ln in out.splitlines())
    check("uploads_dir_has_files", has_uploads, f"files={len(out.splitlines())}")
except Exception as e:
    check("uploads_dir_has_files", False, str(e))

print("RESULT", "PASS" if ok_all else "FAIL")
raise SystemExit(0 if ok_all else 1)
