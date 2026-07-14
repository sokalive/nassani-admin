#!/usr/bin/env node
const VPS = 'https://admin.nassanitv.online'
const R = 'https://admin.nassanitv.online'

async function bundle(u) {
  const html = await fetch(`${u}/`, { cache: 'no-store' }).then((r) => r.text())
  const path = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
  const res = await fetch(`${u}${path}`, { cache: 'no-store' })
  const js = await res.text()
  const buf = new TextEncoder().encode(js)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
  return { path, hash, len: js.length, lm: res.headers.get('last-modified') }
}

const [v, r] = await Promise.all([bundle(VPS), bundle(R)])
console.log('VPS', v)
console.log('Render', r)
const match = v.path === r.path && v.hash === r.hash
console.log('EXACT_MATCH', match)
process.exit(match ? 0 : 1)
