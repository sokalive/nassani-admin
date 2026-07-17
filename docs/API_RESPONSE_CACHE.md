# API response cache

Lightweight **in-memory** cache on the Node API for identical public `GET` requests. Reduces PostgreSQL reads and JSON serialization CPU. Does not change response JSON shapes.

Freshness is driven by **SSE** (`/api/subscription-stream`, `/api/sync/stream`) plus **immediate namespace invalidation** on Admin writes. TTL is only a safety net for clients that poll without SSE.

## Cached endpoints

| Endpoint | TTL (default) | Invalidates on |
|----------|---------------|----------------|
| `GET /api/channels` | 3s | `config.channels_changed` |
| `GET /api/banners` | 3s | `config.banners_changed` |
| `GET /api/home-logos` | 3s | `config.home_logos_changed` |
| `GET /api/plans` | 5s | `config.plans_changed` |
| `GET /api/payment-providers` | 5s | `config.payment_providers_changed` |
| `GET /api/whatsapp-settings` | 5s | WhatsApp settings save |
| `GET /api/settings/whatsapp` | 5s | same |
| `GET /api/settings/popup` | 5s | popup settings save |
| `GET /api/settings/public` | 5s | WhatsApp, popup, or modes save |
| `GET /api/runtime/app-modes` | 2s | global app modes save |

## Not cached

Subscription, payments, device/auth, analytics, notifications runtime, OTA/update-check, SSE (`/api/sync/stream`, `/api/subscription-stream`), admin routes, personalized responses.

## Behavior

- Concurrent identical requests share one in-flight loader (**DEDUP**).
- `liveSyncBus` admin events purge related namespaces immediately (`apiCacheInvalidation.js`).
- Cross-instance purge via PostgreSQL `NOTIFY nassani_api_cache_bust`.
- Bounded size (`API_CACHE_MAX_ENTRIES`, default 48).
- Browser still receives `Cache-Control: no-store` on catalog routes; only the **server** avoids repeat DB work.
- Dev/staging: response header `X-Api-Cache: HIT | MISS | DEDUP` (omitted in production unless `API_CACHE_DEBUG=1`).

## Realtime path (preferred)

1. Admin mutation → `invalidateApiCacheNamespace` + `liveSyncBus.publish`
2. PG relay → peer Node instances
3. SSE clients receive targeted events (`catalog_refresh`, `banners_changed`, `channels_changed`, `home_logos_changed`, …)
4. App refetches **only** the named resource

## Verify

```bash
cd server
npm run verify:api-cache
npm run verify:instant-sync
# After deploy:
curl -s https://api.nassanitv.online/api/health | jq .api_cache
```
