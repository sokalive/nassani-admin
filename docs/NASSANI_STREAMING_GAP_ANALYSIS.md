# Nassani Streaming Architecture — Gap Analysis

**Scope:** Nassani production only (`api.nassanitv.online`, `admin.nassanitv.online`, VPS `169.58.18.86`).  
**Source architecture:** prior READ-ONLY Osmani investigation (not re-accessed here).  
**Date:** 2026-07-16

## Target architecture (same design as Osmani, Nassani-owned)

```text
Admin CRUD → Nassani PostgreSQL → GET /api/channels
  → playbackUrl
     → /stream-direct?token=…     (HMAC manifest entry)
        → rewrite HLS lines:
           public → Bunny CDN /hls/seg?tok=…
           protected → /stream-proxy?url=…
     → Bunny cache miss → API /hls/seg?tok=… → upstream
```

## What already exists (code + VPS)

| Component | Status |
|-----------|--------|
| `stream-proxy` | Present (`server/src/routes/streamProxy.js`) |
| `stream-direct` + HMAC | Present (`directStreamSigning.js`, route mounted) |
| Manifest rewrite | Present (`streamManifestRewrite.js`) |
| Bunny origin-pull `/hls/seg` | Present (`streamBunnyPull.js`) |
| Segment selective routing | Present (`streamSegmentDelivery.js`) |
| Cache purge script | Present (`purge-bunny-hls-seg.mjs`) |
| Playback URL fields | Present (`playbackUrl`, `proxy_playback_url`, `direct_stream_url`) |
| Admin channel upload CRUD | Present — must remain unchanged |
| App API shape | Compatible — additive fields only |
| `DIRECT_STREAM_SIGNING_SECRET` on VPS | Present (will rotate to new Nassani secret) |
| PM2 `nassani-admin-api` only | Confirmed (no Osmani processes) |

## What was missing (production config)

| Item | Before |
|------|--------|
| `DIRECT_STREAM_SIGNING_ENABLED` | `0` (signing off → `/stream-direct` 503) |
| `BUNNY_CDN_BASE_URL` / `BUNNY_STREAM_CDN_BASE_URL` | empty / missing |
| `STREAM_SEGMENT_DELIVERY` | missing (segment offload inactive) |
| Nassani Bunny Pull Zone | not configured (candidate `*.b-cdn.net` hosts return 403) |
| `BUNNY_API_KEY` / zone id | missing on VPS |
| Signed canary rollout | cutover on but signing off → App saw raw upstream URLs |

## What needs improvement

1. Provision **Nassani** Bunny Pull Zone origin = `https://api.nassanitv.online`.
2. Enable HMAC signing with **new** Nassani secrets (never Osmani).
3. Canary signed `stream-direct` on real HLS channels (`3,4,5`) only.
4. Keep HTML player channel (`2` mpingo) on upstream `direct` (no APK / player break).
5. Fix health route double-slash `//hls/seg`.

## What must remain unchanged

- Admin upload/CRUD workflows
- Public API field names / OTA update contract
- Non-HLS channel playback via upstream URL when not allowlisted
- PostgreSQL schema (no migration required)
- Osmani infrastructure (untouched)

## Enablement

```bash
# On Nassani VPS only:
BUNNY_API_KEY='<nassani-only>' bash deploy/contabo/enable-nassani-stream-architecture.sh
# or without Bunny key (proxy segments until CDN ready):
bash deploy/contabo/enable-nassani-stream-architecture.sh
```
