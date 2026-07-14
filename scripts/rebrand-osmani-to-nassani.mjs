/**
 * One-shot Nassani → Nassani identity transform for nassani-admin.
 * Skips node_modules, dist, .git, and binary-ish files.
 * Run: node scripts/rebrand-nassani-to-nassani.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  '.git',
  '.vercel',
  'vercel-runtime-hotfix',
])

const EXT_OK = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.html',
  '.md',
  '.yml',
  '.yaml',
  '.sh',
  '.conf',
  '.example',
  '.cutover',
  '.env',
  '.txt',
  '.css',
  '.svg',
])

const REPLACEMENTS = [
  // Longer / more specific first
  ['sokalive/nassani-admin', 'sokalive/nassani-admin'],
  ['api.nassanitv.online', 'api.nassanitv.online'],
  ['admin.nassanitv.online', 'admin.nassanitv.online'],
  ['admin.nassanitv.online', 'admin.nassanitv.online'],
  ['nassanitv.online', 'nassanitv.online'],
  ['nassanitv.online', 'nassanitv.online'],
  ['', process.env.NASSANI_CDN_BASE || ''],
  ['', process.env.NASSANI_CDN_HOST || ''],
  ['/var/www/nassani-admin', '/var/www/nassani-admin'],
  ['/var/www/nassani-admin', '/var/www/nassani-admin'],
  ['/root/.nassani-admin.env', '/root/.nassani-admin.env'],
  ['api.nassanitv.online', 'api.nassanitv.online'],
  ['admin.nassanitv.online', 'admin.nassanitv.online'],
  ['nassanitv.online', 'nassanitv.online'],
  ['admin.nassanitv.online', 'admin.nassanitv.online'],
  ['api.nassanitv.online', 'api.nassanitv.online'],
  ['nassanitv.online', 'nassanitv.online'],
  ['admin@nassanitv.online', 'admin@nassanitv.online'],
  ['customer@nassanitv.online', 'customer@nassanitv.online'],
  ['probe@nassanitv.online', 'probe@nassanitv.online'],
  ['NASSANITVMAX', 'NASSANITVMAX'],
  ['Nassani TV Admin', 'Nassani TV Admin'],
  ['Nassani Admin', 'Nassani Admin'],
  ['Nassani TV', 'Nassani TV'],
  ['Nassani Customer', 'Nassani Customer'],
  ['Nassani APP', 'Nassani APP'],
  ['Mtumiaji Nassani', 'Mtumiaji Nassani'],
  ['Karibu Nassani TV', 'Karibu Nassani TV'],
  ['nassaniadmin-api', 'nassaniadmin-api'],
  ['nassaniadmin', 'nassaniadmin'],
  ['nassani-admin-api', 'nassani-admin-api'],
  ['nassani-admin', 'nassani-admin'],
  ['public-nassanitv', 'public-nassanitv'],
  ['nginx-nassani-admin.conf', 'nginx-nassani-admin.conf'],
  ['nassani-node-api.conf', 'nassani-node-api.conf'],
  ['nassani-ssl-params.conf', 'nassani-ssl-params.conf'],
  ['nassanitv-domains.conf', 'nassanitv-domains.conf'],
  ['nassanitv-acme-http.conf', 'nassanitv-acme-http.conf'],
  ['setup-nassanitv-ssl.sh', 'setup-nassanitv-ssl.sh'],
  ['setup-nassanitv-ssl.sh', 'setup-nassanitv-ssl.sh'],
  ['reload-nassanitv-nginx.sh', 'reload-nassanitv-nginx.sh'],
  ['verify-nassanitv-domains.mjs', 'verify-nassanitv-domains.mjs'],
  ['NASSANI_ADMIN_ROOT', 'NASSANI_ADMIN_ROOT'],
  ['NASSANI_LOAD_CUTOVER_ENV', 'NASSANI_LOAD_CUTOVER_ENV'],
  ['NASSANI_GIT_COMMIT', 'NASSANI_GIT_COMMIT'],
  ['NASSANI_USE_BRANDED_HTTPS', 'NASSANI_USE_BRANDED_HTTPS'],
  ['NASSANI_VPS', 'NASSANI_VPS'],
  ['__NASSANI_ADMIN_BUILD__', '__NASSANI_ADMIN_BUILD__'],
  ['nassani_admin_security_gate', 'nassani_admin_security_gate'],
  ['nassani_admin_snap_v2', 'nassani_admin_snap_v2'],
  ['nassani_admin_snap_v1', 'nassani_admin_snap_v1'],
  ['nassani_admin_token', 'nassani_admin_token'],
  ['nassani_admin_email', 'nassani_admin_email'],
  ['nassani_admin_pending_otp_token', 'nassani_admin_pending_otp_token'],
  ['nassani_admin_pending_email', 'nassani_admin_pending_email'],
  ['nassani_admin_panel_device_uid', 'nassani_admin_panel_device_uid'],
  ['nassani_plans_v1', 'nassani_plans_v1'],
  ['nassani-admin-auth', 'nassani-admin-auth'],
  ['nassani_live_sync', 'nassani_live_sync'],
  ['nassani_api_cache_bust', 'nassani_api_cache_bust'],
  ['nassani_device_subscription', 'nassani_device_subscription'],
  ['nassani_db', 'nassani_db'],
  ['nassani-fp-v1', 'nassani-fp-v1'],
  ['nassani-otp-v1', 'nassani-otp-v1'],
  ['nassani-stream-rollout-v1', 'nassani-stream-rollout-v1'],
  ['nassani-v1', 'nassani-v1'],
  ['nassani://', 'nassani://'],
  ['[nassani-admin]', '[nassani-admin]'],
  ['Nassani', 'Nassani'],
  ['NASSANI', 'NASSANI'],
  ['nassani', 'nassani'],
  // Old Contabo IP → placeholder token (bootstrap substitutes). Keep empty string if unknown.
  ['169.58.18.86', process.env.NASSANI_VPS_IP || '169.58.18.86'],
]

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(ent.name)) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function shouldTouch(file) {
  const base = path.basename(file)
  if (base.startsWith('tmp-')) return false
  if (base === 'package-lock.json') return true
  const ext = path.extname(file).toLowerCase()
  if (!ext && (base === 'Dockerfile' || base.startsWith('.env'))) return true
  if (base.endsWith('.env.example') || base.endsWith('.env.cutover')) return true
  return EXT_OK.has(ext)
}

let changed = 0
let files = 0
for (const file of walk(ROOT)) {
  if (!shouldTouch(file)) continue
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (!/[Oo]smani|NASSANI|nassanitv|144\.91\.117\.90/.test(text)) continue
  let next = text
  for (const [from, to] of REPLACEMENTS) {
    if (!from || to === undefined) continue
    if (next.includes(from)) next = next.split(from).join(to)
  }
  // Clean leftover empty CDN assignments if CDN was blanked
  next = next.replace(/BUNNY_CDN_BASE_URL=\s*\n/g, 'BUNNY_CDN_BASE_URL=\n')
  if (next !== text) {
    fs.writeFileSync(file, next)
    changed++
    console.log('updated', path.relative(ROOT, file))
  }
  files++
}

console.log(`Done. Scanned ${files} matching files, updated ${changed}.`)
