/**
 * Measure Admin write → SSE event latency (subscription-stream + sync/stream).
 *
 *   ADMIN_API_TOKEN=... node scripts/verify-instant-sync.mjs
 *   API_BASE=https://api.nassanitv.online ADMIN_API_TOKEN=... node scripts/verify-instant-sync.mjs
 */
const API_BASE = String(process.env.API_BASE || process.env.RENDER_API || 'https://api.nassanitv.online').replace(
  /\/$/,
  '',
)
const TOKEN = String(process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || '').trim()
const LATENCY_BUDGET_MS = Number(process.env.SYNC_LATENCY_BUDGET_MS || 1500)

function authHeaders(json = true) {
  const h = { Accept: 'application/json' }
  if (TOKEN) h['X-Admin-Token'] = TOKEN
  if (json) h['Content-Type'] = 'application/json'
  return h
}

async function openSse(url, { wantEvents, timeoutMs = 25_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const seen = []
  const waiters = new Map()

  const res = await fetch(url, {
    headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-store' },
    signal: controller.signal,
  })
  if (!res.ok) throw new Error(`SSE ${url} → HTTP ${res.status}`)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('SSE missing body')

  const decoder = new TextDecoder()
  let buffer = ''
  let closed = false

  const pump = (async () => {
    try {
      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''
        for (const chunk of chunks) {
          const evMatch = chunk.match(/^event:\s*(.+)$/m)
          const dataMatch = chunk.match(/^data:\s*(.*)$/m)
          if (!evMatch) continue
          const event = evMatch[1].trim()
          let data = null
          try {
            data = dataMatch ? JSON.parse(dataMatch[1]) : null
          } catch {
            data = dataMatch?.[1] ?? null
          }
          const row = { event, data, at: Date.now() }
          seen.push(row)
          for (const [key, w] of waiters) {
            if (w.match(row)) {
              waiters.delete(key)
              w.resolve(row)
            }
          }
        }
      }
    } catch (e) {
      if (!closed && e?.name !== 'AbortError') {
        for (const [, w] of waiters) w.reject(e)
      }
    }
  })()

  async function waitFor(matchFn, label, { ms = 12_000, afterAt = 0 } = {}) {
    for (const row of seen) {
      if (row.at > afterAt && matchFn(row)) return row
    }
    return new Promise((resolve, reject) => {
      const key = `${label}-${Math.random().toString(36).slice(2)}`
      const t = setTimeout(() => {
        waiters.delete(key)
        reject(new Error(`timeout waiting for ${label}`))
      }, ms)
      waiters.set(key, {
        match: (row) => row.at > afterAt && matchFn(row),
        resolve: (row) => {
          clearTimeout(t)
          resolve(row)
        },
        reject: (err) => {
          clearTimeout(t)
          reject(err)
        },
      })
    })
  }

  async function close() {
    closed = true
    clearTimeout(timer)
    try {
      await reader.cancel()
    } catch {
      /* ignore */
    }
    controller.abort()
    await pump.catch(() => {})
  }

  // Wait until snapshot / first useful event so we know the stream is live.
  if (wantEvents?.length) {
    await waitFor((r) => wantEvents.includes(r.event), 'sse-ready', { ms: 10_000 })
  }

  return { waitFor, close, seen }
}

async function adminJson(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: authHeaders(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
  }
  return json
}

async function measure(label, mutate, expectEvent) {
  const sub = await openSse(`${API_BASE}/api/subscription-stream?device_id=instant-sync-probe`, {
    wantEvents: ['snapshot', 'app_modes', 'app_settings_changed'],
  })
  const sync = await openSse(`${API_BASE}/api/sync/stream?topics=config`, {
    wantEvents: ['snapshot', 'app_modes', 'app_settings_changed'],
  })

  const t0 = Date.now()
  let mutationDoneAt = 0
  const mutationPromise = Promise.resolve()
    .then(() => mutate())
    .then((m) => {
      mutationDoneAt = Date.now()
      return m
    })
  const [subHit, syncHit, mutation] = await Promise.all([
    sub.waitFor(expectEvent, `${label}-sub`, { afterAt: t0 }),
    sync.waitFor(expectEvent, `${label}-sync`, { afterAt: t0 }),
    mutationPromise,
  ])
  const subMs = subHit.at - t0
  const syncMs = syncHit.at - t0
  const mutationMs = mutationDoneAt ? mutationDoneAt - t0 : null
  // Fan-out delay after the write finished (true sync latency).
  const subAfterWriteMs = mutationDoneAt ? Math.max(0, subHit.at - mutationDoneAt) : subMs
  const syncAfterWriteMs = mutationDoneAt ? Math.max(0, syncHit.at - mutationDoneAt) : syncMs

  const getProof = mutation?.getProof ? await mutation.getProof() : null

  await sub.close()
  await sync.close()

  const ok =
    subAfterWriteMs <= LATENCY_BUDGET_MS &&
    syncAfterWriteMs <= LATENCY_BUDGET_MS &&
    (getProof == null || getProof.ok === true)

  return {
    label,
    ok,
    subMs,
    syncMs,
    mutationMs,
    subAfterWriteMs,
    syncAfterWriteMs,
    budgetMs: LATENCY_BUDGET_MS,
    getProof,
    mutationId: mutation?.id ?? null,
    cleanup: mutation?.cleanup,
  }
}

async function main() {
  console.log('=== INSTANT REALTIME SYNC VERIFICATION ===')
  console.log('API_BASE=', API_BASE)
  console.log('TOKEN=', TOKEN ? 'set' : 'MISSING')
  if (!TOKEN) {
    console.error('ADMIN_API_TOKEN required')
    process.exit(1)
  }

  const results = []
  const cleanups = []

  // Banner create → SSE
  results.push(
    await measure(
      'banner_create',
      async () => {
        const row = await adminJson('POST', '/api/banners', {
          title: `Instant Sync ${Date.now()}`,
          description: 'verify',
          image: `https://picsum.photos/seed/instant${Date.now()}/1280/720`,
          active: true,
          enabled: true,
        })
        const id = row?.id
        cleanups.push(async () => {
          if (id != null) await adminJson('DELETE', `/api/banners/${id}`).catch(() => {})
        })
        return {
          id,
          getProof: async () => {
            const list = await fetch(`${API_BASE}/api/banners`, { cache: 'no-store' }).then((r) => r.json())
            const hit = Array.isArray(list) && list.some((b) => Number(b.id) === Number(id))
            return { ok: hit, detail: hit ? 'banner visible on GET' : 'banner missing on GET' }
          },
        }
      },
      (r) =>
        r.event === 'banners_changed' ||
        r.event === 'banner_updated' ||
        (r.event === 'catalog_refresh' && String(r.data?.event || '').includes('banners')),
    ),
  )

  // Channel create → SSE
  results.push(
    await measure(
      'channel_create',
      async () => {
        const row = await adminJson('POST', '/api/channels', {
          name: `Instant Sync Ch ${Date.now()}`,
          url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
          category: 'Home',
          is_active: true,
          show_in_app: true,
          access_type: 'free',
          player_type: 'direct_hls',
        })
        const id = row?.id
        const cleanupFn = async () => {
          if (id != null) await adminJson('DELETE', `/api/channels/${id}`).catch(() => {})
        }
        cleanupFn._channelId = id
        cleanups.push(cleanupFn)
        return {
          id,
          getProof: async () => {
            const list = await fetch(`${API_BASE}/api/channels`, { cache: 'no-store' }).then((r) => r.json())
            const hit = Array.isArray(list) && list.some((c) => Number(c.id) === Number(id))
            return { ok: hit, detail: hit ? 'channel visible on GET' : 'channel missing on GET' }
          },
        }
      },
      (r) =>
        r.event === 'channels_changed' ||
        r.event === 'channels_catalog' ||
        (r.event === 'catalog_refresh' && String(r.data?.event || '').includes('channels')),
    ),
  )

  // Channel delete → SSE
  const createdChannel = results.find((r) => r.label === 'channel_create')
  if (createdChannel?.mutationId != null && createdChannel.ok) {
    const delId = createdChannel.mutationId
    // Prevent double-delete in final cleanup
    for (let i = cleanups.length - 1; i >= 0; i--) {
      if (cleanups[i]._channelId === delId) cleanups.splice(i, 1)
    }
    results.push(
      await measure(
        'channel_delete',
        async () => {
          await adminJson('DELETE', `/api/channels/${delId}`)
          return {
            id: delId,
            getProof: async () => {
              const list = await fetch(`${API_BASE}/api/channels`, { cache: 'no-store' }).then((r) => r.json())
              const gone = !Array.isArray(list) || !list.some((c) => Number(c.id) === Number(delId))
              return { ok: gone, detail: gone ? 'channel removed from GET' : 'channel still present' }
            },
          }
        },
        (r) =>
          r.event === 'channels_changed' ||
          r.event === 'channels_catalog' ||
          (r.event === 'catalog_refresh' && String(r.data?.event || '').includes('channels')),
      ),
    )
  }

  // Settings modes → SSE (toggle freeMode then restore)
  const modesBefore = await adminJson('GET', '/api/settings')
  const freeBefore = modesBefore?.freeMode === true || modesBefore?.free_mode === true
  results.push(
    await measure(
      'settings_modes',
      async () => {
        const next = {
          freeMode: !freeBefore,
          emergencyMode: modesBefore?.emergencyMode === true || modesBefore?.emergency_mode === true,
          maintenanceMode: modesBefore?.maintenanceMode === true || modesBefore?.maintenance_mode === true,
        }
        await adminJson('PUT', '/api/settings', next)
        cleanups.push(async () => {
          await adminJson('PUT', '/api/settings', {
            freeMode: freeBefore,
            emergencyMode: next.emergencyMode,
            maintenanceMode: next.maintenanceMode,
          }).catch(() => {})
        })
        return {
          id: null,
          getProof: async () => {
            const cur = await fetch(`${API_BASE}/api/runtime/app-modes`, { cache: 'no-store' }).then((r) =>
              r.json(),
            )
            const flipped = (cur?.free_mode === true) === !freeBefore
            return { ok: flipped, detail: flipped ? 'modes flipped' : `modes unchanged ${JSON.stringify(cur)}` }
          },
        }
      },
      (r) =>
        (r.event === 'app_modes' || r.event === 'app_settings_changed') &&
        r.data &&
        (r.data.free_mode === true) === !freeBefore,
    ),
  )

  // Home logos reorder (if any exist)
  try {
    const logos = await fetch(`${API_BASE}/api/home-logos`, { cache: 'no-store' }).then((r) => r.json())
    if (Array.isArray(logos) && logos.length > 1) {
      results.push(
        await measure(
          'home_logos_reorder',
          async () => {
            const original = logos.map((l, i) => ({ id: l.id, sortOrder: i }))
            const rotated = [...logos.slice(1), logos[0]].map((l, i) => ({ id: l.id, sortOrder: i }))
            await adminJson('POST', '/api/home-logos/reorder', { orders: rotated })
            cleanups.push(async () => {
              await adminJson('POST', '/api/home-logos/reorder', { orders: original }).catch(() => {})
            })
            return { id: rotated[0]?.id }
          },
          (r) =>
            r.event === 'home_logos_changed' ||
            (r.event === 'catalog_refresh' && String(r.data?.event || '').includes('home_logos')),
        ),
      )
    } else {
      results.push({ label: 'home_logos_reorder', ok: true, skipped: true, detail: 'need 2+ logos' })
    }
  } catch (e) {
    results.push({ label: 'home_logos_reorder', ok: false, detail: String(e.message || e) })
  }

  for (const fn of cleanups.reverse()) {
    try {
      await fn()
    } catch {
      /* ignore */
    }
  }

  console.log(JSON.stringify({ results }, null, 2))
  const tested = results.filter((r) => !r.skipped)
  const ok = tested.length > 0 && tested.every((r) => r.ok)
  console.log(`\nRESULT: ${ok ? 'PASS' : 'FAIL'} (budget ${LATENCY_BUDGET_MS}ms)`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
