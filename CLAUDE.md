# CLAUDE.md — Project Context for AI Assistants

## Project
EV · 2090 — a 3D space simulation game with a live NPC economy.
Live: https://ev2090.com | API: https://ws.ev2090.com | MCP: https://mcp.ev2090.com

---

## Tech Stack
- **Frontend:** React 19 + Three.js 0.172 + TypeScript 5.7 + Vite 6
- **Backend:** Cloudflare Workers + Durable Objects + R2 + Queues
- **MCP Server:** 37 tools, OAuth 2.0 PKCE (`worker-mcp/`)
- **Admin Dashboard:** React + Vite, local-only, never deployed (`admin/`)
- **Monorepo:** 4 npm workspaces — `frontend/`, `worker/`, `worker-mcp/`, `admin/`

---

## Architecture — The One Rule

The engine (`frontend/src/engine/`) is **pure Three.js with ZERO React dependencies**.
React communicates with the engine only through `GameCanvasHandle` (imperative ref in `GameCanvas.tsx`).
The engine pushes `GameState` to React at ~20fps via a subscribe callback.

**NEVER import React in `engine/` files. NEVER import Three.js in `components/` files.**

When a component needs 3D rendering, create a standalone class in `engine/` and instantiate it
from the component via `useEffect` — see `ShipPreview.ts` and `ShipDetailRenderer.ts` for the pattern.

---

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/engine/Engine.ts` | Core game loop, scene, renderer, all subsystem orchestration |
| `frontend/src/components/GameCanvas.tsx` | React-to-Engine bridge (forwardRef + useImperativeHandle) |
| `frontend/src/components/Game.tsx` | Top-level React orchestrator — state, layout, breakpoints |
| `frontend/src/types/game.ts` | Shared types: GameState, ShipState, RadarContact, LightConfig |
| `frontend/src/engine/ShipCatalog.ts` | Ship definitions (11 built-in + community registry) |
| `worker/src/index.ts` | HTTP router + CORS + queue consumer |
| `worker/src/chat-room.ts` | Durable Object — SSE chat, 7 messages, ping keep-alive |
| `worker/src/board-room.ts` | Durable Object — community notes per planet station |
| `worker/src/ship-forge.ts` | Durable Object — AI ship pipeline (Grok → Gemini → MeshyAI) |
| `worker/src/economy-region.ts` | Durable Object — NPC economy simulation (SQLite, 60s alarm tick) |
| `worker/src/admin.ts` | Admin API endpoints (auth required via ADMIN_API_KEY) |
| `worker-mcp/src/index.ts` | MCP server entry point — 37 tools, OAuth 2.0 PKCE |
| `admin/src/App.tsx` | Admin dashboard SPA — Economy, Region Detail, Infra Health, Trade Viewer |

---

## Directory Structure

```
frontend/src/
  components/          # React UI — ZERO Three.js imports
    hangar/            # HangarOverlay, ShipCard, ShipDetail, ForgeCreatePanel
    sidebar/           # RadarPanel, ShipDiagnosticPanel, CargoPanel, ShipSelectorPanel
    station/           # SummaryPanel, TradingPanel, LockedPanel, PriceHistoryMini
    config/            # CollapsibleSection building blocks
  engine/              # Pure Three.js — ZERO React imports
    entities/          # Ship, Planet, NpcShip, Bridge
    systems/           # CameraController, InputManager, LightingSetup, NpcManager,
                       # ModelCache, SoundManager, PostProcessing, HeroCamera, Starfield,
                       # NebulaBg, PlanetTextureGen, DebugBeam, OrbitControls, HardpointEditor,
                       # BridgeEditor, MissionEngine, AssetCache
    shaders/           # GLSL as TS template literals (shield, vignette, colorCorrection)
  hooks/               # useBreakpoint, useConfigSlider, useAuth, useMarketPrices, usePlayerEconomy
  types/               # Shared TypeScript interfaces (game.ts, auth.ts)
  config/              # urls.ts — centralized URL config with env-var overrides
  data/                # commodities.ts, stations.ts, heroPresets.ts
  narrative/           # Mission JSON files

worker/src/
  index.ts             # HTTP router — /api/chat, /api/board, /api/forge, /api/market,
                       # /api/admin, /api/auth, /api/player, /api/trade, /api/dev/seed
  chat-room.ts         # ChatRoom DO
  board-room.ts        # BoardRoom DO
  ship-forge.ts        # ShipForge DO (AI pipeline, KV state, queue integration)
  economy-region.ts    # EconomyRegionDO (SQLite schema, tick alarm, 7 tables)
  admin.ts             # Admin route handler + requireAdminAuth()
  cors.ts              # CORS allowlist + applyCors helper
  data/                # commodities, planet-economies static data
  economy/             # Economy helper modules
  types/               # Worker-side type definitions

worker-mcp/src/
  index.ts             # MCP entry point — OAuth, scope routing, 37 tools
  tools/               # 10 tool categories (economy, market, trade, disruptions, etc.)

admin/src/
  App.tsx              # SPA router — Economy, Region, Infra, TradeViewer pages
  api.ts               # AdminAPI client (auth via Bearer token, Vite proxy in dev)
  components/          # AuthGate, Header
  pages/               # EconomyOverview, RegionDetail, InfraHealth, TradeRouteViewer
  engine/              # TradeMapRenderer, TradeMapPlanets, TradeMapRoutes, PlanetTextureGen
```

---

## Patterns

### Engine Systems (`engine/systems/`)
```
constructor(scene, ...)   →   update(dt)   →   dispose()
```
Wire into `Engine.ts`: instantiate in constructor, call `update(dt)` in loop, call `dispose()` in `Engine.dispose()`.

### Engine Entities (`engine/entities/`)
```
constructor(config)   →   update(dt)   →   dispose()
```
Entity owns a `THREE.Group` as root mesh. `scene.add(entity.mesh)` in Engine. All Three.js objects (geometry, materials, textures) **must** be disposed in `dispose()` to prevent GPU memory leaks.

### Durable Objects (`worker/src/`)
```
constructor loads state   →   fetch() routes requests   →   alarm() for periodic work
```
**State is DUAL — in-memory (fast reads) + SQLite/KV (durable). Always update BOTH or data is lost on restart.**

### MCP Tools (`worker-mcp/src/tools/`)
```
validate scope   →   extract params   →   call DO or R2   →   format response
```
Verb prefix controls access: `query_*`/`inspect_*` = read-only, `set_*`/`create_*` = read-write, `delete_*`/`mutate_*` = full-access.

---

## Dev Environment

```bash
npm install           # installs all 4 workspaces
npm run dev           # frontend (5180) + worker (8787) + admin (5181) + auto-seed
npm run dev:frontend  # frontend only — API proxied to production ws.ev2090.com
npm run dev:api       # worker only
npm run dev:admin     # admin dashboard only
npm run seed          # POST /api/dev/seed — seeds local economy (requires no ADMIN_API_KEY)
npm run deploy        # build + deploy frontend to Cloudflare Pages
npm run deploy:api    # deploy worker to Cloudflare Workers
```

Console debug commands: `config()` · `testship()` · `heroshot()` · `hardpoints()` · `forge()` · `ship("id")` · `zoom(n)` · `reset()`
URL shortcuts: `?scene=gameplay` · `?scene=docked` · `?scene=intro` · `?scene=config` · `?scene=heroshot`

---

## First-Time Setup — API Keys

### Local Development (`worker/.dev.vars`)

Copy `worker/.dev.vars.example` to `worker/.dev.vars`. This file is gitignored and never deployed.

```ini
# ── Auth (required for /api/admin/* — leave empty to bypass auth in local dev) ──
ADMIN_API_KEY = "any-string-you-choose"
FORGE_API_KEY = "any-string-you-choose"

# ── Dev flags ──
FORGE_DEV_MODE = "true"     # disables rate limiting
FORGE_LOCKED   = "false"    # allows forge creation

# ── Ship Forge AI pipeline (all optional — COMMISSION tab auto-disables without them) ──
MESHY_API_KEY  = ""    # https://meshy.ai — 3D model generation from images
GEMINI_API_KEY = ""    # https://aistudio.google.com — concept image generation
GROK_API       = ""    # https://console.x.ai — prompt enhancement + lore moderation
```

**Without any `.dev.vars`:** The worker runs in "no-auth" mode — all `/api/admin/*` requests are
allowed with any key. The admin dashboard auto-authenticates in dev. The COMMISSION tab in the
Hangar is disabled if AI keys are missing (the worker reports `aiAvailable: false` on `/api/forge/config`).

### Admin Dashboard (No Setup Needed Locally)

`npm run dev` automatically:
1. Starts the admin on `http://localhost:5181`
2. Bypasses the login screen in dev mode (any key is accepted when no `ADMIN_API_KEY` is set)
3. Auto-seeds the local economy after 8 seconds

### Production Secrets (Cloudflare)

Never put secrets in `wrangler.toml`. Use `wrangler secret put`:

```bash
# Required
wrangler secret put ADMIN_API_KEY  --cwd worker
wrangler secret put FORGE_API_KEY  --cwd worker
wrangler secret put OAUTH_HMAC_SECRET  --cwd worker-mcp

# Ship Forge AI pipeline (required to enable commission feature in production)
wrangler secret put MESHY_API_KEY  --cwd worker
wrangler secret put GEMINI_API_KEY --cwd worker
wrangler secret put GROK_API       --cwd worker

# MCP server — same keys as game worker (read via cross-worker binding)
wrangler secret put MCP_API_KEY        --cwd worker-mcp
wrangler secret put MCP_RO_API_KEY     --cwd worker-mcp
wrangler secret put OAUTH_HMAC_SECRET  --cwd worker-mcp
```

See `docs/cloudflare-setup.md` for the full step-by-step deployment guide.

---

## Common Tasks

### 1. Add a new engine system
1. Create class in `frontend/src/engine/systems/MySystem.ts`
2. Pattern: `constructor(scene, ...)`, `update(dt)`, `dispose()`
3. Import and instantiate in `Engine` constructor
4. Call `update(dt)` in the game loop (`Engine.loop`)
5. Call `dispose()` from `Engine.dispose()`

### 2. Add a new React component
1. Create `MyComponent.tsx` + `MyComponent.css` in `components/`
2. Add to `Game.tsx` render tree
3. Read engine state from the `gameState` prop passed down from Game
4. To call engine methods, add to `GameCanvasHandle` interface and implementation in `GameCanvas.tsx`
5. **All media queries go in `responsive.css`** — never in component CSS files

### 3. Add a config panel slider
1. Add a default value to `DEFAULTS` in `LightDebugPanel.tsx`
2. Create a `useConfigSlider({ initial, onChange })` instance
3. Add a `<CollapsibleSection>` or add to an existing section
4. Wire up the reset handler for the section
5. Include in the COPY CONFIG output object

### 4. Add a new ship
1. Add a `ShipDef` entry to the SHIP_CATALOG array in `ShipCatalog.ts`
2. Place GLTF model + texture PNGs in `public/models/{id}/`
3. Follow naming: `{Name}_Blue.png`, `{Name}_Green.png`, etc.
4. Ship appears automatically in the ship selector and hangar

### 5. Add a new Durable Object
1. Create the class in `worker/src/my-do.ts` — pattern: `constructor` loads state, `fetch()` routes, `alarm()` for ticks
2. Export it from `worker/src/index.ts`
3. Add binding + migration tag to `worker/wrangler.toml` (migrations are append-only — never reorder or rename)
4. Add the binding type to `worker/src/types/`
5. Route requests to it in `index.ts`

### 6. Add a new admin API endpoint
1. Add handler in `worker/src/admin.ts` → `handleAdminRoute()`
2. Call from the admin dashboard via `admin/src/api.ts`
3. Auth is handled by `requireAdminAuth()` — no need to add auth checks per route

### 7. Add a new MCP tool
1. Add implementation in the appropriate `worker-mcp/src/tools/*.ts` file
2. Register it in `worker-mcp/src/tools/index.ts` with the correct scope
3. Pattern: validate scope → extract params → call DO stub → format response
4. Scope verb rules: `query_*/inspect_*` = ro, `set_*/create_*` = rw, `delete_*/mutate_*` = full

---

## Gotchas

- **Engine is pure Three.js** — NEVER add React imports to `engine/` files
- **Components are pure React** — NEVER import Three.js in `components/` files
- **CSS is co-located** — do NOT put component styles in `App.css`; use `ComponentName.css`
- **All media queries in `responsive.css`** — never in component CSS files
- **Use `useConfigSlider`** for new config sliders — not raw `useState`
- **GameCanvas is the only bridge** — never pass the `Engine` instance directly to React
- **DO state is dual** — always update BOTH in-memory state AND SQLite/KV; failing to do so loses data on restart
- **DO migrations are append-only** — never reorder or rename migration tags in `wrangler.toml`
- **Ship mesh hierarchy** — `mesh` → `bankGroup` → `visualGroup` → `modelGroup`; thrusters attach to `mesh` directly (NOT `visualGroup`) to avoid heading displacement
- **Community ships** — `source: "community"`, embedded PBR in GLB, no separate texture files
- **Three.js objects MUST be disposed** in `dispose()` methods — geometry, materials, textures all leak GPU memory if skipped
- **Engine pushes state every 3rd frame** (~20fps) to avoid React re-render overhead
- **NpcShip state machine** — `APPROACHING → DOCKING → DOCKED → DEPARTING → DONE` — never skip states
- **Admin dashboard is local-only** — NEVER deploy `admin/` to Cloudflare
- **MCP scope controls** — `ro` keys cannot call `set_*`, `trigger_*`, `delete_*`, or `mutate_*` tools
- **`ADMIN_API_KEY` absent = dev bypass** — when the env var is not set, all admin requests are allowed (intentional local dev behavior)
- **COMMISSION tab auto-disables** — if `MESHY_API_KEY`, `GEMINI_API_KEY`, and `GROK_API` are not all set, the worker returns `aiAvailable: false` and the tab renders as disabled

---

## Documentation Index

| Doc | When to read it |
|-----|----------------|
| `docs/architecture.md` | System overview, data flows, React-Engine boundary diagram |
| `docs/engine-guide.md` | Engine systems, entities, shaders, ShipCatalog |
| `docs/ui-guide.md` | React components, game states, breakpoints, CSS organization |
| `docs/backend-guide.md` | Worker routing, all 4 Durable Objects, R2, CORS |
| `docs/economy-engine.md` | SQLite schema, tick lifecycle, commodities, MCP control plane |
| `docs/forge-guide.md` | AI ship pipeline, state machine, rate limiting, R2 asset keys |
| `docs/admin-guide.md` | Admin dashboard pages, data flow, how to add widgets |
| `docs/mcp-guide.md` | All 37 tools, 3-tier auth, OAuth 2.0 PKCE, client setup |
| `docs/cloudflare-setup.md` | Full deployment guide — R2, secrets, Queues, Pages, custom domains |
| `docs/self-hosting.md` | Run without Cloudflare — local wrangler, VPS, Docker |
| `docs/dev-tools.md` | Console commands, URL shortcuts, config panel, hardpoint editor |
| `docs/security.md` | Known risks, mitigations, planned fixes |
| `docs/ai.md` | Why these context files exist and how to get the best AI results |
