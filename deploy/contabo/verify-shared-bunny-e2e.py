#!/usr/bin/env python3
"""E2E verify Nassani with shared Bunny CDN base URLs configured (Nassani only)."""
import json
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.nassanitv.online"
CDN = "https://osmanitv.b-cdn.net"
ok_all = True


def get_json(path):
    with urllib.request.urlopen(API + path, timeout=30) as r:
        return json.loads(r.read().decode())


def fetch(url, timeout=45):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type") if e.headers else None, e.read(200)
    except Exception as e:
        return None, None, str(e).encode()


def check(name, cond, detail=""):
    global ok_all
    status = "PASS" if cond else "FAIL"
    if not cond:
        ok_all = False
    print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))


sd = get_json("/api/health/stream-delivery")
segs = sd.get("segments") or {}
check("signing", sd.get("signing_configured") is True)
check("bunny_base_configured", segs.get("bunny_stream_cdn_base") == CDN, str(segs.get("bunny_stream_cdn_base")))
check("segment_mode", segs.get("stream_segment_delivery") == "proxy", str(segs.get("stream_segment_delivery")))

try:
    media = get_json("/api/health/media")
    cdn_info = media.get("cdn") or {}
    if "cdnBaseUrl" in cdn_info:
        check("media_cdn_base", cdn_info.get("cdnBaseUrl") == CDN, str(cdn_info.get("cdnBaseUrl")))
except Exception as e:
    print("media_skip", e)

ch = get_json("/api/channels")
check("channels", isinstance(ch, list) and len(ch) >= 1, f"count={len(ch)}")

sports = next((c for c in ch if str(c.get("id")) == "2"), None)
thumb = (sports or {}).get("thumbnail") or (sports or {}).get("thumbnailUrl") or ""
print("thumb_url", thumb[:140])
if thumb:
    st, ct, body = fetch(thumb)
    check("thumbnail_http", st == 200 and len(body) > 100, f"status={st} bytes={len(body or b'')} ctype={ct}")
    check("thumbnail_from_nassani_origin", "api.nassanitv.online" in thumb)

pu2 = (sports or {}).get("playbackUrl") or ""
check("channel2_upstream", "stream-direct" not in pu2 and "mpingo" in pu2, pu2[:80])

played = 0
for cid in ("3", "4", "5"):
    c = next((x for x in ch if str(x.get("id")) == cid), None)
    if not c:
        continue
    pu = c.get("playbackUrl") or ""
    check(f"channel{cid}_stream_direct", "/stream-direct" in pu)
    st, ct, body = fetch(pu)
    text = body.decode("utf-8", "replace") if body else ""
    check(f"channel{cid}_manifest", st == 200 and "#EXTM3U" in text, f"status={st} bytes={len(body or b'')}")
    urls = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
    proxy_n = sum(1 for u in urls if "/stream-proxy" in u)
    bunny_n = sum(1 for u in urls if "b-cdn.net" in u and "/hls/seg" in u)
    print(f"  channel{cid} rewrite proxy={proxy_n} bunny={bunny_n}")
    check(f"channel{cid}_proxy_rewrite", proxy_n >= 1, f"proxy={proxy_n} bunny={bunny_n}")
    if not urls:
        continue
    st2, ct2, body2 = fetch(urls[0])
    check(f"channel{cid}_seg", st2 == 200 and len(body2 or b"") > 32, f"status={st2} bytes={len(body2 or b'')}")
    if st2 == 200 and body2 and body2.startswith(b"#EXT"):
        media_urls = [
            ln.strip()
            for ln in body2.decode("utf-8", "replace").splitlines()
            if ln.strip() and not ln.startswith("#")
        ]
        if media_urls:
            st3, ct3, body3 = fetch(media_urls[0])
            check(
                f"channel{cid}_media_ts",
                st3 == 200 and len(body3 or b"") > 100,
                f"status={st3} bytes={len(body3 or b'')} magic={(body3[:1] if body3 else None)!r}",
            )
            if st3 == 200:
                played += 1
    elif st2 == 200:
        played += 1

check("live_playback", played >= 1, f"played={played}")

st, ct, body = fetch(
    f"{API}/stream-proxy?url=" + urllib.parse.quote("https://test-streams.mux.dev/test_001/stream.m3u8", safe="")
)
check("stream_proxy_route", st == 200 and b"#EXTM3U" in (body or b""), f"status={st}")

st, _, _ = fetch("https://admin.nassanitv.online/")
check("admin_http", st == 200, f"status={st}")

print("RESULT", "PASS" if ok_all else "FAIL")
raise SystemExit(0 if ok_all else 1)
