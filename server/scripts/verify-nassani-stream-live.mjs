/**
 * Live verification of Nassani stream architecture (Nassani API only).
 *
 *   API_BASE=https://api.nassanitv.online node server/scripts/verify-nassani-stream-live.mjs
 */
import assert from 'node:assert/strict'

const API = String(process.env.API_BASE || 'https://api.nassanitv.online').replace(/\/+$/, '')

async function getJson(path) {
  const res = await fetch(`${API}${path}`)
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json, text }
}

const health = await getJson('/api/health')
assert.equal(health.json?.ok, true, 'health ok')
assert.equal(health.json?.service, 'nassani-admin-api', 'nassani service only')
console.log('health', { commit: health.json.commit, service: health.json.service })

const sd = await getJson('/api/health/stream-delivery')
assert.equal(sd.status, 200, 'stream-delivery 200')
assert.equal(sd.json?.signing_configured, true, 'signing configured')
assert.equal(sd.json?.routes?.bunny_segment_origin, '/hls/seg', 'origin path')
console.log('stream-delivery', {
  mode: sd.json.stream_delivery_mode,
  signing: sd.json.signing_configured,
  seg: sd.json.segments?.stream_segment_delivery,
  bunny: sd.json.segments?.bunny_stream_cdn_base,
  offload: sd.json.segments?.production_segment_offload_active,
  origin: sd.json.routes?.bunny_segment_origin,
})

const ch = await getJson('/api/channels')
assert.ok(Array.isArray(ch.json) && ch.json.length > 0, 'channels list')

const byId = Object.fromEntries(ch.json.map((c) => [String(c.id), c]))
const sports = byId['2']
if (sports) {
  const pu = String(sports.playbackUrl || '')
  assert.ok(!pu.includes('/stream-direct'), 'html player channel must stay upstream (not stream-direct)')
  console.log('channel2_sports_ok', { host: (() => { try { return new URL(pu).host } catch { return '' } })() })
}

const hlsIds = ['3', '4', '5']
let played = 0
for (const id of hlsIds) {
  const c = byId[id]
  if (!c) continue
  const pu = String(c.playbackUrl || '')
  if (!pu.includes('/stream-direct')) {
    console.log(`channel${id}_skip`, 'playbackUrl not stream-direct yet')
    continue
  }
  const manifest = await fetch(pu)
  const body = await manifest.text()
  assert.equal(manifest.status, 200, `manifest ${id} status`)
  assert.ok(body.includes('#EXTM3U'), `manifest ${id} EXTM3U`)
  const hasProxy = body.includes('/stream-proxy')
  const hasBunny = /b-cdn\.net\/hls\/seg/.test(body)
  assert.ok(hasProxy || hasBunny, `manifest ${id} rewritten segments`)
  console.log(`channel${id}_hls_ok`, {
    status: manifest.status,
    bytes: body.length,
    proxy_segs: hasProxy,
    bunny_segs: hasBunny,
  })
  played += 1
}

assert.ok(played >= 1, 'at least one HLS canary must play via stream-direct')
console.log('verify-nassani-stream-live: OK', { played })
