#!/usr/bin/env python3
"""Investigate shared Bunny CDN behavior for Nassani (read-only; no Bunny dashboard changes)."""
import json
import urllib.error
import urllib.parse
import urllib.request

CDN = "https://osmanitv.b-cdn.net"
NASSANI = "https://api.nassanitv.online"


def fetch(url, method="GET", timeout=30):
    req = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers.items()), r.read(500)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()) if e.headers else {}, e.read(300)
    except Exception as e:
        return None, {}, str(e).encode()


print("=== health ===")
for u in (f"{CDN}/api/health", f"{NASSANI}/api/health"):
    st, hdr, body = fetch(u)
    print(u, st, hdr.get("Server"), hdr.get("CDN-PullZone"), body[:120])

print("=== channels thumbnails sample ===")
ch = json.loads(urllib.request.urlopen(f"{NASSANI}/api/channels", timeout=30).read())
for c in ch[:5]:
    thumb = c.get("thumbnail") or c.get("thumbnailUrl") or c.get("image") or ""
    print(f"id={c.get('id')} name={c.get('name')} thumb={str(thumb)[:100]}")

print("=== CDN hls/seg without token ===")
st, hdr, body = fetch(f"{CDN}/hls/seg")
print("status", st, "ctype", hdr.get("Content-Type"), "body", body[:160])

print("=== Nassani origin hls/seg without token ===")
st, hdr, body = fetch(f"{NASSANI}/hls/seg")
print("status", st, "ctype", hdr.get("Content-Type"), "body", body[:160])

# Get a signed stream-direct URL and inspect rewritten segment hosts
news = next(c for c in ch if str(c.get("id")) == "4")
pu = news.get("playbackUrl") or ""
print("=== canary4 playback host ===")
print(pu[:120])
if "stream-direct" in pu:
    st, hdr, body = fetch(pu)
    text = body.decode("utf-8", "replace")
    print("manifest", st, "bytes", len(body))
    segs = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
    hosts = {}
    for s in segs[:10]:
        try:
            h = urllib.parse.urlparse(s).netloc
        except Exception:
            h = "?"
        hosts[h] = hosts.get(h, 0) + 1
    print("seg_hosts", hosts)
