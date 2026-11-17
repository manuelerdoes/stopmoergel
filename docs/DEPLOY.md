# Deploying Stopmoergel on a VPS (Docker)

Stopmoergel is a **static web app**. There is no backend and no database on the server: every movie lives
in the browser of the device that made it (IndexedDB), and kids/teachers save backups as
`.stopmoergel.zip` files. The server only delivers HTML/JS/CSS, so it holds no personal data.

## Why a reverse proxy / HTTPS is required

Browsers only allow **camera and microphone on secure origins** (HTTPS, or `localhost`). Over plain
`http://your-server` the app opens, but cannot take pictures or record sound. So you need TLS, and a
reverse proxy is the simplest place to terminate it.

```
Browser ──HTTPS──▶ Caddy (:443, Let's Encrypt) ──HTTP──▶ app (nginx, :8080, non-root, read-only)
```

## Files

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: Node builds and tests the app, then `nginx-unprivileged` serves `dist/` on port 8080 |
| `deploy/nginx.conf` | Caching (hashed assets immutable, `index.html` no-cache), gzip, security headers (CSP, Permissions-Policy camera/mic), `/healthz` |
| `deploy/Caddyfile` | HTTPS with automatic certificates, HSTS, compression, proxy to `app:8080` |
| `docker-compose.yml` | `app` (hardened: read-only, no capabilities) + `caddy` |
| `.env.example` | `DOMAIN`, `APP_PORT` |

## Option A: fresh VPS, Caddy does HTTPS (recommended)

Prerequisites: Docker with the Compose plugin, a domain whose **A/AAAA record points to the VPS**, and
ports **80 and 443** open in the firewall (80 is needed for the Let's Encrypt challenge and the redirect).

```bash
git clone <your-repo> stopmoergel && cd stopmoergel
cp .env.example .env
nano .env                      # DOMAIN=stopmo.your-domain.org
docker compose up -d --build
docker compose logs -f caddy   # watch the certificate being issued
```

Open `https://stopmo.your-domain.org`. Keep the `caddy_data` volume: it holds the certificates. If you
delete it you risk Let's Encrypt rate limits.

## Option B: the VPS already runs a reverse proxy

Run only the app. It listens on `127.0.0.1:8080` (change it with `APP_PORT` in `.env`):

```bash
docker compose up -d --build app
```

Then proxy your domain to it, for example with **nginx**:

```nginx
server {
    listen 443 ssl http2;
    server_name stopmo.your-domain.org;
    # ssl_certificate … (certbot etc.)
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

With **Traefik**, drop the `ports:` of `app`, attach it to Traefik's network, and add the usual router
labels with `loadbalancer.server.port=8080`.

Don't let your proxy override the app's `Content-Security-Policy` or `Permissions-Policy` headers. In
particular, `Permissions-Policy` must allow `camera` and `microphone` for the site itself.

## Updating

```bash
git pull
docker compose up -d --build   # rebuilds the app image; Caddy keeps running
docker image prune -f          # optional: remove old images
```

`index.html` is served with `no-cache`, so browsers pick up the new version on the next load. The hashed
assets are cached forever. Users' movies are not affected by updates; they live in their browsers.

## Checks

```bash
curl -s https://stopmo.your-domain.org/healthz         # → ok
curl -sI https://stopmo.your-domain.org/ | grep -i -E 'strict-transport|permissions-policy'
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
