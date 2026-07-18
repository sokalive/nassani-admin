import assert from 'node:assert/strict'
import {
  classifyAutomaticThreatEnforcement,
  resolveStrictSecurityLevel,
} from '../src/lib/deviceSecurityStore.js'
import { formatReadableDateTime } from '../../src/lib/formatTxDisplay.js'

assert.equal(classifyAutomaticThreatEnforcement({ frida: true }), 'block')
assert.equal(classifyAutomaticThreatEnforcement({ tampered_apk: true }), 'block')
assert.equal(classifyAutomaticThreatEnforcement({ debugger: true }), 'block')
assert.equal(classifyAutomaticThreatEnforcement({ clone_detected: true }), 'block')
assert.equal(classifyAutomaticThreatEnforcement({ rooted: true }), 'smart_monitor')
assert.equal(classifyAutomaticThreatEnforcement({ emulator: true }), 'smart_monitor')
assert.equal(classifyAutomaticThreatEnforcement({}), 'none')
assert.equal(classifyAutomaticThreatEnforcement({ rooted: false }), 'none')

assert.equal(
  resolveStrictSecurityLevel({
    score: 3,
    signals: [{ risk_type: 'dev_client' }],
    flags: {},
    prev: null,
    adminStatus: 'monitoring',
  }),
  'warning',
)

assert.equal(
  resolveStrictSecurityLevel({
    score: 10,
    signals: [{ risk_type: 'frida' }],
    flags: { frida: true },
    prev: null,
    adminStatus: 'monitoring',
  }),
  'blocked',
)

assert.equal(formatReadableDateTime(null), '—')
assert.equal(formatReadableDateTime(undefined), '—')
assert.equal(formatReadableDateTime(0), '—')
assert.equal(formatReadableDateTime(''), '—')
assert.match(formatReadableDateTime('2026-07-18T12:00:00.000Z'), /2026/)

assert.equal(classifyAutomaticThreatEnforcement({ play_app_signing: true }), 'smart_monitor')
assert.equal(
  classifyAutomaticThreatEnforcement({ play_app_signing: true, frida: true }),
  'block',
)

import { computeRiskFromSignals } from '../src/lib/deviceSecurityStore.js'
const play = computeRiskFromSignals([
  { risk_type: 'resigned_apk', risk_score: 8, detail: 'signing_cert_mismatch' },
  { risk_type: 'tampered_apk', risk_score: 8, detail: 're_signed_or_modified' },
])
assert.equal(play.flags.play_app_signing, true)
assert.equal(play.flags.tampered_apk, false)
assert.equal(classifyAutomaticThreatEnforcement(play.flags), 'smart_monitor')

console.log('verify-security-false-positive-policy: PASS')
