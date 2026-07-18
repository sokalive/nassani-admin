/**
 * Express helpers for admin PIN / sensitive-action gates (server-authoritative).
 * Never log the entered PIN.
 */
import {
  adminSecurityPinFromBody,
  verifyAdminSecurityPin,
} from './adminSecurityPin.js'
import {
  sensitiveActionPasswordFromBody,
  verifyAdminSensitiveActionPassword,
} from './adminSensitiveActionPassword.js'
import { signAdminJwt, verifyAdminJwt } from './adminJwt.js'

const UNLOCK_TYP = 'security_center_unlock'
const UNLOCK_TTL_SEC = Math.max(
  300,
  Number(process.env.SECURITY_CENTER_UNLOCK_TTL_SEC) || 1800,
)

export function requireSensitiveActionPassword(req, res, next) {
  const pin = sensitiveActionPasswordFromBody(req)
  if (!pin) {
    return res.status(400).json({ ok: false, error: 'security_pin required' })
  }
  if (!verifyAdminSensitiveActionPassword(pin)) {
    return res.status(403).json({ ok: false, error: 'Security PIN si sahihi' })
  }
  return next()
}

export function requireAdminSecurityPin(req, res, next) {
  const pin = adminSecurityPinFromBody(req)
  if (!pin) {
    return res.status(400).json({ ok: false, error: 'security_pin required' })
  }
  if (!verifyAdminSecurityPin(pin)) {
    return res.status(403).json({ ok: false, error: 'Security PIN si sahihi' })
  }
  return next()
}

/** Short-lived capability after Security Center PIN unlock (or raw PIN on each request). */
export function mintSecurityCenterUnlockToken(meta = {}) {
  return signAdminJwt(
    {
      typ: UNLOCK_TYP,
      sub: String(meta.adminUserId || meta.sub || 'admin'),
      em: String(meta.adminEmail || meta.em || ''),
    },
    { ttlSeconds: UNLOCK_TTL_SEC },
  )
}

export function securityCenterUnlockTokenFromReq(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const h = String(req.headers['x-security-unlock-token'] ?? '').trim()
  if (h) return h
  return String(body.unlock_token ?? body.unlockToken ?? body.security_unlock_token ?? '').trim()
}

export function verifySecurityCenterUnlockToken(token) {
  const payload = verifyAdminJwt(token)
  if (!payload || payload.typ !== UNLOCK_TYP) return null
  return payload
}

/**
 * Accept either ADMIN_SECURITY_PIN in body or a valid unlock token from verify-security-pin.
 * Prefer this for Security Center mutations so page unlock is not UI-only.
 */
export function requireSecurityCenterCapability(req, res, next) {
  const pin = adminSecurityPinFromBody(req)
  if (pin) {
    if (!verifyAdminSecurityPin(pin)) {
      return res.status(403).json({ ok: false, error: 'Security PIN si sahihi' })
    }
    return next()
  }
  const token = securityCenterUnlockTokenFromReq(req)
  if (!token) {
    return res.status(400).json({
      ok: false,
      error: 'security_pin or unlock_token required',
      code: 'SECURITY_CENTER_LOCKED',
    })
  }
  try {
    const payload = verifySecurityCenterUnlockToken(token)
    if (!payload) {
      return res.status(403).json({
        ok: false,
        error: 'Security Center unlock expired — enter PIN again',
        code: 'SECURITY_CENTER_LOCKED',
      })
    }
    req.securityCenterUnlock = payload
    return next()
  } catch {
    return res.status(403).json({
      ok: false,
      error: 'Security Center unlock unavailable',
      code: 'SECURITY_CENTER_LOCKED',
    })
  }
}
