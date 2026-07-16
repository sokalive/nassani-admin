import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { homeLogoToPublicResponse, homeLogoToResponse } from '../homeLogoNormalize.js'
import * as homeLogoStore from '../homeLogoStore.js'
import { getChannelById } from '../store.js'
import { UPLOADS_DIR, sendUploadError, uploadHomeLogoImage } from '../multerUpload.js'
import { afterImageMulter } from '../lib/imageMulterPipeline.js'
import { persistImageBufferToUploads } from '../lib/uploadDiskSafety.js'
import {
  isAllowedHomeLogoMime,
  parseHomeLogoDataUrl,
  processHomeLogoCircular,
} from '../lib/homeLogoImageOptimize.js'
import { liveSyncBus } from '../lib/liveSyncBus.js'
import { invalidateApiCacheNamespace } from '../lib/apiResponseCache.js'
import { notifyApiCacheBust } from '../lib/apiCacheBustRelay.js'
import { notifyLiveSyncPeers } from '../lib/liveSyncRelay.js'
import { apiResponseCacheExact } from '../middleware/apiResponseCache.js'
import { requireAdminPanelAccess } from '../middleware/adminPanelAuthGate.js'

async function publishHomeLogosChanged(action, extra = {}) {
  invalidateApiCacheNamespace('home-logos')
  const packet = liveSyncBus.publish('config.home_logos_changed', {
    topics: ['config'],
    action,
    synced_at: new Date().toISOString(),
    ...extra,
  })
  await notifyApiCacheBust(['home-logos'])
  await notifyLiveSyncPeers(packet)
  return packet
}

export const homeLogosRouter = Router()

const upload = uploadHomeLogoImage.single('image')

function runUpload(req, res, next) {
  upload(req, res, (err) => {
    afterImageMulter(req, res, next, err).catch(next)
  })
}

function maybeUploadHomeLogo(req, res, next) {
  const ct = String(req.headers['content-type'] || '')
  if (ct.includes('multipart/form-data')) {
    return runUpload(req, res, next)
  }
  return next()
}

function parseBool(v, defaultVal) {
  if (v === undefined || v === null || v === '') return defaultVal
  if (typeof v === 'boolean') return v
  const s = String(v).toLowerCase()
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false
  return defaultVal
}

function parseRedirectChannelId(b) {
  const idRaw = b.redirect_channel_id ?? b.redirectChannelId
  if (idRaw === undefined || idRaw === null || idRaw === '') return null
  const n = Number.parseInt(String(idRaw), 10)
  return Number.isNaN(n) ? null : n
}

function parseHomeLogoFields(req) {
  const b = req.body || {}
  return {
    title: String(b.title ?? '').trim(),
    subtitle: String(b.subtitle ?? '').trim(),
    active: parseBool(b.active ?? b.isActive, true),
    sort_order: Number.parseInt(String(b.sort_order ?? b.sortOrder ?? b.position ?? 0), 10) || 0,
    redirect_channel_id: parseRedirectChannelId(b),
    link_url: String(b.link_url ?? b.linkUrl ?? '').trim(),
  }
}

function validateHomeLogoFields(fields) {
  const errors = []
  if (!fields.title) errors.push('title is required')
  if (fields.link_url) {
    try {
      // Allow relative app deep-links or absolute http(s)
      if (
        !fields.link_url.startsWith('/') &&
        !/^https?:\/\//i.test(fields.link_url)
      ) {
        errors.push('link_url must be http(s) URL or start with /')
      }
    } catch {
      errors.push('link_url is invalid')
    }
  }
  return errors
}

async function validateRedirectChannelExists(redirectChannelId) {
  if (redirectChannelId == null) return null
  const row = await getChannelById(redirectChannelId)
  if (!row) return 'redirect_channel_id does not refer to an existing channel'
  return null
}

async function persistCircularLogoBuffer(buffer, mimeHint = '') {
  const processed = await processHomeLogoCircular(buffer, { mime: mimeHint })
  const filename = `${Date.now()}-${randomBytes(8).toString('hex')}.${processed.ext}`
  const persisted = await persistImageBufferToUploads(processed.buffer, { filename })
  return persisted.relativePath
}

async function resolveImagePath({ body, file, existingImage }) {
  // Multipart disk file
  if (file?.path || file?.filename) {
    let buffer
    if (file.buffer?.length) {
      buffer = file.buffer
    } else if (file.path) {
      buffer = await fs.readFile(file.path)
    } else if (file.filename) {
      buffer = await fs.readFile(path.join(UPLOADS_DIR, file.filename))
    }
    if (!buffer?.length) {
      throw new Error('Uploaded image file was not saved correctly. Please try again.')
    }
    if (!isAllowedHomeLogoMime(file.mimetype) && !file.mimetype?.startsWith('image/')) {
      throw new Error('Only PNG, JPG, JPEG and WEBP images are allowed')
    }
    const rel = await persistCircularLogoBuffer(buffer, file.mimetype || '')
    // Remove raw multer file if it was a different name
    if (file.filename && file.filename !== path.basename(rel)) {
      await fs.unlink(path.join(UPLOADS_DIR, file.filename)).catch(() => {})
    }
    if (file.path && path.basename(file.path) !== path.basename(rel)) {
      await fs.unlink(file.path).catch(() => {})
    }
    return rel
  }
  if (file) {
    throw new Error('Uploaded image file was not saved correctly. Please try again.')
  }

  const raw = body?.image ?? body?.imageUrl
  if (raw == null || raw === '') return existingImage ?? null
  const s = String(raw).trim()

  if (s.startsWith('data:image')) {
    const parsed = parseHomeLogoDataUrl(s)
    if (!parsed) throw new Error('Invalid image data URL (use JPG, JPEG, PNG or WEBP)')
    return persistCircularLogoBuffer(parsed.buf, parsed.mime)
  }

  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/uploads')) {
    if (s.startsWith('/uploads/')) return s
    try {
      const parsed = new URL(s)
      if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname
    } catch {
      // Keep external URLs unchanged.
    }
    return s
  }
  return existingImage ?? null
}

function uploadsBasename(imagePath) {
  if (!imagePath || typeof imagePath !== 'string') return null
  if (!imagePath.startsWith('/uploads/')) return null
  return path.basename(imagePath)
}

async function unlinkUploadIfAny(imagePath) {
  const base = uploadsBasename(imagePath)
  if (!base) return
  await fs.unlink(path.join(UPLOADS_DIR, base)).catch(() => {})
}

/** Public: active home circular logos for the App. */
homeLogosRouter.get('/', apiResponseCacheExact('home-logos'), async (req, res) => {
  try {
    const rows = await homeLogoStore.listHomeLogosPublic()
    const payload = rows.map((r) => homeLogoToPublicResponse(r, req)).filter(Boolean)
    res.setHeader('Cache-Control', 'no-store')
    res.json(payload)
  } catch (e) {
    console.error('[home-logos] GET / failed:', e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

/** CMS: all logos (admin UI) */
homeLogosRouter.get('/manage', requireAdminPanelAccess, async (req, res) => {
  try {
    const rows = await homeLogoStore.listHomeLogosManage()
    res.json(rows.map((r) => homeLogoToResponse(r, req)))
  } catch (e) {
    console.error('[home-logos] GET /manage failed:', e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

homeLogosRouter.post('/reorder', requireAdminPanelAccess, async (req, res) => {
  try {
    const orders = req.body?.orders ?? req.body
    const n = await homeLogoStore.reorderHomeLogos(orders)
    await publishHomeLogosChanged('reorder', { count: n })
    const rows = await homeLogoStore.listHomeLogosManage()
    res.json(rows.map((r) => homeLogoToResponse(r, req)))
  } catch (e) {
    console.error('[home-logos] POST /reorder failed:', e)
    res.status(500).json({ error: String(e.message || e) })
  }
})

homeLogosRouter.post('/', requireAdminPanelAccess, maybeUploadHomeLogo, async (req, res) => {
  try {
    if (req.file) {
      try {
        const { finalizeMemoryImageUpload } = await import('../lib/uploadDiskSafety.js')
        await finalizeMemoryImageUpload(req)
      } catch {
        // Disk storage already has file on disk.
      }
    }
    const fields = parseHomeLogoFields(req)
    const errors = validateHomeLogoFields(fields)
    if (errors.length) return res.status(400).json({ error: errors.join('; ') })

    const redirectErr = await validateRedirectChannelExists(fields.redirect_channel_id)
    if (redirectErr) return res.status(400).json({ error: redirectErr })

    let imagePath
    try {
      imagePath = await resolveImagePath({ body: req.body, file: req.file, existingImage: null })
    } catch (imgErr) {
      return res.status(400).json({ error: String(imgErr.message || imgErr), code: 'UPLOAD_FAILED' })
    }
    if (!imagePath) {
      return res.status(400).json({ error: 'Please upload a logo image.' })
    }

    const inserted = await homeLogoStore.insertHomeLogo({ ...fields, image: imagePath })
    const full = await homeLogoStore.getHomeLogoById(inserted.id)
    await publishHomeLogosChanged('create', { id: inserted.id })
    res.status(201).json(homeLogoToResponse(full, req))
  } catch (e) {
    console.error('[home-logos] POST / failed:', e)
    if (e?.code === 'LIMIT_FILE_SIZE' || e?.name === 'MulterError') {
      return sendUploadError(res, e)
    }
    res.status(500).json({ error: String(e.message || e) })
  }
})

homeLogosRouter.put('/:id', requireAdminPanelAccess, maybeUploadHomeLogo, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await homeLogoStore.getHomeLogoById(id)
    if (!existing) return res.status(404).json({ error: 'Home logo not found' })

    if (req.file) {
      try {
        const { finalizeMemoryImageUpload } = await import('../lib/uploadDiskSafety.js')
        await finalizeMemoryImageUpload(req)
      } catch {
        // Disk storage ok.
      }
    }

    const fields = parseHomeLogoFields(req)
    const errors = validateHomeLogoFields(fields)
    if (errors.length) return res.status(400).json({ error: errors.join('; ') })

    const redirectErr = await validateRedirectChannelExists(fields.redirect_channel_id)
    if (redirectErr) return res.status(400).json({ error: redirectErr })

    let imagePath
    try {
      imagePath = await resolveImagePath({
        body: req.body,
        file: req.file,
        existingImage: existing.image,
      })
    } catch (imgErr) {
      return res.status(400).json({ error: String(imgErr.message || imgErr), code: 'UPLOAD_FAILED' })
    }
    if (!imagePath) {
      return res.status(400).json({ error: 'Please upload a logo image.' })
    }

    await homeLogoStore.updateHomeLogo(id, { ...fields, image: imagePath })
    if (existing.image && existing.image !== imagePath) {
      await unlinkUploadIfAny(existing.image)
    }
    const full = await homeLogoStore.getHomeLogoById(id)
    await publishHomeLogosChanged('update', { id })
    res.json(homeLogoToResponse(full, req))
  } catch (e) {
    console.error('[home-logos] PUT /:id failed:', e)
    if (e?.code === 'LIMIT_FILE_SIZE' || e?.name === 'MulterError') {
      return sendUploadError(res, e)
    }
    res.status(500).json({ error: String(e.message || e) })
  }
})

homeLogosRouter.delete('/:id', requireAdminPanelAccess, async (req, res) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = await homeLogoStore.getHomeLogoById(id)
    if (!existing) return res.status(404).json({ error: 'Home logo not found' })
    await homeLogoStore.deleteHomeLogoById(id)
    await unlinkUploadIfAny(existing.image)
    await publishHomeLogosChanged('delete', { id })
    res.status(204).end()
  } catch (e) {
    console.error('[home-logos] DELETE /:id failed:', e)
    res.status(500).json({ error: String(e.message || e) })
  }
})
