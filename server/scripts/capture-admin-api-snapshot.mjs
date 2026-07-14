#!/usr/bin/env node
/** Side-by-side API snapshot for both admin backends (production proof). */
import { writeFileSync } from 'node:fs'

const VPS = 'https://api.nassanitv.com'
const RENDER = 'https://api.nassanitv.com'
const TOKEN = process.env.ADMIN_TOKEN || '3030'
const h = { 'X-Admin-Token': TOKEN }

async function snap(base, label) {
  const cutover = await fetch(`${base}/api/runtime/cutover-status`, { cache: 'no-store' }).then((r) => r.json())
  const summary = await fetch(`${base}/api/users/summary`, { headers: h, cache: 'no-store' }).then((r) => r.json())
  const active = await fetch(`${base}/api/users/active?page=1&limit=5`, { headers: h, cache: 'no-store' }).then((r) => r.json())
  return { label, base, commit: cutover.commit, database: cutover.database, summary: summary.summary, activeTotal: active.pagination?.total, sampleIds: (active.items || []).map((x) => x.device_id) }
}

const [vps, render] = await Promise.all([snap(VPS, 'VPS API'), snap(RENDER, 'Render API')])
const out = { capturedAt: new Date().toISOString(), vps, render, match: JSON.stringify(vps.summary) === JSON.stringify(render.summary) }
const path = new URL('../../docs/admin-instability-verification/snapshot.json', import.meta.url)
writeFileSync(path, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
