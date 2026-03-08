[← Back to index](/README.md)

# Self-Hosting Guide

This guide covers running EV 2090 **without a Cloudflare account**. The entire stack -- frontend, game worker, economy engine, chat -- can run locally or on any server using Cloudflare's open-source runtime.

If you want to deploy on Cloudflare (free tier, easiest path), skip this guide and follow [cloudflare-setup.md](./cloudflare-setup.md) instead.

---

## How it works

The game backend is built on Cloudflare Workers + Durable Objects. Cloudflare open-sourced their runtime as **workerd**, and their dev tooling (**Wrangler + Miniflare**) can emulate the full stack locally with file-based persistence. This means:

- **Durable Objects** (chat, economy, forge) run identically in local mode
- **SQLite-in-DO** (economy engine) persists to disk
- **R2 buckets** are emulated as local file storage
- **Queues** (ship forge polling) work in local emulation

No code changes required. Same runtime, same APIs.

---

## Option A: Local with Wrangler (recommended)

This is the simplest path. Wrangler's dev mode uses Miniflare (which wraps workerd) to run the full stack with file-based persistence.

### Prerequisites

- Node.js 18+
- npm

### 1. Install and build

```bash
git clone <repo-url> ev2090
cd ev2090
npm install
```

### 2. Configure environment

Create `worker/.dev.vars`:

```env
ADMIN_API_KEY = "pick-any-strong-secret"
FORGE_API_KEY = "pick-another-secret"
FORGE_DEV_MODE = "true"
FORGE_LOCKED = "true"
```

### 3. Start the worker locally

```bash
cd worker
npx wrangler dev --persist-to=.wrangler/persist
```

This starts the game worker on `http://localhost:8787` with all Durable Objects, local R2, and local SQLite. The `--persist-to` flag saves all state to disk so it survives restarts.

### 4. Populate game assets

The built-in ship models, bridge cockpit, and planet textures need to be in R2. In local mode, upload them to the local R2 emulator:

```bash
bash scripts/setup-r2-assets.sh --local
```

### 5. Initialize the economy

```bash
curl -X POST http://localhost:8787/api/market/warmup
```

This runs 1,440 simulated ticks (~24 hours of game time) to bootstrap realistic price levels.

### 6. Start the frontend

In a separate terminal:

```bash
cd frontend
npm run dev
```

The Vite dev server starts on `http://localhost:5180` and proxies `/api/*` to the local worker automatically.

Open [http://localhost:5180](http://localhost:5180) and play.

### Persistence

All state is saved in `worker/.wrangler/persist/`:
- Durable Object storage (SQLite databases, KV)
- R2 bucket contents
- Queue data

Delete this directory to start fresh.

---

## Option B: Self-hosted on a VPS

Run the same stack on a remote server with a domain and HTTPS.

### Architecture

```
┌──────────────┐
│  Caddy/nginx │ ← HTTPS termination + reverse proxy
│  port 443    │
├──────────────┤
│  Wrangler    │ ← Game worker (Durable Objects, R2, SQLite)
│  port 8787   │
├──────────────┤
│  Static files│ ← Frontend SPA (built with Vite)
└──────────────┘
```

### 1. Build the frontend

Set `VITE_API_URL` to your domain before building:

```bash
cd frontend
VITE_API_URL=https://yourdomain.com npm run build
```

This bakes your API URL into the production bundle. The `dist/` folder contains the static SPA.

### 2. Start the worker

```bash
cd worker
npx wrangler dev --persist-to=.wrangler/persist --port 8787
```

For production use, consider running this under a process manager like `pm2` or `systemd`:

```bash
# pm2 example
pm2 start "npx wrangler dev --persist-to=.wrangler/persist --port 8787" --name ev2090-worker
```

### 3. Reverse proxy with Caddy

[Caddy](https://caddyserver.com/) handles HTTPS automatically via Let's Encrypt.

Create a `Caddyfile`:

```
yourdomain.com {
    # API requests → worker
    handle /api/* {
        reverse_proxy localhost:8787
    }

    # Everything else → frontend static files
    handle {
        root * /path/to/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
```

Start Caddy:

```bash
caddy run
```

Your game is now live at `https://yourdomain.com`.

### Nginx alternative

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    # SSL certs (use certbot for Let's Encrypt)
    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # API → worker
    location /api/ {
        proxy_pass http://localhost:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        # SSE: disable buffering for chat streams
        proxy_buffering off;
        proxy_cache off;
    }

    # Frontend static files
    location / {
        root /path/to/frontend/dist;
        try_files $uri /index.html;
    }
}
```

---

## Option C: Docker

Wrap everything in containers for portability.

### Dockerfile (worker)

```dockerfile
FROM node:20-slim

WORKDIR /app
COPY worker/ ./worker/
COPY package.json package-lock.json ./

RUN npm install --workspace=worker

WORKDIR /app/worker
EXPOSE 8787

CMD ["npx", "wrangler", "dev", "--persist-to=.wrangler/persist", "--port=8787", "--ip=0.0.0.0"]
```

### docker-compose.yml

```yaml
version: "3.8"

services:
  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    ports:
      - "8787:8787"
    volumes:
      - worker-data:/app/worker/.wrangler/persist
    environment:
      - ADMIN_API_KEY=your-secret
      - FORGE_API_KEY=your-forge-secret
      - FORGE_LOCKED=true

  frontend:
    image: caddy:2-alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./frontend/dist:/srv
      - ./Caddyfile:/etc/caddy/Caddyfile
    depends_on:
      - worker

volumes:
  worker-data:
```

---

## Domain and URL Configuration

### Environment variables

The frontend reads two env vars at build time:

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_URL` | `https://ws.ev2090.com` | API base URL (game worker) |
| `VITE_CDN_URL` | `https://cdn.ev2090.com` | CDN base URL (static assets: images, audio) |

In dev mode, `VITE_API_URL` is ignored -- the Vite dev proxy handles API routing.

In production, set these before building:

```bash
VITE_API_URL=https://yourdomain.com VITE_CDN_URL=https://yourdomain.com npm run build
```

### Single-domain setup (simplest)

If your reverse proxy serves both the frontend and proxies `/api/*` to the worker, set:

```bash
VITE_API_URL=https://yourdomain.com
```

For CDN assets (sounds, images), the worker already serves them from R2 via `/api/forge/asset/`. So you can skip `VITE_CDN_URL` if you serve those from the same origin. See the CSS section below for the 3 remaining hardcoded URLs.

### Multi-domain setup

If you want a separate CDN domain (like the production setup):

```bash
VITE_API_URL=https://api.yourgame.com
VITE_CDN_URL=https://cdn.yourgame.com
```

You would need to serve R2 assets from the CDN domain (e.g., via MinIO + nginx, or S3 + CloudFront).

### CSS background images

Three CSS files contain hardcoded CDN URLs for cosmetic backgrounds:

| File | Image |
|------|-------|
| `components/IntroScreen.css` | `splash.jpg` (intro screen) |
| `components/StationOverlay.css` | `terminal.jpg` (mobile station terminal) |
| `components/hangar/ForgeCreatePanel.css` | `nebula.jpg` (forge panel gradient) |

These are the only URLs not driven by env vars (CSS cannot read Vite env vars). To update them for your domain, find and replace in those 3 files:

```bash
# Replace CDN domain in CSS files
find frontend/src -name "*.css" -exec sed -i '' \
  's|https://cdn.ev2090.com|https://yourdomain.com/api/forge/asset|g' {} +
```

Or just replace them manually -- they are cosmetic backgrounds and the game works without them.

---

## R2 Storage Alternatives

In local/self-hosted mode, Wrangler emulates R2 with local file storage. This is good enough for most cases.

For a production self-hosted setup, you could:

1. **Keep using Wrangler's local R2** -- simplest, state is in `.wrangler/persist/`
2. **Use MinIO** -- S3-compatible, self-hosted. The worker code does not need changes because it accesses R2 through the Cloudflare binding API, which Wrangler/workerd emulates
3. **Cloudflare R2 only** -- if you want to use R2 without the rest of Cloudflare, you can create a free Cloudflare account just for R2 storage (10 GB free, zero egress fees)

---

## What works differently without Cloudflare

| Feature | On Cloudflare | Self-hosted | Impact |
|---------|--------------|-------------|--------|
| **Durable Objects** | Edge-distributed | Single-process (workerd) | No functional difference for single-region |
| **SQLite in DO** | Cloudflare-managed | Local file via workerd | Identical API |
| **R2 storage** | Global CDN | Local filesystem | Slower for distant users, but functional |
| **Queues** | Managed | Miniflare emulation | Works in `wrangler dev`, not standalone workerd |
| **Pages** | Global CDN + edge | nginx/Caddy static serve | You handle HTTPS + caching |
| **Custom domains** | Cloudflare DNS | Your DNS + reverse proxy | Same result, more manual setup |
| **Auto-scaling** | Unlimited | Single server | Fine for small communities |
| **DDoS protection** | Included | You handle it | Consider Cloudflare Tunnel as a middle ground |

### Ship Forge caveat

The ship forge pipeline uses Cloudflare Queues for polling MeshyAI job status. Queues work in `wrangler dev` mode but not in standalone workerd. If you use the forge, stick with `wrangler dev`. If you do not need AI ship generation, this does not matter.

---

## Quick Start Checklist

```
[ ] Clone repo, npm install
[ ] Create worker/.dev.vars with ADMIN_API_KEY and FORGE_API_KEY
[ ] Start worker: cd worker && npx wrangler dev --persist-to=.wrangler/persist
[ ] Populate assets: bash scripts/setup-r2-assets.sh --local
[ ] Warmup economy: curl -X POST http://localhost:8787/api/market/warmup
[ ] Start frontend: cd frontend && npm run dev
[ ] Open http://localhost:5180
```

For production deployment, add:

```
[ ] Build frontend with VITE_API_URL set to your domain
[ ] Set up reverse proxy (Caddy or nginx)
[ ] Run worker under a process manager (pm2 or systemd)
[ ] Update CSS CDN URLs (3 files, see above)
[ ] Configure DNS for your domain
```

---

## Related Docs

- **[cloudflare-setup.md](./cloudflare-setup.md)** -- deploying on Cloudflare (recommended for most users)
- **[backend-guide.md](./backend-guide.md)** -- Worker architecture, Durable Objects, routing
- **[economy-engine.md](./economy-engine.md)** -- Economy tick engine and warmup process
- **[security.md](./security.md)** -- Security model, API keys, CORS
