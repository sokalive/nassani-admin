#!/usr/bin/env node
/**
 * FINAL CLOSURE AUDIT — direct Vultr PostgreSQL read-only global entitlement truth.
 * SELECT only. No mutations.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { parseMovedTransactionId } from '../src/lib/paymentOrderRecoveryClassifier.js'

const __dir = dirname(fileURLToPath(import.meta.url))
for (const p of [resolve(__dir, '../.env'), resolve(__dir, '../../.env')]) {
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  break
}

const url = String(process.env.DATABASE_URL || '').trim()
if (!url) {
  console.error('DATABASE_URL required')
  process.exit(2)
}

const { Pool } = pg
const pool = new Pool({
  connectionString: url,
  ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
})

const PREVIOUS_STRANDED = 99
const PREVIOUS_SM = 146

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

function parseDate(v) {
  if (v == null || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function isActiveSub(row) {
  const st = String(row?.status ?? '').toLowerCase()
  const exp = parseDate(row?.expires_at)
  return st === 'active' && exp != null && exp.getTime() > Date.now()
}

function isFutureExpiry(row) {
  const exp = parseDate(row?.expires_at)
  return exp != null && exp.getTime() > Date.now()
}

async function q(client, sql, params = []) {
  const t0 = Date.now()
  const res = await client.query(sql, params)
  return { rows: res.rows, ms: Date.now() - t0 }
}

async function main() {
  const client = await pool.connect()
  const timings = []
  let poolBefore = null
  let poolAfter = null

  try {
    await client.query('BEGIN READ ONLY')

    const pb = await q(client, `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`)
    poolBefore = { active_connections: pb.rows[0]?.n ?? null }

    const smSql = `
      SELECT
        t.order_id,
        t.device_id AS payment_device_id,
        t.phone,
        t.status AS txn_status,
        t.plan_id,
        t.amount,
        t.created_at,
        t.completed_at,
        t.recovery_state,
        t.raw_payload,
        ds.status AS source_status,
        ds.expires_at AS source_expires_at,
        ds.transaction_id AS source_transaction_id,
        ds.admin_revoked_at,
        ds.admin_revoked_by,
        ds.admin_revocation_reason,
        ds.admin_revoked_transaction_id,
        ds.fingerprint_hash AS source_fingerprint
      FROM transactions t
      JOIN device_subscriptions ds ON ds.device_id = t.device_id
      WHERE t.plan_id IS NOT NULL
        AND t.status = 'completed'
        AND COALESCE(UPPER(t.recovery_state), '') NOT IN ('MANUALLY_APPROVED', 'RECOVERY_REJECTED', 'RECOVERY_BLOCKED')
        AND ds.transaction_id LIKE 'moved:%'
      ORDER BY t.completed_at DESC NULLS LAST, t.order_id
    `
    const smRes = await q(client, smSql)
    timings.push({ name: 'system_migration_base', ms: smRes.ms })

    const smOrders = []
    for (const row of smRes.rows) {
      const moved = parseMovedTransactionId(row.source_transaction_id)
      if (!moved.isMoved || moved.malformed) continue
      if (String(moved.embeddedTransactionId ?? '').trim() !== String(row.order_id).trim()) continue
      smOrders.push({ ...row, moved_source_device_id: moved.sourceDeviceId })
    }

    const orderIds = [...new Set(smOrders.map((r) => r.order_id))]
    const paymentDevices = [...new Set(smOrders.map((r) => r.payment_device_id))]

    const exactRes = await q(
      client,
      `SELECT device_id, status, transaction_id, expires_at,
              admin_revoked_at, admin_revoked_by, admin_revocation_reason, admin_revoked_transaction_id,
              fingerprint_hash, started_at, updated_at
       FROM device_subscriptions
       WHERE transaction_id = ANY($1::text[])`,
      [orderIds],
    )
    timings.push({ name: 'global_exact_order_targets', ms: exactRes.ms, rows: exactRes.rows.length })

    const exactByOrder = new Map()
    for (const row of exactRes.rows) {
      const oid = row.transaction_id
      if (!exactByOrder.has(oid)) exactByOrder.set(oid, [])
      exactByOrder.get(oid).push(row)
    }

    const movedRes = await q(
      client,
      `SELECT device_id, status, transaction_id, expires_at,
              admin_revoked_at, admin_revoked_by, admin_revocation_reason, admin_revoked_transaction_id
       FROM device_subscriptions
       WHERE transaction_id LIKE 'moved:%'`,
    )
    timings.push({ name: 'global_moved_markers', ms: movedRes.ms, rows: movedRes.rows.length })

    const movedByOrder = new Map()
    for (const row of movedRes.rows) {
      const p = parseMovedTransactionId(row.transaction_id)
      if (!p.isMoved || p.malformed) continue
      const oid = String(p.embeddedTransactionId ?? '').trim()
      if (!oid) continue
      if (!movedByOrder.has(oid)) movedByOrder.set(oid, [])
      movedByOrder.get(oid).push({ ...row, parsed_source: p.sourceDeviceId })
    }

    const txnRes = await q(
      client,
      `SELECT order_id, device_id, phone, status, plan_id, amount, created_at, completed_at, recovery_state,
              raw_payload
       FROM transactions
       WHERE order_id = ANY($1::text[])
          OR (device_id = ANY($2::text[]) AND status = 'completed' AND plan_id IS NOT NULL)
       ORDER BY device_id, created_at ASC`,
      [orderIds, paymentDevices],
    )
    timings.push({ name: 'transaction_lineage', ms: txnRes.ms, rows: txnRes.rows.length })

    const txnsByOrder = new Map()
    const txnsByDevice = new Map()
    for (const row of txnRes.rows) {
      if (!txnsByOrder.has(row.order_id)) txnsByOrder.set(row.order_id, row)
      const d = row.device_id
      if (!txnsByDevice.has(d)) txnsByDevice.set(d, [])
      txnsByDevice.get(d).push(row)
    }

    const xferRes = await q(
      client,
      `SELECT id, source_device_id, target_device_id, status, created_at, completed_at, reason
       FROM device_transfers
       WHERE source_device_id = ANY($1::text[]) OR target_device_id = ANY($1::text[])`,
      [paymentDevices],
    )
    timings.push({ name: 'device_transfers', ms: xferRes.ms, rows: xferRes.rows.length })

    const xferByDevice = new Map()
    for (const row of xferRes.rows) {
      for (const d of [row.source_device_id, row.target_device_id]) {
        if (!xferByDevice.has(d)) xferByDevice.set(d, [])
        xferByDevice.get(d).push(row)
      }
    }

    const lineageRes = await q(
      client,
      `SELECT device_id, status, transaction_id, expires_at,
              admin_revoked_at, admin_revocation_reason, admin_revoked_transaction_id
       FROM device_subscriptions
       WHERE transaction_id LIKE 'transfer:%'
          OR transaction_id LIKE 'force:%'
          OR transaction_id LIKE 'manual_grant:%'
          OR transaction_id LIKE 'recovery:%'`,
    )
    timings.push({ name: 'indirect_lineage_markers', ms: lineageRes.ms, rows: lineageRes.rows.length })

    const subsByDevice = new Map()
    const deviceUnion = [...new Set([
      ...paymentDevices,
      ...exactRes.rows.map((r) => r.device_id),
      ...xferRes.rows.flatMap((r) => [r.source_device_id, r.target_device_id]),
    ])]
    const devSubRes = await q(
      client,
      `SELECT device_id, status, transaction_id, expires_at,
              admin_revoked_at, admin_revoked_by, admin_revocation_reason, admin_revoked_transaction_id,
              fingerprint_hash
       FROM device_subscriptions
       WHERE device_id = ANY($1::text[])`,
      [deviceUnion],
    )
    timings.push({ name: 'device_subscriptions_cluster', ms: devSubRes.ms })
    for (const row of devSubRes.rows) subsByDevice.set(row.device_id, row)

    let revokeActions = { rows: [] }
    try {
      revokeActions = await q(
        client,
        `SELECT device_id, order_id, reason, created_at, revoked_transaction_id
         FROM admin_subscription_revocation_actions
         WHERE device_id = ANY($1::text[]) OR order_id = ANY($2::text[])`,
        [paymentDevices, orderIds],
      )
      timings.push({ name: 'admin_revocation_actions', ms: revokeActions.ms })
    } catch {
      revokeActions = { rows: [] }
    }

    let manualGrants = { rows: [] }
    try {
      manualGrants = await q(
        client,
        `SELECT device_id, plan_id, created_at, expires_at_snapshot, created_by, deleted_at
         FROM manual_subscription_grants
         WHERE device_id = ANY($1::text[]) AND deleted_at IS NULL`,
        [deviceUnion],
      )
      timings.push({ name: 'manual_grants', ms: manualGrants.ms })
    } catch {
      manualGrants = { rows: [] }
    }

    let recoveryActions = { rows: [] }
    try {
      recoveryActions = await q(
        client,
        `SELECT order_id, action, device_id, created_at, sms_sent
         FROM admin_payment_recovery_actions
         WHERE order_id = ANY($1::text[])`,
        [orderIds],
      )
      timings.push({ name: 'admin_payment_recovery_actions', ms: recoveryActions.ms })
    } catch {
      recoveryActions = { rows: [] }
    }

    let wrongDir = []
    try {
      const wd = await q(
        client,
        `SELECT ds.device_id, ds.transaction_id, ds.status, ds.expires_at
         FROM device_subscriptions ds
         WHERE ds.transaction_id LIKE 'moved:%'
           AND EXISTS (
             SELECT 1 FROM device_subscriptions tgt
             WHERE tgt.transaction_id = split_part(ds.transaction_id, ':', 3)
               AND tgt.device_id = split_part(ds.transaction_id, ':', 2)
               AND tgt.status = 'active'
               AND tgt.expires_at > now()
           )
           AND split_part(ds.transaction_id, ':', 2) <> ds.device_id`,
      )
      wrongDir = wd.rows
      timings.push({ name: 'wrong_direction_scan', ms: wd.ms })
    } catch {
      wrongDir = []
    }

    await client.query('ROLLBACK')

    const pa = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`)
    poolAfter = { active_connections: pa.rows[0]?.n ?? null }

    const priorStrandedIds = new Set()
    for (const row of smOrders) {
      const oid = row.order_id
      const sourceActiveExact =
        isActiveSub({ status: row.source_status, expires_at: row.source_expires_at }) &&
        String(row.source_transaction_id).trim() === oid
      if (sourceActiveExact) continue
      if (!isFutureExpiry({ expires_at: row.source_expires_at })) continue
      const adminRevoked =
        row.admin_revoked_at != null &&
        (String(row.admin_revoked_transaction_id ?? '') === oid ||
          String(row.admin_revocation_reason ?? '').toLowerCase().includes('revoke'))
      if (adminRevoked) continue
      const xfers = xferByDevice.get(row.payment_device_id) ?? []
      const hamisha = xfers.find(
        (x) =>
          x.status === 'completed' &&
          x.source_device_id === row.payment_device_id &&
          parseDate(x.completed_at)?.getTime() >=
            (parseDate(row.completed_at) ?? parseDate(row.created_at))?.getTime(),
      )
      if (hamisha) {
        const tgt = subsByDevice.get(hamisha.target_device_id)
        const txn = String(tgt?.transaction_id ?? '')
        if (txn.startsWith('transfer:') || txn.startsWith('force:')) continue
      }
      priorStrandedIds.add(oid)
    }

    const buckets = {}
    const inc = (k) => {
      buckets[k] = (buckets[k] || 0) + 1
    }

    const cases = []
    let caseNum = 0

    for (const row of smOrders) {
      caseNum += 1
      const oid = row.order_id
      const payDev = row.payment_device_id
      const exactTargets = exactByOrder.get(oid) ?? []
      const activeExact = exactTargets.filter(isActiveSub)
      const inactiveExact = exactTargets.filter((r) => !isActiveSub(r))
      const expiredExact = exactTargets.filter((r) => parseDate(r.expires_at)?.getTime() <= Date.now())
      const revokedExact = exactTargets.filter((r) => String(r.status).toLowerCase() === 'revoked')

      const movedRows = movedByOrder.get(oid) ?? []

      const devTxns = (txnsByDevice.get(payDev) ?? []).filter((t) => t.status === 'completed')
      const thisTxn = txnsByOrder.get(oid)
      const laterPayments = devTxns.filter(
        (t) =>
          t.order_id !== oid &&
          parseDate(t.completed_at ?? t.created_at)?.getTime() >
            parseDate(thisTxn?.completed_at ?? thisTxn?.created_at)?.getTime(),
      )
      const laterActiveOrder = laterPayments.find((lp) => {
        const sub = subsByDevice.get(payDev)
        return sub && isActiveSub(sub) && String(sub.transaction_id).trim() === lp.order_id
      })

      const xfers = xferByDevice.get(payDev) ?? []
      const completedHamisha = xfers.filter((x) => x.status === 'completed')
      let indirectTarget = null
      let indirectKind = null
      for (const x of completedHamisha) {
        const tgtSub = subsByDevice.get(x.target_device_id)
        if (!tgtSub) continue
        const txn = String(tgtSub.transaction_id ?? '')
        if (txn.startsWith('transfer:') || txn.startsWith('force:')) {
          indirectTarget = tgtSub
          indirectKind = txn.startsWith('force:') ? 'force' : 'transfer'
          break
        }
        if (isActiveSub(tgtSub) && txn === oid) {
          indirectTarget = tgtSub
          indirectKind = 'hamisha_active_exact'
          break
        }
      }

      const adminRevoked =
        (row.admin_revoked_at != null &&
          (String(row.admin_revoked_transaction_id ?? '') === oid ||
            String(row.source_transaction_id).includes(oid))) ||
        revokedExact.length > 0 ||
        revokeActions.rows.some(
          (a) => a.order_id === oid || (a.device_id === payDev && a.revoked_transaction_id === oid),
        )

      const grantOnCluster = manualGrants.rows.find((g) => {
        const sub = subsByDevice.get(g.device_id)
        return sub && String(sub.transaction_id ?? '').startsWith('manual_grant:')
      })

      const sourceFuture = isFutureExpiry({ expires_at: row.source_expires_at })
      const sourceWasActiveExact =
        String(row.source_transaction_id).trim() === oid &&
        isActiveSub({ status: row.source_status, expires_at: row.source_expires_at })

      const isWrongDir = wrongDir.some((w) => {
        const p = parseMovedTransactionId(w.transaction_id)
        return p.embeddedTransactionId === oid
      })

      const anyActiveExactGlobal = activeExact.length > 0
      const dupActive =
        sourceFuture && anyActiveExactGlobal && activeExact.some((t) => t.device_id !== payDev)

      let primary = 'UNKNOWN_NEEDS_HUMAN_REVIEW'
      let confidence = 'medium'
      let repairEligible = false
      let proposedDestination = null
      let expiryStrategy = null

      if (sourceWasActiveExact) {
        primary = 'ACTIVE_ON_LEGITIMATE_TARGET'
        confidence = 'high'
      } else if (anyActiveExactGlobal) {
        const tgt = activeExact[0]
        if (tgt.device_id === payDev) {
          primary = 'ACTIVE_ON_LEGITIMATE_TARGET'
          confidence = 'high'
        } else if (dupActive) {
          primary = 'DUPLICATE_ACTIVE'
          confidence = 'high'
        } else {
          const payFp = row.source_fingerprint
          const tgtFp = tgt.fingerprint_hash
          primary = payFp && tgtFp && payFp === tgtFp ? 'ACTIVE_ON_LEGITIMATE_TARGET' : 'ACTIVE_ON_WEAK_TARGET'
          confidence = primary === 'ACTIVE_ON_LEGITIMATE_TARGET' ? 'high' : 'medium'
        }
      } else if (adminRevoked) {
        primary = 'ADMIN_REVOKED'
        confidence = 'high'
      } else if (completedHamisha.length > 0 && indirectTarget && indirectKind !== 'hamisha_active_exact') {
        primary = indirectKind === 'force' ? 'ADMIN_FORCE_TRANSFER' : 'USER_HAMISHA_TRANSFER'
        confidence = 'high'
      } else if (grantOnCluster) {
        primary = 'MANUAL_GRANT_OVERRIDE'
        confidence = 'medium'
      } else if (laterActiveOrder) {
        primary = 'SUPERSEDED_BY_LATER_PAYMENT'
        confidence = 'high'
      } else if (!sourceFuture) {
        primary = 'EXPIRED_NORMALLY'
        confidence = 'high'
      } else if (isWrongDir) {
        primary = 'WRONG_DIRECTION_MOVE'
        confidence = 'high'
      } else if (
        sourceFuture &&
        !anyActiveExactGlobal &&
        !indirectTarget &&
        !adminRevoked &&
        !laterActiveOrder &&
        movedRows.length > 0
      ) {
        const payDevRevoked = subsByDevice.get(payDev)?.admin_revoked_at != null
        const payDevXferAway = completedHamisha.some((x) => x.source_device_id === payDev)
        if (payDevRevoked) {
          primary = 'ADMIN_REVOKED'
          confidence = 'medium'
        } else if (payDevXferAway && completedHamisha.length > 0) {
          primary = 'USER_HAMISHA_TRANSFER'
          confidence = 'medium'
        } else {
          primary = 'STRANDED_FUTURE_ENTITLEMENT_CONFIRMED'
          confidence = 'high'
          repairEligible = true
          proposedDestination = payDev
          expiryStrategy = 'RESTORE_EXISTING_FUTURE_EXPIRY'
        }
      } else if (indirectTarget && isActiveSub(indirectTarget)) {
        primary = 'AUTOMATIC_RECOVERY_VALID'
        confidence = 'medium'
      } else {
        primary = 'UNKNOWN_NEEDS_HUMAN_REVIEW'
        confidence = 'low'
      }

      inc(primary)

      cases.push({
        case_id: `SM-${String(caseNum).padStart(3, '0')}`,
        masked_phone: maskPhone(row.phone),
        order_id: oid,
        payment_device: maskId(payDev),
        source_moved_marker: maskId(row.source_transaction_id),
        source_status: row.source_status,
        source_expires_at: row.source_expires_at,
        exact_global_targets: exactTargets.map((t) => ({
          device: maskId(t.device_id),
          status: t.status,
          expires_at: t.expires_at,
          active: isActiveSub(t),
        })),
        indirect_target: indirectTarget
          ? {
              device: maskId(indirectTarget.device_id),
              transaction_id: maskId(indirectTarget.transaction_id),
              status: indirectTarget.status,
              kind: indirectKind,
            }
          : null,
        moved_row_count: movedRows.length,
        exact_active_count: activeExact.length,
        exact_inactive_count: inactiveExact.length,
        exact_expired_count: expiredExact.length,
        exact_revoked_count: revokedExact.length,
        later_superseding_payment: laterActiveOrder ? laterActiveOrder.order_id : null,
        hamisha_count: completedHamisha.length,
        admin_revoked: adminRevoked,
        manual_grant: Boolean(grantOnCluster),
        recovery_actions: recoveryActions.rows.filter((a) => a.order_id === oid).length,
        primary_classification: primary,
        confidence,
        repair_eligible: repairEligible,
        proposed_destination: proposedDestination ? maskId(proposedDestination) : null,
        expiry_strategy: expiryStrategy,
        proposed_expiry: repairEligible ? row.source_expires_at : null,
      })
    }

    const currentStranded = cases.filter(
      (c) => c.primary_classification === 'STRANDED_FUTURE_ENTITLEMENT_CONFIRMED',
    )

    const report = {
      generated_at: new Date().toISOString(),
      mode: 'READ_ONLY_SQL_CLOSURE',
      production_commit: '97eeaf8',
      previous_candidate_count: PREVIOUS_STRANDED,
      system_migration_total: smOrders.length,
      previous_system_migration_total: PREVIOUS_SM,
      current_reconstructed_stranded_predicate_count: priorStrandedIds.size,
      current_confirmed_stranded_count: currentStranded.length,
      drift: {
        sm_total_delta: smOrders.length - PREVIOUS_SM,
        stranded_predicate_delta: priorStrandedIds.size - PREVIOUS_STRANDED,
        confirmed_stranded_delta: currentStranded.length - PREVIOUS_STRANDED,
      },
      closure_matrix: {
        previous_candidates: PREVIOUS_STRANDED,
        current_reconstructed_candidates: priorStrandedIds.size,
        exact_active_target_globally: cases.filter((c) => c.exact_active_count > 0).length,
        indirect_legitimate_target_globally: cases.filter((c) =>
          ['AUTOMATIC_RECOVERY_VALID', 'ACTIVE_ON_LEGITIMATE_TARGET'].includes(c.primary_classification),
        ).length,
        superseded_by_later_payment: buckets.SUPERSEDED_BY_LATER_PAYMENT || 0,
        user_hamisha: buckets.USER_HAMISHA_TRANSFER || 0,
        admin_force: buckets.ADMIN_FORCE_TRANSFER || 0,
        manual_grant_override: buckets.MANUAL_GRANT_OVERRIDE || 0,
        admin_revoked: buckets.ADMIN_REVOKED || 0,
        expired_normally: buckets.EXPIRED_NORMALLY || 0,
        wrong_direction: buckets.WRONG_DIRECTION_MOVE || 0,
        weak_target: buckets.ACTIVE_ON_WEAK_TARGET || 0,
        duplicate_active: buckets.DUPLICATE_ACTIVE || 0,
        confirmed_stranded: buckets.STRANDED_FUTURE_ENTITLEMENT_CONFIRMED || 0,
        unknown_human_review: buckets.UNKNOWN_NEEDS_HUMAN_REVIEW || 0,
        active_on_legitimate_target: buckets.ACTIVE_ON_LEGITIMATE_TARGET || 0,
        automatic_recovery_valid: buckets.AUTOMATIC_RECOVERY_VALID || 0,
      },
      primary_buckets: buckets,
      pool_before: poolBefore,
      pool_after: poolAfter,
      query_timings_ms: timings,
      total_query_ms: timings.reduce((s, t) => s + t.ms, 0),
      safe_to_restore: currentStranded.map((c) => ({
        case_id: c.case_id,
        order_id: c.order_id,
        destination: c.proposed_destination,
        expiry_strategy: c.expiry_strategy,
        proposed_expiry: c.proposed_expiry,
      })),
      cases,
    }

    const unknown = report.closure_matrix.unknown_human_review
    const stranded = report.closure_matrix.confirmed_stranded
    if (unknown === 0 && stranded >= 0) report.final_verdict = stranded > 0 ? 'PASS' : 'PARTIAL_PASS'
    else if (unknown <= 5) report.final_verdict = 'PARTIAL_PASS'
    else report.final_verdict = 'FAIL'

    const outPath = resolve(__dir, '../../tmp-sql-closure-report.json')
    writeFileSync(outPath, JSON.stringify(report, null, 2))
    console.log(
      JSON.stringify(
        {
          verdict: report.final_verdict,
          sm_total: report.system_migration_total,
          previous_stranded: PREVIOUS_STRANDED,
          reconstructed_predicate: report.current_reconstructed_stranded_predicate_count,
          confirmed_stranded: report.closure_matrix.confirmed_stranded,
          exact_active_global: report.closure_matrix.exact_active_target_globally,
          buckets: report.primary_buckets,
          safe_restore_count: report.safe_to_restore.length,
          query_ms: report.total_query_ms,
          out: outPath,
        },
        null,
        2,
      ),
    )
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
