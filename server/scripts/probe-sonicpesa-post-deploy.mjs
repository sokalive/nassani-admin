#!/usr/bin/env node
/** Post-deploy SonicPesa probes (no secrets printed). */
const API = process.env.VPS_API || 'https://api.nassanitv.com'
const RENDER = process.env.RENDER_API || 'https://api.nassanitv.com'

async function j(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {
    // keep text
  }
  return { status: res.status, body }
}

async function main() {
  const out = { api: API, probes: [] }
  const health = await j(`${API}/api/health`)
  out.probes.push({ name: 'health', status: health.status, commit: health.body?.commit, pool: health.body?.pool })

  const badSig = await j(`${API}/api/payments/sonicpesa/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sonicpesa-signature': 'deadbeef' },
    body: JSON.stringify({ order_id: 'probe_invalid_sig', payment_status: 'SUCCESS' }),
  })
  out.probes.push({ name: 'invalid_signature', status: badSig.status })

  const empty = await j(`${API}/api/payments/sonicpesa/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  out.probes.push({ name: 'empty_payload', status: empty.status })

  const renderHealth = await j(`${RENDER}/api/health`)
  out.probes.push({
    name: 'render_health',
    status: renderHealth.status,
    commit: renderHealth.body?.commit,
    pool: renderHealth.body?.pool,
  })

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
