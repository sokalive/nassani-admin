#!/usr/bin/env python3
"""Print Nassani stream/Bunny env key presence on VPS (no secret values)."""
from pathlib import Path

envf = Path("/var/www/nassani-admin/server/.env")
keys = [
    "STREAM_DELIVERY_MODE",
    "DIRECT_STREAM_SIGNING_ENABLED",
    "DIRECT_STREAM_SIGNING_SECRET",
    "DIRECT_STREAM_CUTOVER_ENABLED",
    "DIRECT_STREAM_ROLLOUT_PERCENT",
    "STREAM_PLAYBACK_FORCE_PROXY",
    "STREAM_SEGMENT_DELIVERY",
    "STREAM_SEGMENT_FORCE_PROXY",
    "BUNNY_CDN_BASE_URL",
    "BUNNY_STREAM_CDN_BASE_URL",
    "BUNNY_STREAM_SEGMENT_PATH",
    "BUNNY_PULL_ORIGIN_SECRET",
    "BUNNY_API_KEY",
    "BUNNY_PULL_ZONE_ID",
    "BUNNY_ZONE_ID",
    "STREAM_API_BASE_URL",
    "BASE_URL",
    "STREAM_SEGMENT_SELECTIVE_ROUTING",
    "STREAM_SEGMENT_TOKEN_TTL_SEC",
    "DIRECT_STREAM_TOKEN_TTL_SEC",
    "BUNNY_CDN_URL",
]
vals = {}
for line in envf.read_text(errors="replace").splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vals[k.strip()] = v
secretish = ("SECRET", "KEY", "TOKEN", "PASSWORD")
for k in keys:
    if k not in vals:
        print(f"{k}=MISSING")
        continue
    v = vals[k]
    if any(s in k for s in secretish):
        print(f"{k}={'EMPTY' if not v else f'SET len={len(v)}'}")
    else:
        print(f"{k}={v}")

import json
import subprocess
import urllib.request

print("---ROUTES---")
for path in ("/stream-proxy", "/stream-direct", "/hls/seg"):
    try:
        req = urllib.request.Request(f"https://api.nassanitv.online{path}", method="GET")
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"{path}={resp.status}")
    except Exception as e:
        code = getattr(getattr(e, "code", None), "real", None) or getattr(e, "code", None)
        print(f"{path}=ERR:{code or type(e).__name__}")

print("---PM2---")
try:
    raw = subprocess.check_output(["pm2", "jlist"], text=True, timeout=20)
    apps = json.loads(raw)
    print([a.get("name") for a in apps])
except Exception as e:
    print(f"pm2_err={e}")