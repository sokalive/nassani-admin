#!/usr/bin/env python3
"""Diagnose Nassani OneSignal send failures (no secret dumps)."""
import json
import urllib.error
import urllib.request
from pathlib import Path

ENVF = Path("/var/www/nassani-admin/server/.env")
API = "https://api.nassanitv.online"


def env_map():
    vals = {}
    for line in ENVF.read_text(errors="replace").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        vals[k.strip()] = v
    return vals


def req(method, path, token, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={"X-Admin-Token": token, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            j = json.loads(raw) if raw else {}
        except Exception:
            j = {"raw": raw[:400]}
        return e.code, j


vals = env_map()
token = vals.get("ADMIN_API_TOKEN", "")
print("auth_scheme", vals.get("ONESIGNAL_AUTH_SCHEME") or "(auto)")
print("app_id_prefix", str(vals.get("ONESIGNAL_APP_ID", ""))[:8])
print("key_len", len(vals.get("ONESIGNAL_REST_API_KEY", "")))

st, diag = req("GET", "/api/notifications/onesignal-diagnostics", token)
print("diag_status", st)
print("configured", diag.get("configured"))
print("appId", diag.get("appId"))
app = diag.get("app") or {}
print("app_keys", sorted(app.keys())[:20])
print("app_snippet", json.dumps(app)[:500])
print("segments_snippet", json.dumps(diag.get("segments") or diag.get("subscribedUsersSegment") or {})[:400])
print("api_snippet", json.dumps(diag.get("api") or {})[:400])

st2, sent = req(
    "POST",
    "/api/notifications",
    token,
    {
        "title": "Nassani Auth Probe",
        "message": "probe send",
        "status": "sent",
        "destinationType": "home",
        "recurrenceKind": "once",
    },
)
print("send_status", st2)
print("send_body", json.dumps(sent)[:600])
