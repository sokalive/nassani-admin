#!/usr/bin/env node
/**
 * FINAL CLOSURE AUDIT — VPS-orchestrated read-only entitlement truth.
 * Uses production APIs backed by authoritative Vultr PostgreSQL.
 * Global exact-order lookup: device_subscriptions.transaction_id is UNIQUE,
 * so an active exact match in customer-investigation IS the global anchor row.
 */
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMovedTransactionId } from '../src/lib/paymentOrderRecoveryClassifier.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const API = String(process.env.VPS_API || 'https://api.nassanitv.online').replace(/\/+$/, '')
const TOKEN = String(process.env.ADMIN_TOKEN || '3030').trim()
const PREVIOUS_STRANDED = 99
const PREVIOUS_SM = 146

const headers = { 'X-Admin-Token': TOKEN }

async function apiGet(path) {
  const t0 = Date.now()
  const res = await fetch(`${API}${path}`, { headers, cache: 'no-store' })
  const body = await res.json().catch(() => null)
  return { body, ms: Date.now() - t0 }
}

function maskPhone(p) {
  const d = String(p ?? '').replace(/\D/g, '')
  if (d.length < 6) return '***'
  return `${d.slice(0, 3)}***${d.slice(-3)}`
}

function maskId(id) {
  const s = String(id ?? '')
  if (s.length <= 16) return s
  return `${s.slice(0, 8)}…${s.slice(-6)}`
}

function flattenCustSubs(cust) {
  const s = cust?.subscriptions
  if (!s) return []
  if (Array.isArray(s)) return s
  return [...(s.active ?? []), ...(s.expired ?? [])]
}

function isActiveNow(s) {
  return s?.active_now === true || (String(s?.status).toLowerCase() === 'active' && new Date(s?.expires_at) > new Date())
}

async function fetchAllSystemMigrationOrders() {
  const rows = []
  for (let page = 1; page <= 20; page += 1) {
    const { body } = await apiGet(`/api/admin/payment-orders?status=SUCCESS&limit=500&page=${page}`)
    for (const r of body?.rows ?? []) {
      if (r.recoveryClass === 'SYSTEM_MIGRATION') rows.push(r)
    }
    if (page >= (body?.totalPages ?? 1)) break
  }
  return rows
}

async function main() {
  const tStart = Date.now()
  const health = await apiGet('/api/health')
  const dbReport = await apiGet('/api/runtime/subscription-incident-database-report')
  const wrongDir = await apiGet('/api/runtime/subscription-wrong-direction-audit')
  const poolBefore = health.body?.pool ?? null

  const smOrders = await fetchAllSystemMigrationOrders()
  const wrongVictimOrders = new Set(
    (wrongDir.body?.victims ?? []).map((v) => {
      const p = parseMovedTransactionId(v.transaction_id ?? v.source_transaction_id)
      return String(p.embeddedTransactionId ?? v.embedded_order_id ?? '')
    }),
  )

  const buckets = {}
  const inc = (k) => {
    buckets[k] = (buckets[k] || 0) + 1
  }

  const cases = []
  const phoneCache = new Map()
  let apiMs = 0
  let caseNum = 0

  for (const row of smOrders) {
    caseNum += 1
    const oid = row.orderId
    const payDev = row.deviceId
    const phone = String(row.phone ?? '').trim()
    const moved = parseMovedTransactionId(row.subTransactionId)
    const sourceFuture = row.subExpiresAt && new Date(row.subExpiresAt) > new Date()

    let cust = phoneCache.get(phone)
    if (!cust && phone) {
      const r = await apiGet(`/api/admin/customer-investigation/investigate?phone=${encodeURIComponent(phone)}`)
      apiMs += r.ms
      cust = r.body
      phoneCache.set(phone, cust)
    }

    const allSubs = flattenCustSubs(cust)
    const activeExactGlobal = allSubs.filter((s) => String(s.transaction_id) === oid && isActiveNow(s))
    const movedRows = allSubs.filter((s) => {
      const p = parseMovedTransactionId(s.transaction_id)
      return p.isMoved && p.embeddedTransactionId === oid
    })

    const payments = cust?.payments?.completed ?? []
    const thisPay = payments.find((p) => p.order_id === oid)
    const laterPay = payments
      .filter(
        (p) =>
          p.order_id !== oid &&
          p.status === 'completed' &&
          new Date(p.completed_at || p.created_at) > new Date(thisPay?.completed_at || thisPay?.created_at || 0),
      )
      .sort((a, b) => new Date(a.completed_at || a.created_at) - new Date(b.completed_at || b.created_at))
    const laterActive = laterPay.find((p) =>
      allSubs.some((s) => String(s.transaction_id) === p.order_id && isActiveNow(s)),
    )

    const transfers = [...(cust?.devices ?? []).flatMap((d) => d.transfers ?? [])]
    const hamisha = (cust?.audit_logs?.device_transfers ?? transfers).filter?.(
      (t) => String(t.status) === 'completed',
    ) ?? []

    const adminRevoked =
      Boolean(row.adminRevokedAt) ||
      allSubs.some(
        (s) =>
          String(s.device_id) === payDev &&
          (String(s.status).toLowerCase() === 'revoked' || s.admin_revoked_at),
      )

    const manualGrant = allSubs.some((s) => String(s.transaction_id ?? '').startsWith('manual_grant:'))

    let primary = 'UNKNOWN_NEEDS_HUMAN_REVIEW'
    let confidence = 'low'
    let repairEligible = false
    let expiryStrategy = null
    let proposedDestination = null

    if (activeExactGlobal.length > 0) {
      const tgt = activeExactGlobal[0]
      if (tgt.device_id === payDev) {
        primary = 'ACTIVE_ON_LEGITIMATE_TARGET'
        confidence = 'high'
      } else if (tgt.fingerprint_hash && movedRows[0]?.fingerprint_hash === tgt.fingerprint_hash) {
        primary = 'ACTIVE_ON_LEGITIMATE_TARGET'
        confidence = 'high'
      } else {
        primary = 'ACTIVE_ON_WEAK_TARGET'
        confidence = 'medium'
      }
    } else if (adminRevoked) {
      primary = 'ADMIN_REVOKED'
      confidence = 'high'
    } else if (hamisha.length > 0) {
      primary = 'USER_HAMISHA_TRANSFER'
      confidence = 'medium'
    } else if (manualGrant) {
      primary = 'MANUAL_GRANT_OVERRIDE'
      confidence = 'medium'
    } else if (laterActive) {
      primary = 'SUPERSEDED_BY_LATER_PAYMENT'
      confidence = 'high'
    } else if (!sourceFuture) {
      primary = 'EXPIRED_NORMALLY'
      confidence = 'high'
    } else if (wrongVictimOrders.has(oid)) {
      primary = 'WRONG_DIRECTION_MOVE'
      confidence = 'high'
    } else if (moved.isMoved && sourceFuture) {
      primary = 'STRANDED_FUTURE_ENTITLEMENT_CONFIRMED'
      confidence = 'high'
      repairEligible = true
      proposedDestination = payDev
      expiryStrategy = 'RESTORE_EXISTING_FUTURE_EXPIRY'
    } else {
      primary = 'UNKNOWN_NEEDS_HUMAN_REVIEW'
      confidence = 'low'
    }

    inc(primary)

    cases.push({
      case_id: `SM-${String(caseNum).padStart(3, '0')}`,
      masked_phone: maskPhone(phone),
      order_id: oid,
      payment_device: maskId(payDev),
      source_moved_marker: maskId(row.subTransactionId),
      source_status: row.subStatus,
      source_expires_at: row.subExpiresAt,
      global_exact_active_targets: activeExactGlobal.map((t) => ({
        device: maskId(t.device_id),
        status: t.status,
        expires_at: t.expires_at,
        fingerprint_match: t.fingerprint_hash === movedRows[0]?.fingerprint_hash,
      })),
      moved_row_count_phone_cluster: movedRows.length,
      later_superseding_payment: laterActive?.order_id ?? null,
      hamisha_count: hamisha.length,
      admin_revoked: adminRevoked,
      manual_grant: manualGrant,
      primary_classification: primary,
      confidence,
      repair_eligible: repairEligible,
      proposed_destination: proposedDestination ? maskId(proposedDestination) : null,
      expiry_strategy: expiryStrategy,
      proposed_expiry: repairEligible ? row.subExpiresAt : null,
    })
  }

  const healthAfter = await apiGet('/api/health')
  const reconstructedPredicate = cases.filter((c) => {
    const row = smOrders.find((r) => r.orderId === c.order_id)
    const sourceFuture = row?.subExpiresAt && new Date(row.subExpiresAt) > new Date()
    const moved = parseMovedTransactionId(row?.subTransactionId)
    return (
      moved.isMoved &&
      sourceFuture &&
      !['ACTIVE_ON_LEGITIMATE_TARGET', 'ACTIVE_ON_WEAK_TARGET', 'ADMIN_REVOKED', 'USER_HAMISHA_TRANSFER', 'EXPIRED_NORMALLY', 'SUPERSEDED_BY_LATER_PAYMENT'].includes(
        c.primary_classification,
      )
    )
  })

  const confirmedStranded = cases.filter(
    (c) => c.primary_classification === 'STRANDED_FUTURE_ENTITLEMENT_CONFIRMED',
  )

  const report = {
    generated_at: new Date().toISOString(),
    mode: 'VPS_POSTGRESQL_CLOSURE_VIA_CUSTOMER_INVESTIGATION',
    sql_authority_note:
      'customer-investigation runs live PostgreSQL on Vultr. device_subscriptions.transaction_id is UNIQUE globally — an active exact-order row found in phone-cluster investigation IS the sole global anchor for that order_id. Fingerprint-only devices outside phone/install linkage require direct SELECT (server/scripts/final-sql-closure-audit.mjs on VPS with DATABASE_URL).',
    production_commit: health.body?.commit ?? dbReport.body?.commit,
    previous_candidate_count: PREVIOUS_STRANDED,
    system_migration_total: smOrders.length,
    current_reconstructed_stranded_predicate_count: reconstructedPredicate.length,
    current_confirmed_stranded_count: confirmedStranded.length,
    drift: {
      sm_total_delta: smOrders.length - PREVIOUS_SM,
      stranded_predicate_delta: reconstructedPredicate.length - PREVIOUS_STRANDED,
      confirmed_stranded_delta: confirmedStranded.length - PREVIOUS_STRANDED,
    },
    closure_matrix: {
      previous_candidates: PREVIOUS_STRANDED,
      current_reconstructed_candidates: reconstructedPredicate.length,
      exact_active_target_globally: cases.filter((c) => c.global_exact_active_targets.length > 0).length,
      active_on_legitimate_target: buckets.ACTIVE_ON_LEGITIMATE_TARGET || 0,
      active_on_weak_target: buckets.ACTIVE_ON_WEAK_TARGET || 0,
      indirect_legitimate_target: (buckets.ACTIVE_ON_LEGITIMATE_TARGET || 0) + (buckets.ACTIVE_ON_WEAK_TARGET || 0),
      superseded_by_later_payment: buckets.SUPERSEDED_BY_LATER_PAYMENT || 0,
      user_hamisha: buckets.USER_HAMISHA_TRANSFER || 0,
      admin_force: buckets.ADMIN_FORCE_TRANSFER || 0,
      manual_grant_override: buckets.MANUAL_GRANT_OVERRIDE || 0,
      admin_revoked: buckets.ADMIN_REVOKED || 0,
      expired_normally: buckets.EXPIRED_NORMALLY || 0,
      wrong_direction: buckets.WRONG_DIRECTION_MOVE || 0,
      duplicate_active: buckets.DUPLICATE_ACTIVE || 0,
      confirmed_stranded: confirmedStranded.length,
      unknown_human_review: buckets.UNKNOWN_NEEDS_HUMAN_REVIEW || 0,
    },
    primary_buckets: buckets,
    db_wide: {
      moved_rows: dbReport.body?.subscription_totals?.moved_transfer_sources,
      wrong_direction_victims: dbReport.body?.current_issues?.wrong_direction_victims,
      denied_future_entitlement: dbReport.body?.current_issues?.denied_future_entitlement,
      pool_before: poolBefore,
      pool_after: healthAfter.body?.pool ?? null,
    },
    safe_to_restore: confirmedStranded.map((c) => ({
      case_id: c.case_id,
      order_id: c.order_id,
      destination: c.proposed_destination,
      expiry_strategy: c.expiry_strategy,
      proposed_expiry: c.proposed_expiry,
    })),
    cases,
    total_runtime_ms: Date.now() - tStart,
    investigation_api_ms: apiMs,
    unique_phones_investigated: phoneCache.size,
  }

  const unknown = report.closure_matrix.unknown_human_review
  const stranded = report.closure_matrix.confirmed_stranded
  if (unknown === 0 && stranded > 0) report.final_verdict = 'PARTIAL_PASS'
  else if (unknown > 5) report.final_verdict = 'FAIL'
  else report.final_verdict = 'PARTIAL_PASS'

  report.remaining_sql_gap =
    'Direct workstation DATABASE_URL unavailable. Run on VPS: cd /var/www/nassani-admin/server && node scripts/final-sql-closure-audit.mjs — confirms fingerprint-only global targets outside phone cluster (prior audit: 0).'

  const outPath = resolve(__dir, '../../tmp-sql-closure-report.json')
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify(
      {
        verdict: report.final_verdict,
        sm_total: report.system_migration_total,
        reconstructed: report.current_reconstructed_stranded_predicate_count,
        confirmed_stranded: report.closure_matrix.confirmed_stranded,
        exact_active_global: report.closure_matrix.exact_active_target_globally,
        buckets: report.primary_buckets,
        drift: report.drift,
        out: outPath,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
