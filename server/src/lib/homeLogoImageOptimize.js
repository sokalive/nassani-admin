import sharp from 'sharp'

/** Output circular logo diameter in pixels. */
export const HOME_LOGO_SIZE = Math.max(
  128,
  Math.min(1024, Number(process.env.HOME_LOGO_SIZE) || 512),
)

const MAX_INPUT_BYTES = Math.max(
  512 * 1024,
  Number(process.env.HOME_LOGO_MAX_INPUT_BYTES) || 12 * 1024 * 1024,
)

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

export function isAllowedHomeLogoMime(mime) {
  const m = String(mime || '')
    .toLowerCase()
    .split(';')[0]
    .trim()
  return ALLOWED_MIME.has(m)
}

export function parseHomeLogoDataUrl(raw) {
  const compact = String(raw || '').replace(/\s/g, '')
  const m = /^data:image\/(jpe?g|png|webp);base64,(.+)$/i.exec(compact)
  if (!m) return null
  let buf
  try {
    buf = Buffer.from(m[2], 'base64')
  } catch {
    return null
  }
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/webp'
  return { buf, mime, ext }
}

/**
 * Fit any image into a perfect circular frame (cover crop → circular alpha mask).
 * Never rejects by aspect ratio or dimensions. Outputs PNG with transparency.
 */
export async function processHomeLogoCircular(inputBuf, { mime = '' } = {}) {
  if (!inputBuf?.length) throw new Error('Image is empty')
  if (inputBuf.length > MAX_INPUT_BYTES) {
    const mb = Math.round(MAX_INPUT_BYTES / (1024 * 1024))
    throw new Error(`Image exceeds ${mb} MB upload limit`)
  }

  const size = HOME_LOGO_SIZE
  let pipeline = sharp(inputBuf, { failOn: 'none' }).rotate()
  const meta = await pipeline.metadata()
  if (!meta.width || !meta.height) {
    throw new Error('Unsupported or corrupt image (use JPG, JPEG, PNG or WEBP)')
  }

  // Cover-crop to square so any aspect ratio fits the circle.
  const square = await sharp(inputBuf, { failOn: 'none' })
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .png()
    .toBuffer()

  const circleSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>
    </svg>`,
  )

  const outBuf = await sharp(square)
    .composite([{ input: circleSvg, blend: 'dest-in' }])
    .png({ compressionLevel: 8 })
    .toBuffer()

  return {
    buffer: outBuf,
    mime: 'image/png',
    ext: 'png',
    width: size,
    height: size,
    sourceMime: mime || meta.format || '',
  }
}
