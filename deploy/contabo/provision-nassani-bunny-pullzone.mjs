#!/usr/bin/env node
/**
 * Provision a Nassani-owned Bunny Pull Zone for static assets + HLS segment origin-pull.
 *
 * NEVER uses Osmani credentials or Osmani pull zones.
 *
 * Required:
 *   BUNNY_API_KEY          — Nassani Bunny account API key
 *
 * Optional:
 *   BUNNY_PULL_ZONE_NAME   — default nassani-stream
 *   BUNNY_ORIGIN_URL       — default https://api.nassanitv.online
 *   BUNNY_PULL_ORIGIN_SECRET — only set AFTER a Bunny edge rule sends X-Bunny-Origin-Auth
 *
 * Writes JSON summary to stdout (includes CDN hostname + zone id). Does not print the API key.
 *
 * Usage (on Nassani VPS or CI with Nassani secrets only):
 *   BUNNY_API_KEY=... node deploy/contabo/provision-nassani-bunny-pullzone.mjs
 */
import { createHash, randomBytes } from 'node:crypto'

const apiKey = String(process.env.BUNNY_API_KEY || process.env.BUNNY_ACCOUNT_API_KEY || '').trim()
const zoneName = String(process.env.BUNNY_PULL_ZONE_NAME || 'nassani-stream').trim()
const originUrl = String(process.env.BUNNY_ORIGIN_URL || 'https://api.nassanitv.online')
  .trim()
  .replace(/\/+$/, '')
/** Only apply when explicitly provided — empty = origin auth disabled (safe bring-up). */
const originSecret = String(process.env.BUNNY_PULL_ORIGIN_SECRET || '').trim()
const generatePending =
  String(process.env.BUNNY_GENERATE_ORIGIN_SECRET || '').trim() === '1'

if (!apiKey) {
  console.error('ERROR: Set BUNNY_API_KEY to a Nassani Bunny account API key (never Osmani).')
  process.exit(2)
}

if (!/nassani/i.test(zoneName)) {
  console.error('ERROR: Pull zone name must include "nassani" to avoid colliding with other brands.')
  process.exit(2)
}

const headers = {
  AccessKey: apiKey,
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

async function bunny(method, path, body) {
  const res = await fetch(`https://api.bunny.net${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 500) }
  }
  return { ok: res.ok, status: res.status, json }
}

function hostnameFromZone(zone) {
  const host = zone?.Hostnames?.find((h) => h?.Value)?.Value || zone?.Name
  if (!host) return ''
  if (String(host).includes('.')) return `https://${host}`.replace(/\/+$/, '')
  return `https://${host}.b-cdn.net`
}

const listed = await bunny('GET', '/pullzone?perPage=1000')
if (!listed.ok) {
  console.error('ERROR: Bunny list pull zones failed', listed.status, listed.json)
  process.exit(1)
}

const items = Array.isArray(listed.json) ? listed.json : listed.json?.Items || []
for (const z of items) {
  const blob = JSON.stringify(z).toLowerCase()
  if (blob.includes('osmani')) {
    console.error(
      'ERROR: Bunny account appears to contain Osmani zones — aborting. Use a Nassani-only Bunny account.',
    )
    process.exit(3)
  }
}

let zone = items.find((z) => String(z?.Name || '').toLowerCase() === zoneName.toLowerCase())
let created = false

if (!zone) {
  const createdRes = await bunny('POST', '/pullzone', {
    Name: zoneName,
    OriginUrl: originUrl,
    Type: 0,
    EnableGeoZoneUS: true,
    EnableGeoZoneEU: true,
    EnableGeoZoneASIA: true,
    EnableGeoZoneSA: true,
    EnableGeoZoneAF: true,
    OriginConnectTimeout: 10,
    OriginResponseTimeout: 30,
    CacheControlMaxAgeOverride: 86400,
  })
  if (!createdRes.ok) {
    console.error('ERROR: create pull zone failed', createdRes.status, createdRes.json)
    process.exit(1)
  }
  zone = createdRes.json
  created = true
}

const zoneId = zone?.Id
if (!zoneId) {
  console.error('ERROR: missing pull zone id', zone)
  process.exit(1)
}

if (String(zone.OriginUrl || '').replace(/\/+$/, '') !== originUrl) {
  const upd = await bunny('POST', `/pullzone/${zoneId}`, {
    OriginUrl: originUrl,
  })
  if (!upd.ok) {
    console.error('ERROR: update OriginUrl failed', upd.status, upd.json)
    process.exit(1)
  }
  zone = upd.json || zone
}

const pendingOriginSecret = generatePending ? randomBytes(24).toString('hex') : ''
const cdnBase = hostnameFromZone(zone)
const summary = {
  ok: true,
  created,
  pull_zone_id: zoneId,
  pull_zone_name: zone?.Name || zoneName,
  cdn_base_url: cdnBase,
  origin_url: originUrl,
  origin_auth_note:
    'Leave BUNNY_PULL_ORIGIN_SECRET empty until a Bunny edge rule sends X-Bunny-Origin-Auth.',
  origin_secret_fingerprint: originSecret
    ? createHash('sha256').update(originSecret).digest('hex').slice(0, 12)
    : null,
  pending_origin_secret_for_manual_edge_rule: pendingOriginSecret || null,
  env: {
    BUNNY_CDN_BASE_URL: cdnBase,
    BUNNY_STREAM_CDN_BASE_URL: cdnBase,
    BUNNY_PULL_ZONE_ID: String(zoneId),
    BUNNY_STREAM_SEGMENT_PATH: 'hls/seg',
    ...(originSecret ? { BUNNY_PULL_ORIGIN_SECRET: originSecret } : {}),
  },
}

console.log(JSON.stringify(summary, null, 2))
