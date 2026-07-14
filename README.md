# Nassani Admin

Independent Nassani TV production admin + API.

- **GitHub:** https://github.com/sokalive/nassani-admin
- **VPS path:** `/var/www/nassani-admin`
- **Stack:** Nginx → PM2 Node API (`:10001`) + Vite admin SPA; PostgreSQL on Contabo
- **Video:** channel metadata on VPS; HLS (`.m3u8` / `.ts`) on CDN/storage only

## Fresh Contabo bootstrap

On a new Ubuntu VPS as root:

```bash
curl -fsSL https://raw.githubusercontent.com/sokalive/nassani-admin/main/deploy/contabo/bootstrap-nassani-vps.sh -o /tmp/bootstrap-nassani-vps.sh
chmod +x /tmp/bootstrap-nassani-vps.sh
export NASSANI_VPS_IP='YOUR.VPS.IP'
# optional after DNS:
# export NASSANI_ROOT_DOMAIN='nassanitv.online'
bash /tmp/bootstrap-nassani-vps.sh
```

Credentials land in `/root/nassani-bootstrap-credentials.txt`.

## Updates

```bash
cd /var/www/nassani-admin && bash deploy/contabo/pull-and-apply.sh
```
