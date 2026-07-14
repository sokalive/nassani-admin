# VPS domain migration (nassanitv.com) — testing only

Migrate **branded HTTPS hosts** on Contabo while **Render API** (`api.nassanitv.com`) remains production for legacy APK users.

## DNS (A records → `62.171.131.113`)

| Host | Purpose |
|------|---------|
| `api.nassanitv.com` | Node API (HTTPS) — **testing only** until APK cutover approved |
| `admin.nassanitv.com` | Admin SPA + `/api` proxy |
| `nassanitv.com` | Public landing page |

**Do not** change legacy APK `API_BASE` to VPS until explicit cutover approval.

## Nginx

| File | Role |
|------|------|
| `deploy/contabo/nginx/nassanitv-domains.conf` | HTTPS vhosts + HTTP→HTTPS redirect |
| `deploy/contabo/nginx/nassanitv-acme-http.conf` | ACME webroot (pre-cert) |
| `deploy/contabo/nginx/snippets/nassani-node-api.conf` | Shared API proxy |
| `deploy/contabo/nginx-nassani-admin.conf` | IP `62.171.131.113` HTTP (unchanged) |

## TLS (Let's Encrypt)

On VPS as root (after DNS propagates):

```bash
# Recommended — firewall + ACME + HTTPS vhosts + verification
curl -fsSL https://raw.githubusercontent.com/sokalive/nassani-admin/main/deploy/contabo/setup-nassanitv-ssl.sh | bash
```

Or from repo clone:

```bash
cd /var/www/nassani-admin
git pull origin main
CERTBOT_EMAIL=admin@nassanitv.com bash deploy/contabo/setup-nassanitv-ssl.sh
```

Legacy script (still works):

```bash
CERTBOT_EMAIL=admin@nassanitv.com bash deploy/contabo/setup-nassanitv-ssl.sh
```

Full cutover + SSL (runs `setup-nassanitv-ssl.sh` at end of `apply-cutover.sh`):

```bash
bash deploy/contabo/pull-and-apply.sh
```

### If port 443 stays closed

1. Contabo panel → **Firewall** → allow **80/tcp** and **443/tcp** inbound.
2. On VPS: `ss -tulpn | grep 443` — must show `nginx`.
3. `certbot certificates` — must list `nassanitv.com` SANs.
4. `nginx -t && systemctl status nginx`

### After nginx config changes only

```bash
curl -fsSL https://raw.githubusercontent.com/sokalive/nassani-admin/main/deploy/contabo/reload-nassanitv-nginx.sh | bash
```

## Verify

```bash
curl -fsS https://api.nassanitv.com/api/health
curl -fsSI https://admin.nassanitv.com | head
curl -fsS https://nassanitv.com | head

node deploy/contabo/verify-nassanitv-domains.mjs
```

Render safety (unchanged):

```bash
curl -fsS https://api.nassanitv.com/api/health
```

## Google Play / HTTPS

- Legacy APK continues using **Render HTTPS** — no cutover.
- VPS branded API uses **TLS only** (port 443); HTTP redirects to HTTPS.
- Express `trust proxy` enabled so `BASE_URL` and webhooks resolve HTTPS behind nginx.

## What stays on Render

| Service | Status |
|---------|--------|
| `nassani-admin-api` | **Keep live** |
| `nassani-admin-mpya` | Optional suspend after VPS admin verified |
