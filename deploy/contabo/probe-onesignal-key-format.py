#!/usr/bin/env python3
"""Sanity-check OneSignal key formatting without printing the secret."""
from pathlib import Path

envf = Path("/var/www/nassani-admin/server/.env")
vals = {}
for line in envf.read_text(errors="replace").splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vals[k.strip()] = v

key = vals.get("ONESIGNAL_REST_API_KEY", "")
print("raw_len", len(key))
print("stripped_len", len(key.strip()))
print("has_quotes", key[:1] in "\"'" or key[-1:] in "\"'")
print("has_whitespace", key != key.strip() or any(c.isspace() for c in key))
print("starts_os_v2", key.strip().startswith("os_v2_"))
print("looks_like_uuid", len(key.strip()) == 36 and key.count("-") == 4)
print("charset_ok", all(c.isalnum() or c in "_-" for c in key.strip()))
print("prefix3", key.strip()[:3])
print("suffix3", key.strip()[-3:])
