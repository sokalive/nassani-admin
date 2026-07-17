#!/usr/bin/env python3
"""Probe Nassani notifications env + DB (no secret values)."""
from pathlib import Path
import subprocess

envf = Path("/var/www/nassani-admin/server/.env")
keys = [
    "ONESIGNAL_APP_ID",
    "ONESIGNAL_REST_API_KEY",
    "NOTIFICATION_IMAGE_PUBLIC_ORIGIN",
    "NOTIFICATION_IMAGE_STORAGE",
    "BASE_URL",
    "ADMIN_PANEL_AUTH_REQUIRED",
    "NOTIFICATIONS_SCHEDULER_MS",
    "ONESIGNAL_STATS_REFRESH_MS",
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
    if any(s in k for s in ("SECRET", "KEY", "TOKEN", "PASSWORD")):
        print(f"{k}={'EMPTY' if not v else f'SET len={len(v)}'}")
    else:
        print(f"{k}={v}")

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
    cnt = subprocess.check_output(
        ["sudo", "-u", "postgres", "psql", "-d", "nassani_db", "-tAc", "SELECT count(*) FROM notifications;"],
        text=True,
    ).strip()
    print("notifications_table_cols", cols)
    print("notifications_rows", cnt)
except Exception as e:
    print("db_err", type(e).__name__, e)
