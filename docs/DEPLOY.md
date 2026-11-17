# Deploying Stopmoergel on a VPS (Docker)

Stopmoergel is a **static web app**. There is no backend and no database on the server: every movie lives
in the browser of the device that made it (IndexedDB), and kids/teachers save backups as
`.stopmoergel.zip` files. The server only delivers HTML/JS/CSS, so it holds no personal data.

## Why a reverse proxy / HTTPS is required

Browsers only allow **camera and microphone on secure origins** (HTTPS, or `localhost`). Over plain
`http://your-server` the app opens, but cannot take pictures or record sound. So you need TLS, and a
reverse proxy is the simplest place to terminate it.

```
Browser ──HTTPS──▶ reverse proxy (:443) ──HTTP──▶ app container (nginx, 127.0.0.1:APP_PORT → :8080)
```

How to read `docker ps` → `127.0.0.1:8910->8080/tcp`:
- **8080** is the port *inside* the container. It never collides with other apps on the host.
- **8910** is the host port (`APP_PORT` in `.env`). Only this one has to be free.
- **127.0.0.1** means it is reachable from the server itself only. The public goes through the reverse proxy.

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: Node builds and tests the app, then `nginx-unprivileged` serves `dist/` on port 8080 |
| `deploy/nginx.conf` | nginx *inside* the container: caching, gzip, security headers (CSP, Permissions-Policy camera/mic), `/healthz` |
| `deploy/nginx-host.conf` | nginx *on the server* (reverse proxy) for `stopmoergel.bitesnbytes.ch` → `127.0.0.1:8910` |
| `deploy/Caddyfile` | Only for option B (no existing proxy) |
| `docker-compose.yml` | `app` (hardened: read-only, no capabilities). `caddy` is opt-in via `--profile caddy` |
| `.env.example` | `APP_PORT`, and `DOMAIN` for Caddy only |

## Option A: the server already runs nginx (production: stopmoergel.bitesnbytes.ch)

Prerequisites:
- DNS: an **A record** (and AAAA, if the server has IPv6) for `stopmoergel.bitesnbytes.ch` pointing to the VPS.
- certbot is installed (`sudo apt install certbot`).

**1. Start the app container** (only the app; Caddy stays off):

```bash
git clone <your-repo> stopmoergel && cd stopmoergel
cp .env.example .env
nano .env                          # APP_PORT=8910
docker compose up -d --build
curl -s http://127.0.0.1:8910/healthz   # → ok
```

**2. Get the certificate.** Start with a temporary HTTP-only block, because nginx refuses to load the
HTTPS block before the certificate files exist:

```bash
sudo mkdir -p /var/www/certbot
sudo tee /etc/nginx/sites-available/stopmoergel.bitesnbytes.ch >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name stopmoergel.bitesnbytes.ch;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/stopmoergel.bitesnbytes.ch /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/certbot -d stopmoergel.bitesnbytes.ch
```

**3. Install the real config** (HTTP→HTTPS redirect plus the HTTPS proxy to the app):

```bash
sudo cp deploy/nginx-host.conf /etc/nginx/sites-available/stopmoergel.bitesnbytes.ch
sudo nginx -t && sudo systemctl reload nginx
```

If `nginx -t` complains about `http2 on;`, your nginx is older than 1.25.1. Remove that line and use
`listen 443 ssl http2;` instead.

**4. Renewal** happens automatically through certbot's timer, using the webroot from the HTTP block.
Make nginx pick up renewed certificates:

```bash
echo 'systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

Don't add `Content-Security-Policy` or `Permissions-Policy` headers in the host nginx. The app container
already sends the right ones, and `Permissions-Policy` must allow `camera` and `microphone` for the site.

## Option B: nothing on ports 80/443 yet (bundled Caddy)

Set `DOMAIN=…` in `.env` (DNS must point to the server, ports 80 and 443 open), then run:

```bash
docker compose --profile caddy up -d --build
docker compose logs -f caddy   # watch the certificate being issued
```

Keep the `caddy_data` volume: it holds the certificates.

**Traefik** is another reverse proxy, popular with Docker. Use it only if the server already runs it:
drop the `ports:` of `app`, attach it to Traefik's network, and add router labels with
`loadbalancer.server.port=8080`.

## Updating

```bash
git pull
docker compose up -d --build   # rebuilds the app image; your proxy keeps running
docker image prune -f          # optional: remove old images
```

`index.html` is served with `no-cache`, so browsers pick up the new version on the next load. The hashed
assets are cached forever. Users' movies are not affected by updates; they live in their browsers.

## Checks

```bash
curl -s https://stopmoergel.bitesnbytes.ch/healthz      # → ok
curl -sI https://stopmoergel.bitesnbytes.ch/ | grep -i -E 'strict-transport|permissions-policy'
docker compose ps                                      # app should be "healthy"
```

## Notes for schools

- Data stays on the devices. Clearing the browser data deletes the movies, so teach kids to use
  **Speichern → Projekt sichern** for anything important.
- Install it once on the tablets ("Add to Home Screen") so kids find it quickly.
- If tablets are shared between classes, movies of different kids end up in the same browser on that tablet.
  Classroom features (accounts, sharing) are a possible later iteration.

## Verified (2026-11-17, local Colima)

- The image builds, and its build step also runs the typecheck and all unit tests.
- The container runs with `--read-only --cap-drop ALL --security-opt no-new-privileges`. `/healthz` works.
  The headers are right: CSP, Permissions-Policy, immutable assets with gzip, and `no-cache` for index.
- The full browser test suite (camera, recording with AudioWorklet, music import, MP4 export with AAC
  audio, backup/import) passes against the container, with no CSP violations.
- The compose stack with Caddy (`DOMAIN=localhost`, internal CA) serves HTTPS over HTTP/2 and HTTP/3,
  redirects HTTP to HTTPS with a 308, and sends HSTS.
