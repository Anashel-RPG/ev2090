[← Back to index](/README.md)

# Cloudflare Setup Guide

You forked the repo. Now what? This guide walks you through deploying your own instance of EV 2090 on Cloudflare -- from a fresh account to a fully running game with an NPC economy, real-time chat, and community ship forge. Every step explains *why* it matters, not just what to type.

The entire stack runs on Cloudflare. No AWS, no Heroku, no external databases. One account, one bill (usually $0).

---

## Prerequisites

Before you start, make sure you have:

| Requirement | Why |
|-------------|-----|
| **Cloudflare account** | Free tier works for everything in this guide. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com). |
| **Node.js 18+** and **npm** | The build toolchain. Check with `node -v` and `npm -v`. |
| **Wrangler CLI** | Cloudflare's deployment tool. You can use `npx wrangler` (no install needed) or install globally with `npm install -g wrangler`. |

You do **not** need a paid Cloudflare plan. The Workers Free tier includes 100,000 requests/day, 10 GB of R2 storage, and your first million Durable Object requests free. That is more than enough to run your own instance.

---

## 1. Authenticate with Cloudflare

```bash
npx wrangler login
```

This opens your browser and asks you to authorize Wrangler via OAuth. Once you approve, a token is stored locally in `~/.wrangler/config/default.toml`. You will not need to log in again on this machine unless the token expires.

To verify it worked:

```bash
npx wrangler whoami
```

You should see your account name and ID.

---

## 2. Create R2 Buckets

The game uses two R2 buckets for object storage. Create them before deploying anything:

```bash
npx wrangler r2 bucket create ev2090-ships
npx wrangler r2 bucket create ev2090-data
```

### What they store and why they are separate

| Bucket | Binding | Purpose |
|--------|---------|---------|
| `ev2090-ships` | `SHIP_MODELS` | All game assets: built-in ship models, bridge cockpit GLB, planet textures, and community ship models from the Forge. Binary 3D files + images. |
| `ev2090-data` | `STATIC_DATA` | Economy data: price snapshots, commodity catalogs, market history. JSON files, usually tiny. |

They are separate because game assets are large binary blobs with different caching needs than the small JSON files the economy engine writes every few minutes. Keeping them apart makes it easier to set bucket-level policies later (e.g., public CDN access for assets).

If you skip this step, the worker deploy in Step 3 will succeed but the economy warmup and ship forge will fail at runtime with "R2 bucket not found" errors.

### Populate R2 with game assets

After creating the buckets, upload the built-in game assets (ship models, bridge cockpit, planet textures). These are served from R2 via the worker's CDN endpoint.

```bash
cd <repo-root>
bash scripts/setup-r2-assets.sh
```

This script downloads all assets from the public EV 2090 CDN and uploads them to your R2 buckets via `wrangler`. It takes about a minute.

For local development (uploads to wrangler's local R2 emulator instead of remote):

```bash
bash scripts/setup-r2-assets.sh --local
```

To preview what would be uploaded without uploading:

```bash
bash scripts/setup-r2-assets.sh --dry-run
```

#### Self-hosting assets

If you want to create a portable bundle of all game assets (for backup, redistribution, or offline setup):

```bash
bash scripts/bundle-r2-assets.sh
```

This creates `dist/ev2090-assets.zip` containing every asset file with its R2 key structure intact. Anyone can unzip it and upload to their own R2 buckets using `setup-r2-assets.sh`.

#### R2 bucket contents after setup

| Bucket | Key Pattern | Content |
|--------|------------|---------|
| `ev2090-ships` | `ships/{id}/{Name}.gltf` | 11 built-in ship GLTF models |
| `ev2090-ships` | `ships/{id}/{Name}_Blue.png` | Default ship textures |
| `ev2090-ships` | `bridge/bridge.glb` | First-person cockpit GLB (15MB, baked lighting) |
| `ev2090-ships` | `textures/planet-earth.jpg` | Nexara planet texture |
| `ev2090-data` | `market/commodities.json` | Commodity catalog (written by economy seed) |
| `ev2090-data` | `market/regions/core-worlds.json` | Economy snapshots (written every 5 min) |

---

## 3. Deploy the Game Worker

The game worker is the heart of the backend. It runs the HTTP router, four Durable Objects (chat, community board, ship forge, economy), and a queue consumer for the forge pipeline.

```bash
cd worker
npm install
npx wrangler deploy
```

### What happens on first deploy

When Wrangler deploys for the first time, it:

1. **Creates the Worker** named `ev-2090-ws` on your Cloudflare account.
2. **Runs Durable Object migrations** (v1 through v4) that register the four DO classes:
   - `v1` -- `ChatRoom` (SSE real-time chat)
   - `v2` -- `BoardRoom` (community notes per planet station)
   - `v3` -- `ShipForge` (AI ship generation pipeline)
   - `v4` -- `EconomyRegionDO` (NPC economy with SQLite storage)
3. **Creates the queue** `meshy-poll-queue` (used by the Ship Forge to poll MeshyAI for 3D model status).
4. **Binds R2 buckets** -- this is why you created them first.

Migrations are declarative and run automatically. You do not need to manage them manually.

After deploy, Wrangler prints your Worker URL. It looks something like:

```
https://ev-2090-ws.<your-subdomain>.workers.dev
```

Save this URL -- you will need it for the frontend configuration. Test it right now:

```bash
curl https://ev-2090-ws.<your-subdomain>.workers.dev
```

You should get back:

```json
{"service":"escape-velocity","version":"...","status":"ok"}
```

---

## 4. Set Worker Secrets

Secrets are sensitive values stored encrypted on Cloudflare's edge. They are never visible in your `wrangler.toml` or dashboard. Set them one at a time -- Wrangler will prompt you to paste the value:

### Required

```bash
cd worker
npx wrangler secret put ADMIN_API_KEY
```

When prompted, paste a strong random string. This key protects all admin API endpoints (`/api/admin/*`) and is used to log in to the admin dashboard. Generate one with:

```bash
node -e "console.log(crypto.randomUUID())"
```

### Required for Ship Forge

```bash
npx wrangler secret put FORGE_API_KEY
```

This key protects ship forge admin operations (deleting community ships, regenerating lore, hero shots). It is also used by the frontend for local dev access. Use a different value than `ADMIN_API_KEY`.

### Optional -- AI API keys for Ship Forge

The Ship Forge uses a three-stage AI pipeline: concept generation (xAI Grok), image processing (Google Gemini), and 3D model creation (MeshyAI). Without these keys, the game runs fine but the community ship creation feature is disabled.

```bash
npx wrangler secret put GROK_API
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put MESHY_API_KEY
```

### Complete secrets reference

| Secret | Required | Used By | Purpose |
|--------|----------|---------|---------|
| `ADMIN_API_KEY` | Yes | Worker (`admin.ts`) | Authenticates admin dashboard and all `/api/admin/*` routes |
| `FORGE_API_KEY` | Yes | Worker (`ship-forge.ts`) | Protects forge admin operations (delete ships, regen lore) |
| `GROK_API` | No | ShipForge DO | xAI Grok API key -- generates ship concept text and lore |
| `GEMINI_API_KEY` | No | ShipForge DO | Google Gemini API key -- processes concept images for 3D pipeline |
| `MESHY_API_KEY` | No | ShipForge DO | MeshyAI API key -- generates 3D GLB models from concept art |

If you set none of the AI keys, the ship forge catalog is still browsable (existing community ships are stored in R2), but no new ships can be generated.

---

## 5. Initialize the Economy

The economy engine starts empty. It needs a one-time warmup that simulates 24 hours of NPC trading to bootstrap realistic price levels across all planets and commodities.

There are two ways to trigger warmup:

### Option A: Via the admin API (direct)

```bash
curl -X POST https://ev-2090-ws.<your-subdomain>.workers.dev/api/admin/seed \
  -H "Authorization: Bearer <your-ADMIN_API_KEY>"
```

The `/seed` endpoint does two things:
1. Writes the commodity catalog JSON to R2
2. Triggers the economy warmup (1,440 simulated ticks = 24 hours of game time)

### Option B: Via the market endpoint (no auth)

```bash
curl -X POST https://ev-2090-ws.<your-subdomain>.workers.dev/api/market/warmup
```

This triggers warmup directly on the EconomyRegion Durable Object. It does not write the commodity catalog to R2, so Option A is preferred for initial setup.

### What warmup does

The warmup runs 1,440 economy ticks in rapid succession. Each tick simulates:

- Planet production and consumption of 25 commodities
- NPC trade route departures and deliveries between planets
- Price recalculation based on supply/demand ratios
- Random market disruptions (production halts, demand surges)
- Price history recording

After warmup completes, the economy starts ticking in real-time (once per minute) via Durable Object alarms. Prices fluctuate naturally from that point forward.

The response will look like:

```json
{
  "ok": true,
  "commoditiesWritten": 25,
  "warmupResult": { "ticksRun": 1440, "warmupComplete": true }
}
```

After warmup, you can verify the economy is alive:

```bash
curl https://ev-2090-ws.<your-subdomain>.workers.dev/api/market/prices
```

You should see price data for all planets and commodities.

---

## 6. Deploy the Frontend

The frontend is a Vite-built React SPA deployed to Cloudflare Pages.

### Install dependencies

```bash
cd frontend
npm install
```

### Configure the API proxy

During development, Vite proxies `/api/*` requests to the backend. By default it points to the production API (`https://ws.ev2090.com`). To point it at your own worker, create or edit `frontend/.env.development.local`:

```env
VITE_API_PROXY_TARGET=https://ev-2090-ws.<your-subdomain>.workers.dev
```

For the Ship Forge admin features in local dev, also add:

```env
VITE_FORGE_API_KEY=<your-FORGE_API_KEY>
```

### Deploy to Cloudflare Pages

First, create the Pages project (one-time):

```bash
npx wrangler pages project create ev-2090
```

When prompted, accept the default production branch (`main`).

Then build and deploy:

```bash
npm run build
npx wrangler pages deploy dist
```

Or from the repo root (which does both):

```bash
npm run deploy
```

Wrangler will print your Pages URL:

```
https://ev-2090.pages.dev
```

### Important: Production API URL

The deployed frontend needs to know where your game worker lives. In production (the built SPA), the frontend makes API calls to relative paths (`/api/*`). For this to work, you need either:

**Option A: Custom domain with routing** (recommended -- see Step 9)

Set up a custom domain so the frontend and API share the same origin. No CORS issues, no environment variables needed.

**Option B: Direct Worker URL**

The frontend's Vite config defaults to proxying to production in dev mode. For the deployed SPA on Pages, API calls go to relative paths. You may need to set up a Pages Function or redirect rule to proxy `/api/*` to your Worker URL. The simplest path is a custom domain (Step 9).

---

## 7. Admin Dashboard (local only)

The admin dashboard is a local development tool for monitoring the economy, viewing price charts, triggering disruptions, and managing trade routes. It is **not deployed** — run it locally:

```bash
cd admin
npm install
npm run dev
```

It will prompt for an API key on load. Enter the `ADMIN_API_KEY` from Step 4.

> **Never deploy the admin dashboard to a public host.** It has not been hardened for production — there is no IP restriction, no rate limiting, no session management, and the API key is stored in plain text in `localStorage`. If you need remote admin access, use the MCP server instead. The deploy commands in `package.json` exist for internal use only and should not be used for public deployment.

---

## 8. Deploy the MCP Worker (optional)

The MCP (Model Context Protocol) worker provides an AI-friendly control plane for the economy. It lets Claude, ChatGPT, or any MCP-compatible client inspect and manipulate the game economy through structured tool calls -- diagnosing commodity shortages, triggering disruptions, querying price history, managing trade routes, and more.

```bash
cd worker-mcp
npm install
npx wrangler deploy
```

### Set MCP secrets

The MCP worker uses a tiered API key system for access control:

```bash
cd worker-mcp
npx wrangler secret put MCP_API_KEY
npx wrangler secret put MCP_API_KEY_RW
npx wrangler secret put MCP_API_KEY_RO
npx wrangler secret put OAUTH_HMAC_SECRET
```

| Secret | Purpose |
|--------|---------|
| `MCP_API_KEY` | Full access -- read, write, delete, raw SQL queries |
| `MCP_API_KEY_RW` | Read/write access -- no delete, no raw SQL |
| `MCP_API_KEY_RO` | Read-only access -- safe for monitoring |
| `OAUTH_HMAC_SECRET` | Signs OAuth tokens for the Claude.ai integration |

You only need to set the tiers you plan to use. If you only want full access, just set `MCP_API_KEY`.

### Connect to Claude.ai

The MCP worker supports the Remote MCP Server protocol. To connect it to Claude.ai:

1. Go to [claude.ai/settings](https://claude.ai/settings) and find the MCP integrations section.
2. Add a new remote MCP server with your worker URL:
   ```
   https://ev2090-mcp.<your-subdomain>.workers.dev
   ```
3. Authenticate with one of the API keys you set above.

Once connected, Claude can inspect the economy, diagnose pricing anomalies, trigger events, and manage the game world through natural conversation.

### Cross-worker bindings

The MCP worker communicates with the game worker's Durable Objects via cross-worker service bindings defined in `worker-mcp/wrangler.toml`. These reference the game worker by its name `ev-2090-ws`. If you renamed the game worker in Step 3, update the `script_name` values in the MCP worker's `wrangler.toml` to match.

---

## 9. Custom Domains (optional)

By default, you get `*.workers.dev` and `*.pages.dev` URLs. If you own a domain and want cleaner URLs, you can configure custom domains in the Cloudflare dashboard.

### For the Game Worker

1. Go to **Workers & Pages** in the Cloudflare dashboard.
2. Click your worker (`ev-2090-ws`).
3. Go to **Settings** > **Triggers** > **Custom Domains**.
4. Add your domain, e.g., `api.yourgame.com`.

Your domain must be on Cloudflare DNS (either as your registrar, or with nameservers pointed to Cloudflare).

### For Pages (frontend)

1. Go to **Workers & Pages** > your Pages project.
2. Go to **Custom domains**.
3. Add your domain, e.g., `yourgame.com` or `play.yourgame.com`.

### DNS setup

If your domain is already on Cloudflare DNS, custom domains are configured automatically (Cloudflare adds the DNS records for you). If you are using an external DNS provider, you will need to add a `CNAME` record pointing to your `*.workers.dev` or `*.pages.dev` hostname.

### Sharing an origin (recommended)

The cleanest setup is to put the frontend and API on the same domain. For example:

- `yourgame.com` -- frontend (Pages)
- `yourgame.com/api/*` -- routed to your Worker via a Pages Function or Cloudflare Rule

This eliminates all CORS concerns because everything is same-origin. Alternatively:

- `yourgame.com` -- frontend (Pages)
- `api.yourgame.com` -- game worker (Workers custom domain)

The worker already includes CORS headers for cross-origin requests, so this works too, but same-origin is simpler.

---

## 10. External API Keys (for Ship Forge)

The Ship Forge AI pipeline is entirely optional. The game runs perfectly without it -- players can still fly ships, trade commodities, chat, and explore. But if you want community ship generation, you will need accounts with three AI services.

### MeshyAI -- 3D model generation

1. Sign up at [meshy.ai](https://www.meshy.ai/)
2. Go to your API settings and copy your API key
3. Set it: `npx wrangler secret put MESHY_API_KEY` (in the `worker/` directory)

MeshyAI converts concept images into 3D GLB models. This is the most expensive part of the pipeline -- each ship generation costs roughly $0.10-0.30 in API credits.

### Google Gemini -- image processing

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Create an API key
3. Set it: `npx wrangler secret put GEMINI_API_KEY` (in the `worker/` directory)

Gemini processes the concept art into clean reference images for the 3D pipeline and generates hero shot compositions. Gemini has a generous free tier.

### xAI Grok -- concept generation

1. Go to [x.ai](https://x.ai/) and create an API account
2. Generate an API key
3. Set it: `npx wrangler secret put GROK_API` (in the `worker/` directory)

Grok generates ship concept text, lore descriptions, and design briefs that feed into the visual pipeline. The xAI API has pay-as-you-go pricing.

### Forge lock

By default, the ship forge is locked for public creation (the `FORGE_LOCKED` variable is set to `"true"` in `wrangler.toml`). This means the catalog is browsable but players cannot generate new ships. To unlock public creation, change this in your `worker/wrangler.toml`:

```toml
[vars]
FORGE_LOCKED = "false"
```

Then redeploy:

```bash
cd worker
npx wrangler deploy
```

You can also keep it locked and only create ships via the admin dashboard or MCP worker using the `FORGE_API_KEY`.

---

## Cost Estimate

Here is what to expect on your Cloudflare bill. The honest answer for most forks: **$0/month**.

### Free tier limits

| Resource | Free Tier | Enough For |
|----------|-----------|------------|
| Workers requests | 100,000/day | A few hundred daily players |
| Durable Object requests | First 1 million/month | Economy ticks + chat for weeks |
| Durable Object storage | 1 GB included | Years of economy history |
| R2 storage | 10 GB | Thousands of community ships |
| R2 Class A ops (writes) | 1 million/month | Economy snapshots every 5 minutes |
| R2 Class B ops (reads) | 10 million/month | All static data fetches |
| R2 egress | Free (always) | Unlimited bandwidth |
| Pages | Unlimited sites, 500 deploys/month | More than enough |
| Queues | First 1 million ops/month | Forge polling for hundreds of ships |

### When you exceed free tier

| Usage Level | Estimated Monthly Cost | Scenario |
|-------------|----------------------|----------|
| Solo dev / small fork | **$0** | You and a few friends playing |
| Active hobby project | **$0 - $5** | 50-100 daily players, active economy |
| Popular fork | **$5 - $15** | 500+ daily players, frequent forge usage |

### Cost breakdown (paid tier)

| Service | Unit Cost | Typical Usage | Monthly |
|---------|-----------|---------------|---------|
| Workers | $0.50/million requests | ~500k requests | $0.25 |
| Durable Objects compute | $12.50/million requests | ~2M requests (60 ticks/hr) | $25.00 |
| Durable Objects storage | $0.20/GB | ~100 MB | $0.02 |
| R2 storage | $0.015/GB | ~2 GB | $0.03 |
| R2 operations | $4.50/million (Class A) | ~50k writes | $0.22 |
| Queues | $0.40/million ops | ~100k ops | $0.04 |
| **Total** | | | **~$0 - $5** |

The big cost driver is Durable Object compute -- the economy ticks once per minute, and each tick touches multiple DB rows. For a personal fork, this stays well within the free tier. External AI costs (MeshyAI, Gemini, Grok) are separate and only apply if you enable the Ship Forge.

---

## Troubleshooting

### "R2 bucket not found" errors

You need to create the R2 buckets before deploying the worker. Go back to Step 2 and run the `wrangler r2 bucket create` commands. Then redeploy the worker.

### "Durable Object not found" or migration errors

This usually means the worker has not been deployed yet, or the `wrangler.toml` migrations are out of sync. The fix:

```bash
cd worker
npx wrangler deploy
```

Wrangler runs all pending migrations on deploy. If you see migration conflicts, make sure you have not manually edited the migration tags in `wrangler.toml`.

### Economy warmup fails or returns an error

Check the worker logs for details:

```bash
npx wrangler tail ev-2090-ws
```

This streams live logs from your worker. Then trigger warmup again in another terminal. Common issues:

- **R2 bucket not created** -- warmup writes price snapshots to R2
- **Worker just deployed** -- the Durable Object may need a moment to initialize its SQLite schema; retry the warmup

### "Unauthorized" from admin endpoints

Make sure your `Authorization` header format is correct:

```bash
curl -H "Authorization: Bearer your-actual-api-key-here" \
  https://ev-2090-ws.<your-subdomain>.workers.dev/api/admin/economy/regions
```

The key must match the `ADMIN_API_KEY` secret you set in Step 4 exactly. To check what secrets are configured:

```bash
cd worker
npx wrangler secret list
```

This shows secret names (never values). If you need to change a secret, just run `npx wrangler secret put <NAME>` again -- it overwrites the previous value.

### Frontend shows "Failed to fetch" or CORS errors

This means the frontend cannot reach the API. Check:

1. **Dev mode**: Is `VITE_API_PROXY_TARGET` in `frontend/.env.development.local` pointing to your worker?
2. **Production**: Is the frontend deployed to a domain that shares an origin with the worker, or does the worker URL match what the frontend expects?

The worker includes CORS headers for cross-origin requests, but the simplest fix is always to put both on the same domain (see Step 9).

### Chat/SSE not working locally

The Vite dev server needs special proxy configuration to stream SSE events without buffering. This is already configured in `vite.config.ts`. If you are using a different dev server or reverse proxy, make sure it does not buffer the `/api/chat/stream` response.

### Ship Forge not generating ships

Check in order:

1. Is `FORGE_LOCKED` set to `"false"` in `wrangler.toml`? (Default is `"true"`)
2. Are all three AI secrets set? (`GROK_API`, `GEMINI_API_KEY`, `MESHY_API_KEY`)
3. Check worker logs with `npx wrangler tail ev-2090-ws` while triggering a generation

The forge pipeline has multiple stages -- Grok for concept, Gemini for image processing, MeshyAI for 3D generation. If any key is missing, the pipeline fails at that stage.

### MCP worker cannot reach the game worker

The MCP worker uses cross-worker service bindings (`script_name = "ev-2090-ws"` in `worker-mcp/wrangler.toml`). If you renamed the game worker, update every `script_name` reference in the MCP worker's `wrangler.toml` to match:

```toml
[[durable_objects.bindings]]
name = "ECONOMY_REGION"
class_name = "EconomyRegionDO"
script_name = "your-renamed-worker"    # must match the game worker's name
```

Then redeploy the MCP worker.

### General debugging

```bash
# Stream live logs from any worker
npx wrangler tail ev-2090-ws

# Check what is deployed
npx wrangler deployments list

# Check R2 bucket contents
npx wrangler r2 object list ev2090-data --prefix market/

# Check secret names (not values)
cd worker && npx wrangler secret list
```

---

## Quick Reference -- Deploy Commands

For day-to-day use, here is every deploy command in one place:

| What | Command | Where to Run |
|------|---------|--------------|
| **Game Worker** | `npm run deploy:api` | Repo root |
| **Frontend** | `npm run deploy` | Repo root |
| **Admin Dashboard** | `npm run dev:admin` | Repo root (local only) |
| **MCP Worker** | `npm run deploy:mcp` | Repo root |
| **Everything** | Deploy each in sequence | Repo root |

Or if you prefer running them from each workspace:

```bash
cd worker     && npx wrangler deploy
cd frontend   && npm run build && npx wrangler pages deploy dist
cd admin      && npm run dev     # local only — never deploy
cd worker-mcp && npx wrangler deploy
```

---

## What Next?

Once everything is deployed:

1. Open your frontend URL in a browser -- you should see the game with ship selection
2. Pick a ship and fly around -- chat should work, planets should be there
3. Dock at a planet and check the trading panel -- prices should be populated from the economy
4. Open the admin dashboard to inspect economy health and watch price charts
5. If you set up the MCP worker, connect it to Claude and ask it to diagnose the iron market on Velkar

Welcome to your own corner of the EV 2090 universe.

---

## Related Docs

- **[backend-guide.md](./backend-guide.md)** -- Worker architecture, Durable Objects, routing
- **[mcp-guide.md](./mcp-guide.md)** -- MCP server setup and tool reference
- **[forge-guide.md](./forge-guide.md)** -- Ship Forge pipeline and external API details
- **[economy-engine.md](./economy-engine.md)** -- Economy tick engine and warmup process
