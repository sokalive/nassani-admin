#!/usr/bin/env python3
"""Full Nassani notifications + OneSignal verification after REST secret fix."""
import json
import struct
import time
import urllib.error
import urllib.request
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = "https://api.nassanitv.online"
ENVF = Path("/var/www/nassani-admin/server/.env")
ok_all = True
created_ids = []


def env(name):
    for line in ENVF.read_text(errors="replace").splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


TOKEN = env("ADMIN_API_TOKEN")


def check(name, cond, detail=""):
    global ok_all
    print(("PASS" if cond else "FAIL"), name + (f" — {detail}" if detail else ""))
    if not cond:
        ok_all = False


def api(method, path, body=None, timeout=60):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={"X-Admin-Token": TOKEN, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            j = json.loads(raw) if raw else {}
        except Exception:
            j = {"raw": raw[:400]}
        return e.code, j


def png_bytes(w=48, h=48, rgb=(40, 160, 220)):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def schedule_iso(minutes=5):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


# 1) Env presence
key = env("ONESIGNAL_REST_API_KEY")
app = env("ONESIGNAL_APP_ID")
check("env_app_id", app == "0c40ffbf-2e96-4089-804e-c193e3057f38", app)
check("env_key_os_v2", key.startswith("os_v2_app_"), f"len={len(key)}")
check("env_auth_scheme", env("ONESIGNAL_AUTH_SCHEME") in ("key", "auto", ""), env("ONESIGNAL_AUTH_SCHEME") or "auto")

# 2) Diagnostics / auth
st, diag = api("GET", "/api/notifications/onesignal-diagnostics")
check("diagnostics_http", st == 200, f"status={st}")
check("diagnostics_configured", diag.get("configured") is True, str(diag.get("error") or "")[:120])
check("diagnostics_app_id", diag.get("appId") == app, str(diag.get("appId")))
app_info = diag.get("app") or {}
check("onesignal_auth", not app_info.get("error") and (app_info.get("httpStatus") in (None, 200) or "id" in app_info or "name" in app_info or "messageable_players" in app_info), json.dumps(app_info)[:180])
print("  messageable_players", app_info.get("messageable_players"))

# 3) Immediate send
st, sent = api(
    "POST",
    "/api/notifications",
    {
        "title": "Nassani OneSignal Live Verify",
        "message": "Immediate push verification — safe to ignore",
        "status": "sent",
        "destinationType": "home",
        "recurrenceKind": "once",
    },
)
check("send_immediate", st in (200, 201) and sent.get("onesignalId"), f"status={st} id={sent.get('onesignalId')} recipients={sent.get('onesignalRecipients')}")
if sent.get("id"):
    created_ids.append(sent["id"])
    time.sleep(2)
    st2, stats = api("POST", f"/api/notifications/{sent['id']}/sync-stats", {})
    check(
        "sync_stats",
        st2 == 200,
        f"delivered={stats.get('onesignalDelivered')} clicked={stats.get('onesignalClicked')} failed={stats.get('onesignalFailed')} ctr={stats.get('onesignalCtr')}",
    )

# 4) Destinations + recurrences (schedule, then cancel/delete)
tests = [
    ("home_once", {"destinationType": "home", "recurrenceKind": "once"}),
    ("channel", {"destinationType": "channel", "channelId": 2, "recurrenceKind": "once"}),
    ("custom", {"destinationType": "custom", "deepLink": "nassani://promo/test", "recurrenceKind": "once"}),
    ("daily", {"destinationType": "home", "recurrenceKind": "daily"}),
    ("weekly", {"destinationType": "home", "recurrenceKind": "weekly"}),
    ("monthly", {"destinationType": "home", "recurrenceKind": "monthly"}),
    ("every_minutes", {"destinationType": "home", "recurrenceKind": "interval_minutes", "recurrenceInterval": 15}),
    ("every_hours", {"destinationType": "home", "recurrenceKind": "interval_hours", "recurrenceInterval": 2}),
]
for name, extra in tests:
    body = {
        "title": f"Nassani Verify {name}",
        "message": f"Scheduler verify {name}",
        "status": "scheduled",
        "scheduleAt": schedule_iso(30),
        **extra,
    }
    st, row = api("POST", "/api/notifications", body)
    check(f"schedule_{name}", st in (200, 201) and row.get("status") == "scheduled", f"status={st} id={row.get('id')}")
    if row.get("id"):
        created_ids.append(row["id"])

# Cancel + reschedule one
if len(created_ids) >= 2:
    sid = created_ids[1]
    st, cancelled = api("PUT", f"/api/notifications/{sid}", {"status": "cancelled"})
    check("cancel_scheduled", st == 200 and cancelled.get("status") in ("cancelled", "canceled"), f"status={st} {cancelled.get('status')}")
    st, resched = api(
        "PUT",
        f"/api/notifications/{sid}",
        {"status": "scheduled", "scheduleAt": schedule_iso(45)},
    )
    check("reschedule", st == 200 and resched.get("status") == "scheduled", f"status={st}")

# 5) Image notification
boundary = "----nassaniverify"
img = png_bytes()
body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="image"; filename="notif-test.png"\r\n'
    f"Content-Type: image/png\r\n\r\n"
).encode() + img + f"\r\n--{boundary}--\r\n".encode()
req = urllib.request.Request(
    f"{API}/api/notifications/prepare-image",
    data=body,
    method="POST",
    headers={"X-Admin-Token": TOKEN, "Content-Type": f"multipart/form-data; boundary={boundary}"},
)
with urllib.request.urlopen(req, timeout=45) as r:
    prep = json.loads(r.read().decode())
check("image_prepare", prep.get("ok") and prep.get("pushReady"), str(prep.get("previewUrl", ""))[:90])
check("image_vps_url", str(prep.get("previewUrl", "")).startswith("https://api.nassanitv.online/uploads/"))
if prep.get("previewUrl"):
    with urllib.request.urlopen(prep["previewUrl"], timeout=20) as r:
        check("image_http", r.status == 200, f"ctype={r.headers.get('Content-Type')}")

st, imgsent = api(
    "POST",
    "/api/notifications",
    {
        "title": "Nassani Image Push Verify",
        "message": "Image notification verification",
        "status": "sent",
        "destinationType": "home",
        "recurrenceKind": "once",
        "image": prep.get("imageForDb") or prep.get("image"),
    },
)
check("image_send", st in (200, 201) and imgsent.get("onesignalId"), f"status={st} os={imgsent.get('onesignalId')}")
if imgsent.get("id"):
    created_ids.append(imgsent["id"])

# 6) Runtime + history
st, runtime = api("GET", "/api/notifications/runtime?audience=all")
# runtime may be public; if admin token still works:
if st == 405 or st >= 400:
    # unauthenticated
    with urllib.request.urlopen(API + "/api/notifications/runtime?audience=all", timeout=20) as r:
        runtime = json.loads(r.read().decode())
        st = r.status
check("runtime_feed", st == 200 and isinstance(runtime.get("notifications") or runtime.get("messages"), list))

st, history = api("GET", "/api/notifications")
check("history_list", st == 200 and isinstance(history, list) and len(history) >= 1, f"n={len(history) if isinstance(history, list) else 0}")

# 7) Cleanup created rows
for nid in created_ids:
    try:
        api("DELETE", f"/api/notifications/{nid}")
    except Exception:
        pass

print("RESULT", "PASS" if ok_all else "FAIL")
raise SystemExit(0 if ok_all else 1)
