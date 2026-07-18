/**
 * E2E: Manual Subscription + Security PIN + Force Transfer PIN enforcement.
 *
 *   ADMIN_API_TOKEN=... node scripts/verify-security-pin-e2e.mjs
 *   API_BASE=https://api.nassanitv.online ADMIN_API_TOKEN=... node scripts/verify-security-pin-e2e.mjs
 *
 * Does NOT print PIN values from the server. Tests operational PIN 3030 vs wrong/missing.
 */
const API = String(process.env.API_BASE || 'https://api.nassanitv.online').replace(/\/$/, '')
const TOKEN = String(process.env.ADMIN_API_TOKEN || process.env.ADMIN_TOKEN || '').trim()
const GOOD_PIN = String(process.env.TEST_SECURITY_PIN || '3030').trim()
const BAD_PIN = '0000-wrong-pin'

function headers(json = true) {
  const h = { Accept: 'application/json' }
  if (TOKEN) h['X-Admin-Token'] = TOKEN
  if (json) h['Content-Type'] = 'application/json'
  return h
}

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return { status: res.status, json }
}

function assert(cond, label, detail) {
  if (!cond) throw new Error(`FAIL ${label}: ${detail || ''}`)
  console.log(`PASS ${label}`)
}

async function main() {
  console.log('=== SECURITY PIN E2E ===')
  console.log('API=', API)
  console.log('TOKEN=', TOKEN ? 'set' : 'MISSING')
  if (!TOKEN) process.exit(1)

  const deviceId = `pin-e2e-${Date.now()}`
  const results = []

  // --- Manual grant: missing / wrong / correct PIN ---
  {
    const missing = await req('POST', '/api/admin/manual-subscription/grant', {
      device_id: deviceId,
      duration_days: 1,
      phone: '255700000001',
    })
    assert(missing.status === 400 || missing.status === 403, 'grant_missing_pin', `status=${missing.status}`)
    results.push({ case: 'grant_missing_pin', status: missing.status })

    const wrong = await req('POST', '/api/admin/manual-subscription/grant', {
      device_id: deviceId,
      duration_days: 1,
      phone: '255700000001',
      security_pin: BAD_PIN,
    })
    assert(wrong.status === 403, 'grant_wrong_pin', `status=${wrong.status}`)
    results.push({ case: 'grant_wrong_pin', status: wrong.status })

    const ok = await req('POST', '/api/admin/manual-subscription/grant', {
      device_id: deviceId,
      duration_days: 1,
      phone: '255700000001',
      security_pin: GOOD_PIN,
    })
    assert(ok.status === 200 || ok.status === 201, 'grant_good_pin', `status=${ok.status} ${JSON.stringify(ok.json).slice(0, 120)}`)
    results.push({ case: 'grant_good_pin', status: ok.status, grantId: ok.json?.grantId })

    // App-facing status
    const st = await req('GET', `/api/subscription-status?device_id=${encodeURIComponent(deviceId)}`)
    const active = st.json?.isActive === true || st.json?.active === true
    assert(active, 'grant_subscription_active', JSON.stringify(st.json).slice(0, 200))
    results.push({ case: 'grant_subscription_active', active })
  }

  // --- Single block: requires security PIN ---
  {
    const bypass = await req('POST', '/api/admin/manual-subscription/block', { device_id: deviceId })
    assert(bypass.status === 400 || bypass.status === 403, 'block_missing_pin', `status=${bypass.status}`)
    results.push({ case: 'block_missing_pin', status: bypass.status })

    const wrong = await req('POST', '/api/admin/manual-subscription/block', {
      device_id: deviceId,
      security_pin: BAD_PIN,
    })
    assert(wrong.status === 403, 'block_wrong_pin', `status=${wrong.status}`)

    const ok = await req('POST', '/api/admin/manual-subscription/block', {
      device_id: deviceId,
      security_pin: GOOD_PIN,
    })
    assert(ok.status === 200, 'block_good_pin', `status=${ok.status}`)

    const un = await req('POST', '/api/admin/manual-subscription/unblock', {
      device_id: deviceId,
      security_pin: GOOD_PIN,
    })
    assert(un.status === 200, 'unblock_good_pin', `status=${un.status}`)
  }

  // --- Force transfer (Device Control): missing/wrong PIN ---
  {
    const missing = await req('POST', '/api/transfer/admin-force-phone', {
      from_phone: '255700000099',
      to_device_id: `${deviceId}-tgt`,
    })
    assert(missing.status === 400 || missing.status === 403, 'force_transfer_missing_pin', `status=${missing.status}`)

    const wrong = await req('POST', '/api/transfer/admin-force-phone', {
      from_phone: '255700000099',
      to_device_id: `${deviceId}-tgt`,
      security_pin: BAD_PIN,
    })
    assert(wrong.status === 403, 'force_transfer_wrong_pin', `status=${wrong.status}`)
  }

  // --- Customer investigation force-transfer must require PIN ---
  {
    const bypass = await req('POST', '/api/admin/customer-investigation/actions/force-transfer', {
      confirm: true,
      payment_phone: '255700000099',
      target_device_id: `${deviceId}-inv`,
    })
    assert(
      bypass.status === 400 || bypass.status === 403,
      'investigation_force_transfer_missing_pin',
      `status=${bypass.status}`,
    )

    const wrong = await req('POST', '/api/admin/customer-investigation/actions/force-transfer', {
      confirm: true,
      payment_phone: '255700000099',
      target_device_id: `${deviceId}-inv`,
      security_pin: BAD_PIN,
    })
    assert(wrong.status === 403, 'investigation_force_transfer_wrong_pin', `status=${wrong.status}`)
  }

  // --- Security Center: mutations need unlock token or PIN ---
  {
    const bypass = await req('POST', '/api/security/devices/bulk-action', {
      action: 'unblock_user',
      device_ids: [deviceId],
    })
    assert(
      bypass.status === 400 || bypass.status === 403,
      'security_bulk_missing_capability',
      `status=${bypass.status}`,
    )

    const withPin = await req('POST', '/api/security/devices/bulk-action', {
      action: 'unblock_user',
      device_ids: [deviceId],
      security_pin: GOOD_PIN,
    })
    assert(withPin.status !== 403, 'security_bulk_good_pin_not_rejected', `status=${withPin.status}`)
    results.push({ case: 'security_bulk_with_pin', status: withPin.status })
  }

  // Cleanup: delete grant history if we have an id (requires PIN)
  const grantId = results.find((r) => r.case === 'grant_good_pin')?.grantId
  if (grantId) {
    await req('DELETE', `/api/admin/manual-subscription/history/${grantId}`, { security_pin: GOOD_PIN })
  }

  console.log(JSON.stringify({ results }, null, 2))
  console.log('RESULT: PASS')
}

main().catch((e) => {
  console.error(e)
  console.log('RESULT: FAIL')
  process.exit(1)
})
