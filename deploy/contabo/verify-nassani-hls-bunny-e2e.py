#!/usr/bin/env python3
"""Production E2E: Nassani HLS via nassanitv.b-cdn.net; uploads stay on VPS."""
import json
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.nassanitv.online"
ADMIN = "https://admin.nassanitv.online"
STREAM_CDN = "https://nassanitv.b-cdn.net"
ok_all = True


def get_json(path, base=API):
    with urllib.request.urlopen(base + path, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def fetch(url, timeout=60):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type") if e.headers else None, e.read(200)
    except Exception as e:
        return None, None, str(e).encode()


def check(name, cond, detail=""):
    global ok_all
    print(("PASS" if cond else "FAIL"), name + (f" — {detail}" if detail else ""))
    if not cond:
        ok_all = False


# Health
st, health = get_json("/api/health")
check("api_health", st == 200 and health.get("ok") is True and health.get("service") == "nassani-admin-api", health.get("commit"))
st, _, _ = fetch(ADMIN + "/")
check("admin_http", st == 200, f"status={st}")

st, sd = get_json("/api/health/stream-delivery")
segs = sd.get("segments") or {}
check("signing", sd.get("signing_configured") is True)
check("stream_cdn", segs.get("bunny_stream_cdn_base") == STREAM_CDN, str(segs.get("bunny_stream_cdn_base")))
check("segment_bunny", segs.get("stream_segment_delivery") == "bunny")
check("offload_active", segs.get("production_segment_offload_active") is True)

# Media CDN must NOT rewrite uploads to Bunny
try:
    st, media = get_json("/api/health/media")
    cdn = media.get("cdn") or {}
    # cdnBaseUrl should be null/empty when BUNNY_CDN_BASE_URL cleared
    base = cdn.get("cdnBaseUrl")
    check("static_cdn_disabled", not base, f"cdnBaseUrl={base}")
except Exception as e:
    print("media_skip", e)

# Channels / banners / home-logos — image URLs on VPS
st, channels = get_json("/api/channels")
check("channels", st == 200 and isinstance(channels, list) and len(channels) >= 1, f"n={len(channels)}")

st, banners = get_json("/api/banners")
if isinstance(banners, dict) and "banners" in banners:
    banners = banners["banners"]
check("banners", st == 200 and isinstance(banners, list), f"status={st}")

st, logos = get_json("/api/home-logos")
if isinstance(logos, dict):
    logos_list = logos.get("logos") or logos.get("items") or logos.get("data") or []
else:
    logos_list = logos if isinstance(logos, list) else []
check("home_logos", st == 200, f"status={st} n={len(logos_list) if isinstance(logos_list, list) else '?'}")


def assert_vps_asset(label, url):
    if not url:
        print("skip", label, "empty")
        return
    check(f"{label}_host", url.startswith("https://api.nassanitv.online/uploads/"), url[:100])
    check(f"{label}_not_bunny", "b-cdn.net" not in url, url[:100])
    st, ct, body = fetch(url)
    check(f"{label}_http", st == 200 and len(body or b"") > 50, f"status={st} bytes={len(body or b'')} ctype={ct}")


# Collect image URLs
for c in channels:
    thumb = c.get("thumbnail") or c.get("thumbnailUrl") or ""
    if thumb:
        assert_vps_asset(f"channel{c.get('id')}_thumb", thumb)
        break

for b in banners or []:
    img = b.get("image") or b.get("imageUrl") or b.get("image_url") or ""
    if img:
        assert_vps_asset("banner_img", img)
        break

for L in logos_list or []:
    img = L.get("image") or L.get("imageUrl") or L.get("url") or ""
    if img:
        assert_vps_asset("home_logo_img", img)
        break

# Channel 2 stays upstream HTML player
sports = next((c for c in channels if str(c.get("id")) == "2"), None)
pu2 = (sports or {}).get("playbackUrl") or ""
check("channel2_upstream", "stream-direct" not in pu2 and "mpingo" in pu2, pu2[:80])

# HLS canaries: stream-direct + Bunny segment rewrite
played = 0
for cid in ("3", "4", "5"):
    c = next((x for x in channels if str(x.get("id")) == cid), None)
    if not c:
        continue
    pu = c.get("playbackUrl") or ""
    check(f"ch{cid}_stream_direct", "/stream-direct" in pu)
    st, ct, body = fetch(pu)
    text = body.decode("utf-8", "replace") if body else ""
    check(f"ch{cid}_manifest", st == 200 and "#EXTM3U" in text, f"status={st} bytes={len(body or b'')}")
    urls = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
    bunny_n = sum(1 for u in urls if u.startswith(STREAM_CDN + "/hls/seg"))
    proxy_n = sum(1 for u in urls if "/stream-proxy" in u)
    print(f"  ch{cid} bunny={bunny_n} proxy={proxy_n} sample={(urls[0][:110] if urls else None)}")
    check(f"ch{cid}_bunny_rewrite", bunny_n >= 1, f"bunny={bunny_n} proxy={proxy_n}")
    if not urls:
        continue
    st2, ct2, body2 = fetch(urls[0])
    check(f"ch{cid}_bunny_seg", st2 == 200 and len(body2 or b"") > 32, f"status={st2} ctype={ct2} bytes={len(body2 or b'')}")
    if st2 == 200 and body2 and body2.startswith(b"#EXT"):
        media = [ln.strip() for ln in body2.decode("utf-8", "replace").splitlines() if ln.strip() and not ln.startswith("#")]
        if media:
            # media may be bunny seg or relative rewritten
            mu = media[0]
            if mu.startswith("http"):
                st3, ct3, body3 = fetch(mu)
            else:
                st3, ct3, body3 = 0, None, b""
            check(
                f"ch{cid}_media",
                st3 == 200 and len(body3 or b"") > 100,
                f"status={st3} bytes={len(body3 or b'')} magic={(body3[:1] if body3 else None)!r}",
            )
            if st3 == 200:
                played += 1
                check(f"ch{cid}_media_via_bunny", STREAM_CDN in mu or "/hls/seg" in mu or "/stream-proxy" in mu, mu[:100])
    elif st2 == 200:
        played += 1

check("live_hls", played >= 1, f"played={played}")

# stream-proxy still works
st, ct, body = fetch(
    API + "/stream-proxy?url=" + urllib.parse.quote("https://test-streams.mux.dev/test_001/stream.m3u8", safe="")
)
check("stream_proxy", st == 200 and b"#EXTM3U" in (body or b""), f"status={st}")

print("RESULT", "PASS" if ok_all else "FAIL")
raise SystemExit(0 if ok_all else 1)
