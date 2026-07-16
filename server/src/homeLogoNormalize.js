import { resolveThumbnailForApi } from './channelNormalize.js'

function formatTsForApi(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function fullImageUrl(row, req) {
  return resolveThumbnailForApi(row.image ?? null, req)
}

/**
 * GET /api/home-logos — public shape for App Home circular logos.
 */
export function homeLogoToPublicResponse(row, req) {
  if (!row) return null
  const imageUrl = fullImageUrl(row, req)
  const rid = row.redirect_channel_id != null ? Number(row.redirect_channel_id) : null
  const sortOrder = Number(row.sort_order) || 0
  const createdAt = formatTsForApi(row.created_at)
  const updatedAt = formatTsForApi(row.updated_at) ?? createdAt
  const linkUrl = String(row.link_url ?? '').trim()

  return {
    id: Number(row.id),
    title: row.title ?? '',
    subtitle: row.subtitle ?? '',
    image: imageUrl,
    image_url: imageUrl,
    imageUrl,
    is_active: Boolean(row.active),
    isActive: Boolean(row.active),
    active: Boolean(row.active),
    sort_order: sortOrder,
    sortOrder,
    position: sortOrder,
    redirect_channel_id: rid,
    redirectChannelId: rid,
    link_url: linkUrl,
    linkUrl,
    created_at: createdAt,
    createdAt,
    updated_at: updatedAt,
    updatedAt,
  }
}

/** Admin CMS shape (includes inactive + channel name). */
export function homeLogoToResponse(row, req) {
  const base = homeLogoToPublicResponse(row, req)
  if (!base) return null
  return {
    ...base,
    redirect_channel_name: row.redirect_channel_name ?? null,
    redirectChannelName: row.redirect_channel_name ?? null,
  }
}
