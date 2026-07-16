#!/usr/bin/env python3
"""Probe nassanitv.b-cdn.net origin (read-only)."""
import urllib.error
import urllib.request

urls = [
    "https://nassanitv.b-cdn.net/api/health",
    "https://api.nassanitv.online/api/health",
    "https://nassanitv.b-cdn.net/hls/seg",
    "https://api.nassanitv.online/hls/seg",
]
for u in urls:
    try:
        with urllib.request.urlopen(u, timeout=20) as r:
            body = r.read(180)
            print(
                u,
                "status",
                r.status,
                "server",
                r.headers.get("Server"),
                "cdn",
                r.headers.get("CDN-PullZone"),
                "body",
                body[:140],
            )
    except urllib.error.HTTPError as e:
        print(u, "status", e.code, "body", e.read(120))
    except Exception as e:
        print(u, "err", type(e).__name__, e)
