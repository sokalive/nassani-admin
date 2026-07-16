#!/usr/bin/env python3
"""Print Nassani stream/CDN env (no secrets). Nassani VPS only."""
from pathlib import Path
import json
import subprocess

envf = Path("/var/www/nassani-admin/server/.env")
keys = [
    "BUNNY_CDN_BASE_URL",
    "BUNNY_STREAM_CDN_BASE_URL",
    "STREAM_SEGMENT_DELIVERY",
    "STREAM_SEGMENT_FORCE_PROXY",
    "DIRECT_STREAM_SIGNING_ENABLED",
    "BUNNY_PULL_ORIGIN_SECRET",
    "BUNNY_STREAM_SEGMENT_PATH",
    "BUNNY_PULL_ZONE_ID",
    "STREAM_DELIVERY_MODE",
    "DIRECT_STREAM_ROLLOUT_CHANNEL_IDS",
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
print("commit", subprocess.check_output(["git", "-C", "/var/www/nassani-admin", "rev-parse", "HEAD"], text=True).strip())
apps = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
print("pm2", [a.get("name") for a in apps])

import urllib.request

print("---CDN_PROBE---")
for url in (
    "https://osmanitv.b-cdn.net/api/health",
    "https://api.nassanitv.online/api/health",
):
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            body = r.read(160)
            print(
                url,
                "status",
                r.status,
                "server",
                r.headers.get("Server"),
                "cdn",
                r.headers.get("CDN-PullZone"),
                "body",
                body[:100],
            )
    except Exception as e:
        print(url, "err", getattr(e, "code", None), type(e).__name__)
