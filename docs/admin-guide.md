[← Back to index](/README.md)

# Admin Dashboard Guide

The admin dashboard is your mission control for the EV 2090 economy. It gives you a live, bird's-eye view of every planet market, every NPC trade route, and every tick of the simulation engine -- all from a single browser tab. When something goes wrong (a commodity drains to zero, a trade route goes dead, the tick engine hiccups), the dashboard tells you before your players do.

> **Warning:** The admin dashboard is a **local development tool only**. It has not been hardened for public deployment — there is no IP restriction, no rate limiting, no session management, and the API key is stored in `localStorage`. **Never deploy it to a public host.** Run it locally with `npm run dev:admin`.

---

## Quick Start

```bash
# From the repo root:
npm run dev:admin
```

Open [http://localhost:5181](http://localhost:5181). You will see a login screen asking for your API key.

Enter the same `ADMIN_API_KEY` you set on the worker:

```bash
wrangler secret put ADMIN_API_KEY
```

The key is stored in `localStorage` (under `ev2090:adminApiKey`) so you only need to enter it once per browser. Click **CONNECT** -- if the key is valid, you land on the Economy Overview. If not, you get a clear error and can try again.

> **Tip:** You can also set `VITE_FORGE_API_KEY` in a `.env` file during development to skip the login screen entirely.

---

## Architecture at a Glance

The admin dashboard is a standalone SPA that follows the same React-Engine boundary as the game itself:

```
admin/src/
  App.tsx              React shell -- auth gate, page router, header
  api.ts               API client singleton (all fetch calls)
  types.ts             TypeScript interfaces (mirrors worker types)
  components/          Shared UI: AuthGate, Header, StatusBadge, Sparkline, PriceCell
  pages/               Four page components (see below)
  engine/              Pure Three.js (Trade Route Viewer 3D renderer)
  lib/                 Pure data logic (problem detection, forecast engine)
```

The golden rule still applies: **engine/** files import Three.js, never React. **pages/** and **components/** files import React, never Three.js. The `TradeRouteViewer` page bridges the two using a `<canvas>` ref, just like the game's `GameCanvas`.

### Data Flow

```
Admin Dashboard  ──►  /api/admin/*  ──►  Worker (index.ts)  ──►  EconomyRegion DO
     (React)           (fetch)            (auth check)            (SQLite + state)
```

All API calls go through the `AdminAPI` singleton (`admin/src/api.ts`). In dev, Vite proxies `/api/admin` to `https://ws.ev2090.com`. In production, the dashboard talks directly to the worker. Every request includes a `Bearer` token in the `Authorization` header.

### Auto-Refresh

Every page polls for fresh data on a timer:

| Page | Refresh Interval |
|------|-----------------|
| Economy Overview | 30 seconds |
| Region Detail | 30 seconds (with visible countdown) |
| Trade Route Viewer | 15 seconds |
| Infrastructure Health | 15 seconds |

### Theme Support

The header includes a sun/moon toggle that switches between dark and light themes. The preference is persisted in `localStorage` under `ev2090:adminTheme`. Theme switching works via CSS custom properties on a `[data-theme]` attribute on the document root -- no re-render required.

---

## Pages

### Economy Overview

**File:** `admin/src/pages/EconomyOverview.tsx`

This is your landing page. It answers the question: "Is the economy running, and is anything on fire?"

#### Summary Stats

Five stat cards across the top give you the pulse at a glance:

| Card | What it shows |
|------|--------------|
| **Regions** | Number of active economy regions (currently 1: "core-worlds") |
| **Planets** | Number of simulated planets in the region |
| **Commodities** | Number of commodity types in the market |
| **Last Tick** | Time since the last economy tick, with a health status badge |
| **Disruptions** | Count of currently active market disruptions |

The Last Tick card shows a `StatusBadge` -- green for healthy, yellow for warning, red for down.

#### Cross-Planet Price Table

A table showing 6 key commodities (iron, grain, fuel cells, microchips, quantum cores, steel) across all planets. Each cell contains:

- The current price, color-coded: **green** if below 85% of base (cheap), **red** if above 115% of base (expensive), neutral otherwise
- A trend arrow (up, down, or flat) based on the 24h price change

The rightmost column shows an **aggregate sparkline** -- a mini SVG chart averaging the normalized price ratios of all commodities on that planet. Rising sparkline = prices trending up system-wide.

Click any planet row to navigate to the Region Detail page.

#### Commodity Balance Report

Below the price table sits the balance report. This is the most actionable widget on the page -- it shows which commodities are in **deficit** (the system consumes more than it produces) and which are in **surplus** (the opposite).

For each commodity, the table shows:

| Column | Meaning |
|--------|---------|
| **85%+** | Number of planets where fill ratio is above 85% (saturated). Hover for names. |
| **15%-** | Number of planets where fill ratio is below 15% (starving). Hover for names. |
| **Production** | Total system-wide production per tick |
| **Consumption** | Total system-wide consumption per tick |
| **Net Flow** | Production minus consumption. Negative = deficit, positive = surplus. |
| **Status** | Badge: DEFICIT (red), SURPLUS (yellow), or BALANCED (green) |

Commodities are grouped by category (minerals, food, tech, industrial, luxury) and sorted alphabetically within each group.

#### SEED & WARMUP Button

If the economy is not yet initialized (tick number is 0 or health is red), a prominent button appears:

> **SEED & WARMUP** -- Seeds commodity data to R2 and runs a 1440-tick (24-hour) warmup simulation to bring markets to a natural equilibrium.

This is a one-time operation for fresh deployments. The button disappears once the economy is running.

---

### Region Detail

**File:** `admin/src/pages/RegionDetail.tsx` + `RegionDetail.css`

This is the deep-dive page. Select a planet, inspect every commodity, view price history charts, manage trade routes, and inject disruptions.

#### Planet Commodity Grid

Each planet's commodities are displayed in a detailed grid with:

- **Current price** and base price comparison
- **Fill ratio** as a colored bar (red < 25%, blue 25-75%, green > 75%)
- **Production and consumption** rates per tick
- **Sparkline** showing price trend
- **Health status icon** (see below)

#### Health Status Icons

Each commodity slot gets a status badge based on a priority-ordered diagnostic:

| Status | Icon | Meaning |
|--------|------|---------|
| **HALTED** | Red | Stock is at 0 -- trade is halted, buy price locked at maximum |
| **ORPHAN** | Red | No planet in the system produces this commodity at all |
| **NO SUPPLY** | Orange | Produced elsewhere but no trade route delivers it here |
| **UNDERSUPPLIED** | Yellow | Supply exists but consumption outpaces it; fill dropping |
| **EXPORT OPP** | Cyan | Surplus with no outbound route -- profit opportunity for players |
| **OVERSUPPLIED** | Blue | Fill above 75%, prices depressed |
| **DISRUPTED** | Pink | An active disruption is altering production/consumption |
| **BALANCED** | Green | Healthy supply/demand equilibrium |

Every status badge has a `?` help tooltip that provides a detailed, context-aware explanation of what is happening and what to do about it.

#### Price History Charts

Click any commodity to open a side panel with a full price history chart. The chart supports:

- **Time windows:** 10m, 30m, 1h, 6h, 24h, and ALL (persisted to `localStorage`)
- **Trade event overlay:** NPC departures and deliveries are shown as markers on the price chart, so you can see exactly how trade route activity affects prices
- **Enriched data:** Each data point includes production, consumption, active disruptions, and related trade events from the `/history/enriched` API endpoint

#### Trade Route Modal

Click a trade route indicator to open a detail modal showing:

- Source and destination planets
- Commodity being traded, volume per trip, trip duration
- Last departure timestamp
- Active/inactive status

#### Disruption Injection

At the bottom of the page is a disruption injection form. This lets you stress-test the economy in real time:

| Disruption Type | Effect |
|----------------|--------|
| **Production Halt** | Stops all production of a commodity at a planet |
| **Production Boost** | Multiplies production rate (default 2.5x) |
| **Demand Surge** | Multiplies consumption rate (default 2.5x) |

Set the planet, commodity, duration (in hours), and fire. The disruption appears immediately in the status icons and on the price chart.

#### Auto-Refresh Countdown

A pulsing green dot and countdown timer in the header show when the next auto-refresh will happen (30-second cycle). You can also click the refresh button to fetch immediately.

---

### Trade Route Viewer (3D)

**File:** `admin/src/pages/TradeRouteViewer.tsx` + `TradeRouteViewer.css`

This is the crown jewel -- an interactive 3D holographic map of the entire economy. Planets are rendered as textured spheres with Fresnel atmospheres, trade routes as bezier curves with animated cargo ships flying along them, and the whole thing sits on a faint grid with a starfield beneath.

The 3D viewer is lazy-loaded (`React.lazy`) since it pulls in Three.js -- the other pages load instantly without it.

#### Engine Architecture

The 3D renderer follows the same pattern as the game engine:

| File | Purpose |
|------|---------|
| `engine/TradeMapRenderer.ts` | Core renderer: scene, camera, OrbitControls, raycasting, animation loop |
| `engine/TradeMapPlanets.ts` | Planet spheres with procedural textures, heatmap rings, disruption pulses |
| `engine/TradeMapRoutes.ts` | Bezier trade route curves, animated cargo ships, category coloring |
| `engine/TradeMapBackground.ts` | Starfield points + grid floor (holographic war-room aesthetic) |
| `engine/PlanetTextureGen.ts` | Procedural equirectangular planet textures using multi-octave value noise |

The renderer receives data via `updateData()` and `updateLive()` methods called from the React side. React handles all UI overlays (panels, tooltips, filters) as absolutely positioned `<div>`s on top of the `<canvas>`.

#### Interactions

- **Click a planet** to select it -- a detail panel appears showing all commodities at that planet
- **Click a trade route** to select it -- shows route details (commodity, volume, margin)
- **Hover over a cargo ship** to see a tooltip with commodity name, volume, source/destination, and ETA
- **Orbit controls** -- left-click drag to rotate, scroll to zoom, right-click drag to pan
- **Space + drag** -- hold Space for panning mode (remaps left-click to pan)

#### Category Filtering

The left panel shows checkboxes for all five commodity categories. Each category has a distinct color:

| Category | Color |
|----------|-------|
| Minerals | Orange |
| Food | Green |
| Tech | Blue |
| Industrial | Silver |
| Luxury | Gold |

Toggle categories to show/hide their trade routes. The **ALL** and **NONE** buttons let you quickly select or deselect everything.

#### Problem Detection

**File:** `admin/src/lib/problemDetection.ts`

The viewer runs a client-side problem detection pass on every data refresh. It identifies:

- **Dead routes** -- routes that are inactive or have no recent departures
- **Supply shortages** -- planets where fill ratio is critically low
- **Oversupply** -- planets where fill ratio is critically high
- **Halted production** -- active production halt disruptions
- **Orphan commodities** -- commodities with no supply chain
- **Tick anomalies** -- from the diagnostics endpoint

Toggle **dead route mode** to dim all healthy routes and highlight only the broken ones.

#### Forecast Simulation

**File:** `admin/src/lib/forecast.ts`

A slider lets you project the economy forward 1-48 hours. The forecast engine runs entirely client-side -- it replicates the server's sigmoid pricing curve and production/consumption logic to simulate future states.

When the forecast detects a crisis (commodity hitting 0% or 100% fill), it appears in a **Predicted Crises** panel with the commodity, planet, and time-until-crisis.

The forecast is pure math -- no Three.js, no React, no network calls. It runs synchronously in the browser.

#### Event Feed

A scrolling event feed in the lower-left shows recent trade events (departures, deliveries) and disruptions. Hover over an event to highlight the corresponding route in the 3D view.

---

### Infrastructure Health

**File:** `admin/src/pages/InfraHealth.tsx`

This page is your window into the EconomyRegion Durable Object itself -- not the market data, but the engine running the simulation. It fetches data from two endpoints: `/infra/health` (lightweight) and `/economy/region/{id}/diagnostics` (deep introspection).

Every section has a `?` help tooltip explaining what the metrics mean and when to worry.

#### Anomaly Banner

If the diagnostics endpoint reports any anomalies, a red banner appears at the top with the full anomaly text. This is the "something is wrong" alarm.

#### System Status

Four cards showing the highest-level health indicators:

| Card | Meaning |
|------|---------|
| **Worker** | Deployed worker version string |
| **Alarm** | Durable Object alarm status: OK, DELAYED, MISSED, or STOPPED |
| **Warmup** | Whether the initial 24h simulation has completed |
| **Overall** | HEALTHY or ISSUES (aggregate) |

#### Alarm & Tick Health

Monitors the 60-second tick cycle:

- **Last Tick** -- time since the most recent tick fired. Yellow above 90s, red above 180s.
- **Tick #** -- total tick count since initialization
- **Interval** -- configured tick interval (60s)
- **Tick Gaps** -- detected gaps where the alarm did not fire on schedule (usually from worker redeployments)

If tick gaps are detected, an expandable section lists each gap with the tick number and gap duration.

#### Tick Performance

Execution time statistics for the last N ticks:

| Metric | Description | Warning Threshold | Critical Threshold |
|--------|-------------|-------------------|--------------------|
| **Avg** | Average tick duration | > 200ms | -- |
| **Min** | Fastest tick | -- | -- |
| **Max** | Slowest tick | > 500ms | > 1000ms |
| **P95** | 95th percentile | > 300ms | > 500ms |

Below the stat cards is a **tick duration bar chart** -- an inline SVG showing each tick's execution time with color coding (green = normal, yellow = slow, red = very slow) and dashed threshold lines at 200ms and 500ms.

#### SQLite Storage

A table of all SQLite tables in the Durable Object, showing row counts against soft limits:

| Table | Soft Limit | Notes |
|-------|-----------|-------|
| `planet_markets` | ~80 rows | Planet-commodity state |
| `price_history` | ~40K rows (7 days) | Auto-pruned to 168h retention |
| `trade_routes` | ~50 rows | NPC route definitions |
| `active_disruptions` | ~10 rows | Currently active disruptions |
| `tick_log` | 1,000 rows | Auto-prunes every tick cycle |
| `meta` | 4 rows | Key-value config |

Each row shows a status badge: **OK** (within limits), **WATCH** (above soft target, often normal for auto-pruned tables), or **HIGH** (significantly over limit -- investigate).

> **Note:** `tick_log` showing WATCH with ~1,020-1,060 rows is completely normal. It prunes to ~1,000 every tick but may briefly exceed the target between runs.

#### Price History Retention

Shows how much price history data is stored and whether pruning is keeping up:

- **Rows** -- total price history rows. Warning above 50K.
- **Data Span** -- how many hours of data are stored
- **Prune At** -- the configured retention threshold (168h = 7 days)
- **Pruning** -- OK if data span is within retention window, STALE if not

#### R2 Snapshot Writes

The Durable Object periodically writes a full economy snapshot to R2 (Cloudflare object storage). This is the data that the public game API serves to players.

- **Last Write** -- time since last R2 write. Warning above 10 minutes.
- **Frequency** -- writes happen every N ticks
- **Recent Writes** -- count of R2 writes in the sample window
- **Write Rate** -- percentage of ticks that triggered a write

#### In-Memory State

A quick sanity check on what the Durable Object has loaded in memory:

- **Planets** -- should match the planet count from Economy Overview
- **Commodity Slots** -- total planet x commodity combinations
- **Trade Routes** -- active NPC routes
- **Active Disruptions** -- currently running disruptions

#### Cost Estimator

A table projecting monthly Cloudflare costs based on **actual live metrics** from the running region:

| Service | Pricing |
|---------|---------|
| Durable Objects | $0.15 per million requests |
| R2 Writes | $0.36 per million operations |
| R2 Storage | $0.015 per GB |

The projections use real tick counts, real R2 write frequencies, and real request volumes. The free tier (100K DO requests, 1M R2 writes) covers most of this usage -- the estimated total is typically well under a dollar per month for a single region.

#### Copy & Refresh

The header has a **Copy** button that exports the full diagnostics snapshot as formatted JSON to your clipboard -- useful for pasting into bug reports or sharing in chat. The **Refresh** button fetches fresh data immediately (auto-refresh runs every 15 seconds).

---

## Source Files

| File | Path | Purpose |
|------|------|---------|
| **App** | `admin/src/App.tsx` | Root component: auth gate, page routing, navigation |
| **API Client** | `admin/src/api.ts` | Singleton HTTP client for all `/api/admin/*` endpoints |
| **Types** | `admin/src/types.ts` | TypeScript interfaces mirroring worker economy types |
| **AuthGate** | `admin/src/components/AuthGate.tsx` | Login screen with API key input |
| **Header** | `admin/src/components/Header.tsx` | Sticky nav bar with page tabs, theme toggle, logout |
| **StatusBadge** | `admin/src/components/StatusBadge.tsx` | Colored dot + label for health status |
| **Sparkline** | `admin/src/components/Sparkline.tsx` | Inline SVG mini-chart with trend coloring |
| **PriceCell** | `admin/src/components/PriceCell.tsx` | Price display with base-price coloring + trend arrow |
| **EconomyOverview** | `admin/src/pages/EconomyOverview.tsx` | Landing page: stats, price table, balance report |
| **RegionDetail** | `admin/src/pages/RegionDetail.tsx` | Per-planet commodity deep-dive with charts |
| **TradeRouteViewer** | `admin/src/pages/TradeRouteViewer.tsx` | 3D holographic economy map (lazy-loaded) |
| **InfraHealth** | `admin/src/pages/InfraHealth.tsx` | DO observability: ticks, SQLite, R2, costs |
| **TradeMapRenderer** | `admin/src/engine/TradeMapRenderer.ts` | Three.js scene: camera, controls, raycasting |
| **TradeMapPlanets** | `admin/src/engine/TradeMapPlanets.ts` | Planet spheres, atmospheres, heatmaps, disruption pulses |
| **TradeMapRoutes** | `admin/src/engine/TradeMapRoutes.ts` | Bezier curves, cargo ships, category colors |
| **TradeMapBackground** | `admin/src/engine/TradeMapBackground.ts` | Starfield + grid floor |
| **PlanetTextureGen** | `admin/src/engine/PlanetTextureGen.ts` | Procedural planet textures (value noise) |
| **Problem Detection** | `admin/src/lib/problemDetection.ts` | Client-side economy problem scanner |
| **Forecast** | `admin/src/lib/forecast.ts` | Client-side forward simulation engine |
| **App CSS** | `admin/src/App.css` | Global variables, reset, dark/light theme |
| **RegionDetail CSS** | `admin/src/pages/RegionDetail.css` | Help tooltips, chart styles |
| **TradeViewer CSS** | `admin/src/pages/TradeRouteViewer.css` | 3D viewer layout, overlay panels |

---

## How to Add a New Page

1. **Create the page component.** Add `admin/src/pages/MyPage.tsx`. Follow the existing pattern: fetch data in `useEffect` with an auto-refresh `setInterval`, store results in state, render panels.

2. **Add the page type.** Open `admin/src/types.ts` and add your page name to the `Page` union:

   ```typescript
   export type Page = "economy" | "region" | "viewer" | "infra" | "mypage";
   ```

3. **Register in the header.** Open `admin/src/components/Header.tsx` and add an entry to the `NAV_ITEMS` array:

   ```typescript
   { page: "mypage", label: "MY PAGE", icon: SomeIcon },
   ```

4. **Wire up in App.tsx.** Add a conditional render in the content area:

   ```tsx
   {page === "mypage" && <MyPage />}
   ```

   If your page is heavy (e.g., pulls in Three.js), use `React.lazy` + `Suspense` like the Trade Route Viewer does:

   ```tsx
   const MyPage = lazy(() => import("./pages/MyPage"));

   // In render:
   {page === "mypage" && (
     <Suspense fallback={<div className="loading">Loading...</div>}>
       <MyPage />
     </Suspense>
   )}
   ```

5. **Add API methods** (if needed). Open `admin/src/api.ts` and add new methods to the `AdminAPI` class. Follow the existing pattern -- each method calls `this.request<T>(path)` and returns a typed promise.

---

## How to Add a New Chart or Widget

1. **If it is a reusable component** (like `Sparkline` or `StatusBadge`), create it in `admin/src/components/`. Keep it stateless -- accept data as props, render SVG or HTML.

2. **If it is page-specific**, define it as a local component inside the page file (like `CommodityBalanceReport` inside `EconomyOverview.tsx` or `TickDurationChart` inside `InfraHealth.tsx`).

3. **For charts**, prefer inline SVG. All existing charts (sparklines, tick duration bars, fill bars) use raw `<svg>` elements with computed coordinates. No charting library is used -- this keeps the bundle small and gives full control over styling.

   Example pattern for a simple bar chart:

   ```tsx
   function MyChart({ data }: { data: number[] }) {
     const width = 600;
     const height = 100;
     const maxVal = Math.max(...data);

     return (
       <svg width={width} height={height}>
         {data.map((val, i) => {
           const barH = (val / maxVal) * height;
           return (
             <rect
               key={i}
               x={(i / data.length) * width}
               y={height - barH}
               width={Math.max(2, width / data.length - 1)}
               height={barH}
               fill="var(--accent-green)"
               opacity={0.8}
             />
           );
         })}
       </svg>
     );
   }
   ```

4. **For stat cards**, use the `StatCard` pattern from `InfraHealth.tsx`:

   ```tsx
   <StatCard label="My Metric" value="42" warn={value > threshold} />
   ```

   The card highlights in yellow when `warn` is true and red when `crit` is true.

5. **For help tooltips**, use the `HelpTip` component (Region Detail) or the `Tip` component (Infra Health). Both render a small `?` icon that opens a portal-based tooltip on hover. Pass plain text as the `text` prop.

---

## API Endpoints

The admin API client (`admin/src/api.ts`) talks to these worker endpoints:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `getRegions()` | `GET /api/admin/economy/regions` | List all regions with summary stats |
| `getRegionDetail(id)` | `GET /api/admin/economy/region/:id` | Full planet/commodity/route/disruption state |
| `getEnrichedHistory(...)` | `GET /api/admin/economy/region/:id/history/enriched` | Price history with trade events and disruptions |
| `getRegionHistory(...)` | `GET /api/admin/economy/region/:id/history` | Basic price history (fallback) |
| `getTradeEvents(...)` | `GET /api/admin/economy/region/:id/trade-events` | NPC trade event log |
| `triggerDisruption(...)` | `POST /api/admin/economy/region/:id/disrupt` | Inject a market disruption |
| `triggerWarmup(id)` | `POST /api/admin/economy/region/:id/warmup` | Run 24h warmup simulation |
| `getInfraHealth()` | `GET /api/admin/infra/health` | Worker version + economy health summary |
| `getDiagnostics(id)` | `GET /api/admin/economy/region/:id/diagnostics` | Deep DO introspection |
| `getCommodities()` | `GET /api/admin/commodities` | Full commodity catalog |
| `seed()` | `POST /api/admin/seed` | Seed commodity data to R2 |
| `testConnection()` | (uses `getRegions`) | Validate API key |

---

## Deployment

```bash
# Build and deploy to Cloudflare Pages:
npm run deploy:admin

# This runs:
#   1. tsc -b            (type check)
#   2. vite build         (production bundle)
#   3. wrangler pages deploy dist --project-name ev2090-admin
```

> **Do not deploy the admin dashboard to a public host.** It has not been hardened for production use — there is no IP restriction, no rate limiting, no session expiry, and the API key is stored in plain text in `localStorage`. The deploy script exists in `package.json` for internal use only. If you need remote admin access, use the MCP server instead — it has proper authentication, scoped API keys, and audit logging.

### Environment Summary

| Setting | Local Dev |
|---------|-----------|
| URL | `http://localhost:5181` |
| API | Vite proxy to `ws.ev2090.com` (or local worker) |
| Auth | `localStorage` or `VITE_FORGE_API_KEY` |
| Theme | Dark/light toggle (persisted) |

---

## Tech Stack

| Dependency | Version | Purpose |
|------------|---------|---------|
| React | 19.x | UI framework |
| Three.js | 0.183.x | 3D renderer (Trade Route Viewer) |
| Vite | 6.x | Dev server + bundler |
| TypeScript | 5.7.x | Type safety |
| lucide-react | 0.474.x | Icon library |
| wrangler | 4.x | Cloudflare Pages deployment |

No routing library, no state management library, no charting library. The dashboard is intentionally lean -- four pages, a singleton API client, and raw SVG for charts.
