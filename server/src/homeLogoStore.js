import { ensureHomeLogosTable } from './db/homeLogosTable.js'
import { getPool } from './db/pool.js'

export async function ensureHomeLogosStorage() {
  const pool = getPool()
  if (!pool) {
    throw new Error('DATABASE_URL is required for home logo storage (PostgreSQL).')
  }
  const client = await pool.connect()
  try {
    await ensureHomeLogosTable(client)
  } finally {
    client.release()
  }
}

const SELECT_BASE = `
  SELECT h.id, h.title, h.subtitle, h.image, h.active, h.sort_order,
         h.redirect_channel_id, h.link_url, h.created_at, h.updated_at,
         c.name AS redirect_channel_name
  FROM home_logos h
  LEFT JOIN channels c ON c.id = h.redirect_channel_id
`

const SELECT_PUBLIC = `
  SELECT h.id, h.title, h.subtitle, h.image, h.active, h.sort_order,
         h.redirect_channel_id, h.link_url, h.created_at, h.updated_at
  FROM home_logos h
`

/** Public GET /api/home-logos — active logos only, sorted. */
export async function listHomeLogosPublic() {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is required.')
  const { rows } = await pool.query(`
    ${SELECT_PUBLIC}
    WHERE h.active = true
    ORDER BY h.sort_order ASC, h.created_at DESC
  `)
  return rows
}

/** Admin / CMS: all logos. */
export async function listHomeLogosManage() {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is required.')
  const { rows } = await pool.query(`${SELECT_BASE} ORDER BY h.sort_order ASC, h.created_at DESC`)
  return rows
}

export async function getHomeLogoById(id) {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is required.')
  const { rows } = await pool.query(`${SELECT_BASE} WHERE h.id = $1`, [Number(id)])
  return rows[0] ?? null
}

export async function insertHomeLogo(payload) {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is required.')
  const { rows } = await pool.query(
    `INSERT INTO home_logos (
       title, subtitle, image, active, sort_order, redirect_channel_id, link_url
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      payload.title,
      payload.subtitle,
      payload.image,
      payload.active,
      payload.sort_order,
      payload.redirect_channel_id,
      payload.link_url,
    ],
  )
  return rows[0]
}

export async function updateHomeLogo(id, payload) {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is required.')
  const { rows } = await pool.query(
    `UPDATE home_logos SET
       title = $2, subtitle = $3, image = $4, active = $5, sort_order = $6,
       redirect_channel_id = $7, link_url = $8, updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [
      Number(id),
      payload.title,
      payload.subtitle,
      payload.image,
      payload.active,
      payload.sort_order,
      payload.redirect_channel_id,
      payload.link_url,
    ],
  )
  return rows[0] ?? null
}

export async function deleteHomeLogoById(id) {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is required.')
  await pool.query('DELETE FROM home_logos WHERE id = $1', [Number(id)])
}

/** Update sort_order only — drag-reorder without clobbering other columns. */
export async function reorderHomeLogos(orders) {
  const pool = getPool()
  if (!pool) throw new Error('DATABASE_URL is required.')
  const list = Array.isArray(orders) ? orders : []
  if (list.length === 0) return 0
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let n = 0
    for (const item of list) {
      const id = Number(item?.id)
      const sortOrder = Number(item?.sortOrder ?? item?.sort_order)
      if (!Number.isFinite(id) || !Number.isFinite(sortOrder)) continue
      await client.query(
        `UPDATE home_logos SET sort_order = $2, updated_at = now() WHERE id = $1`,
        [id, sortOrder],
      )
      n += 1
    }
    await client.query('COMMIT')
    return n
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
