import { liveSyncBus } from './liveSyncBus.js'
import { invalidateApiCacheNamespace } from './apiResponseCache.js'
import { loadGlobalAppModesPayload } from '../routes/globalAppSettings.js'
import { invalidateChannelIdNameMapCache, getChannelById } from '../store.js'
import { notifyApiCacheBust } from './apiCacheBustRelay.js'
import { notifyLiveSyncPeers } from './liveSyncRelay.js'

const CHANNEL_CACHE_NAMESPACES = ['channels', 'runtime-app-modes']

/** Purge catalog + version poll caches so accessType changes are visible on next GET. */
export function invalidateChannelCatalogCaches() {
  for (const ns of CHANNEL_CACHE_NAMESPACES) {
    invalidateApiCacheNamespace(ns)
  }
  invalidateChannelIdNameMapCache()
}

/**
 * After channel catalog writes: purge caches, bump config version, and attach `modes` so
 * subscription-stream `modeSyncHandler` pushes a fresh `v` without editing subscription.js.
 */
export async function publishChannelCatalogChange(action, channelId = null, extra = {}) {
  invalidateChannelCatalogCaches()

  // Build optional channel patch without blocking SSE if DB is slow.
  let channelPatch = extra.channel ?? null
  const cid = channelId != null ? Number(channelId) : null
  if (!channelPatch && cid != null && Number.isFinite(cid)) {
    try {
      const row = await Promise.race([
        getChannelById(cid),
        new Promise((resolve) => setTimeout(() => resolve(null), 250)),
      ])
      if (row) {
        const accessType = row.accessType === 'premium' ? 'premium' : 'free'
        const updatedAt =
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : row.updatedAt
              ? String(row.updatedAt)
              : new Date().toISOString()
        channelPatch = {
          id: row.id,
          access_type: accessType,
          accessType,
          accessPremium: accessType === 'premium',
          access_premium: accessType === 'premium',
          is_active: row.isActive !== false,
          show_in_app: row.showInApp !== false,
          updated_at: updatedAt,
        }
      }
    } catch {
      /* optional patch */
    }
  }

  // Modes are optional; never await a full settings reload before fan-out.
  let modes = extra.modes ?? null
  if (!modes) {
    try {
      const modesPayload = await Promise.race([
        loadGlobalAppModesPayload(),
        new Promise((resolve) => setTimeout(() => resolve(null), 250)),
      ])
      if (modesPayload) {
        modes = {
          free_mode: modesPayload.free_mode === true,
          emergency_mode: modesPayload.emergency_mode === true,
          maintenance_mode: modesPayload.maintenance_mode === true,
        }
      }
    } catch {
      /* optional */
    }
  }

  const catalogRevision = liveSyncBus.snapshot().configVersion + 1
  const packet = liveSyncBus.publish('config.channels_changed', {
    topics: ['config'],
    action,
    channelId,
    channel: channelPatch,
    catalog_revision: catalogRevision,
    ...extra,
    ...(modes ? { modes } : {}),
    synced_at: new Date().toISOString(),
  })
  if (packet?.payload && packet.configVersion != null) {
    packet.payload.catalog_revision = packet.configVersion
  }
  // Relay in background so HTTP + local SSE are not gated on PG NOTIFY RTT.
  void notifyApiCacheBust(CHANNEL_CACHE_NAMESPACES)
  void notifyLiveSyncPeers(packet)
  return packet
}
