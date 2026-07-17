#!/usr/bin/env python3
"""Print OneSignal-related env presence on Nassani VPS (no secret values)."""
from pathlib import Path
import json
import subprocess

envf = Path("/var/www/nassani-admin/server/.env")
keys = [
    "ONESIGNAL_APP_ID",
    "ONESIGNAL_REST_API_KEY",
    "ONESIGNAL_API_KEY",
    "ONESIGNAL_AUTH_SCHEME",
    "NOTIFICATION_IMAGE_STORAGE",
    "NOTIFICATION_IMAGE_PUBLIC_ORIGIN",
    "NOTIFICATIONS_SCHEDULER_MS",
    "BASE_URL",
    "ADMIN_API_TOKEN",
]
vals = {}
for line in envf.read_text(errors="replace").splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vals[k.strip()] = v
for k in keys:
    if k not in vals:
        print(f"{k}=MISSING")
        continue
    v = vals[k]
    if any(s in k for s in ("KEY", "SECRET", "TOKEN")):
        print(f"{k}={'EMPTY' if not v else f'SET len={len(v)}'}")
    else:
        print(f"{k}={v}")
print("commit", subprocess.check_output(["git", "-C", "/var/www/nassani-admin", "rev-parse", "--short", "HEAD"], text=True).strip())
apps = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
print("pm2", [a.get("name") for a in apps])
