[← Back to index](/README.md)

# Economy Engine

> The economy runs on a single Cloudflare Durable Object that ticks every
> 60 seconds. It simulates production, consumption, NPC trade routes, and
> price curves for every commodity on every planet — 24/7, whether players
> are online or not. You configure it entirely through MCP tools. There
> is no hardcoded route table, no static production matrix. The engine
> is a blank canvas; MCP is the brush.

---

## How It Works (30-Second Version)

```
Every 60 seconds:

  1. Factories produce          → planet stock goes up
  2. Populations consume        → planet stock goes down
  3. NPC haulers evaluate       → "should I fly?" (5 rules)
  4. In-transit ships check     → "have I arrived?" (deliver cargo)
  5. Prices recalculate         → sigmoid(fill ratio) → price
  6. History records            → price + fill snapshots for charts
  7. State persists to SQLite   → survives restarts
  8. R2 snapshot publishes      → frontend reads from CDN
```

That's it. Every tick is pure arithmetic — no network calls, no AI, no
randomness beyond NPC jitter. The economy is deterministic given the
same inputs.

---

## 1. The Durable Object

The entire economy lives inside one Cloudflare Durable Object:
**`EconomyRegionDO`**. In Phase 1, there is exactly one instance
(region `core-worlds`) simulating four planets and 20 commodities.

At scale, you'll have hundreds of regions, each managing 40-100 planets.
But the architecture is the same — one DO per region, one alarm tick per
minute, all planets simulated in a single pass.

### Why a Durable Object?

- **In-memory speed** — all market state lives in memory during ticks.
  No database reads per-tick. Pure arithmetic on Maps.
- **Automatic persistence** — SQLite storage survives restarts and
  deploys. The DO loads state from SQL on construction, modifies
  in-memory, writes back each tick.
- **Alarm-driven** — `setAlarm()` fires every 60 seconds. No CRON,
  no external scheduler. The DO is its own clock.
- **Zero-cost when idle** — if no alarm is set, the DO hibernates
  and costs nothing.

### In-Memory vs. SQLite

This is the most important thing to understand about the engine.

```
                    ┌─────────────────────────────┐
                    │     In-Memory (fast)         │
                    │                              │
                    │  planets: Map<PlanetMarket>  │
                    │  tradeRoutes: NpcTradeRoute[]│
                    │  disruptions: MarketDisruption│
                    │  tickNumber, lastTickAt, etc.│
                    │                              │
                    └──────────┬───────────────────┘
                               │
                    alarm() ───┤──── tick logic runs here
                               │
                    ┌──────────▼───────────────────┐
                    │     SQLite (durable)          │
                    │                              │
                    │  planet_markets              │
                    │  trade_routes                │
                    │  active_disruptions          │
                    │  price_history               │
                    │  trade_events                │
                    │  tick_log                    │
                    │  meta                        │
                    └─────────────────────────────┘
```

**On construction:** The DO reads everything from SQLite into memory.

**Each tick:** The alarm handler modifies in-memory state (production,
consumption, NPC decisions, deliveries), then writes changes back to
SQLite at the end of the tick.

**MCP mutations** (like `set_production_rate`) update BOTH the
in-memory state AND the SQLite row. If you only update SQL, the
in-memory state will overwrite it on the next tick. If you only
update memory, it will be lost on restart. Always update both.

---

## 2. The Tick

Every 60 seconds, the `alarm()` handler fires. Here is exactly what
happens, in order:

### Step 1: Production & Consumption

For every commodity on every planet, apply base rates:

```
stock.quantity += baseProduction × dt
stock.quantity -= baseConsumption × dt
```

Where `dt = 1` (rates are per-tick, not per-second). If a disruption
is active, production and consumption rates are multiplied by the
disruption modifier before applying.

Production is capped at capacity. Consumption floors at zero.

### Step 2: External Exports

If a commodity's fill ratio exceeds 80%, a small drain pulls it
back toward 55%. This prevents permanent oversupply from NPC
deliveries overshooting. Think of it as "other NPC haulers from
outside the region buying the surplus."

```
if (fillRatio > 0.80) {
  drain toward 55% at 0.05 units/tick
}
```

### Step 3: NPC Trade Simulation

This is the heart of the engine. Each trade route is evaluated
independently. The full NPC decision model -- the 5-rule brain,
cargo sizing, trip jitter, and sawtooth patterns -- is documented
in **[NPC Economy](./npc-economy.md)**. In brief:

- **In-transit routes:** Check if the trip is complete. If yes,
  deliver the locked cargo to the destination.
- **Docked routes:** Run the 5-rule NPC brain to decide whether
  to depart, and if so, how much cargo to load.

### Step 4: Price Calculation

After all stock changes, recalculate the price for every commodity
at every planet using the sigmoid curve:

```
sigmoid = 1 / (1 + exp(k × (fill - 0.5)))
price = minPrice + (maxPrice - minPrice) × sigmoid
```

Where `k = 8 × volatility`. The curve is steep near the middle
and flattens at the extremes:

```
Price
  │
max├──╲
  │    ╲
  │     ╲
base├──────╳──────     ← fill = 0.5 (equilibrium)
  │         ╲
  │          ╲
min├───────────╲──
  │
  └──┬──┬──┬──┬──→ Fill Ratio
     0  .25 .5 .75 1.0
```

### Step 5: Record History

Every 5th tick (5 minutes), a price + fill snapshot is saved to
the `price_history` table for charts and sparklines. History older
than 7 days is pruned.

### Step 6: Persist & Publish

All market state is written back to SQLite. Every 5th tick, the DO
also publishes a JSON snapshot to R2 (`market/regions/{regionId}.json`)
so the frontend can read current prices from CDN without hitting the
Worker.

### Step 7: Reschedule

```typescript
this.ctx.storage.setAlarm(now + 60_000);
```

The cycle repeats forever.

---

## 3. SQLite Schema

Seven tables, all inside the DO's embedded SQLite:

| Table | Purpose | Rows (4 planets × 20 commodities) |
|-------|---------|-----------------------------------|
| `planet_markets` | Current stock, capacity, production/consumption rates | 80 |
| `trade_routes` | NPC route definitions + in-transit state | Variable (MCP-managed) |
| `price_history` | Time-series snapshots for charts | ~2,000/day |
| `trade_events` | NPC departure/delivery log | Variable |
| `active_disruptions` | Currently active market disruptions | 0-5 |
| `tick_log` | Tick execution timing for diagnostics | ~1,440/day |
| `meta` | Key-value store (tick number, warmup state) | ~5 |

### Key: `planet_markets`

```sql
CREATE TABLE planet_markets (
  planet_id       TEXT NOT NULL,
  commodity_id    TEXT NOT NULL,
  quantity        REAL NOT NULL,
  capacity        REAL NOT NULL,
  fill_ratio      REAL NOT NULL,
  base_production REAL DEFAULT 0,
  base_consumption REAL DEFAULT 0,
  last_trade_price REAL DEFAULT 0,
  last_trade_time  INTEGER DEFAULT 0,
  PRIMARY KEY (planet_id, commodity_id)
);
```

This is the source of truth for market state. MCP tools read and
write this table (through the DO's API handlers).

### Key: `trade_routes`

```sql
CREATE TABLE trade_routes (
  id               TEXT PRIMARY KEY,
  commodity_id     TEXT NOT NULL,
  source_planet    TEXT NOT NULL,
  dest_planet      TEXT NOT NULL,
  volume_per_trip  REAL NOT NULL,
  trip_duration_ms INTEGER NOT NULL,
  last_departure   INTEGER DEFAULT 0,
  active           INTEGER DEFAULT 0,
  cargo_in_transit REAL DEFAULT 0,
  effective_trip_ms INTEGER DEFAULT 0
);
```

Routes are created and managed entirely through MCP. The engine never
generates routes on its own. When the DO restarts, it loads these
routes from SQL and resumes their in-transit state.

---

## 4. MCP — The Control Plane

The economy is configured and observed entirely through MCP tools. See [MCP Server Guide](./mcp-guide.md) for the full tool reference and common workflows.

---

## 5. Warmup

When the economy starts fresh (or after a full reset), you need to
"warm up" the simulation. The warmup runs 1,440 ticks (24 simulated
hours) in a tight loop — no real-time delay, no R2 writes, no
notifications. Just pure tick math.

```
POST /api/market/warmup?force=true
```

The `?force=true` parameter re-runs warmup even if it already ran.
This is useful after configuration changes or bug fixes.

### What warmup does:

1. **Clears all history** — price_history, trade_events, tick_log,
   trade_routes, active_disruptions. Clean slate.
2. **Bootstraps markets** — creates all 80 market slots (4 planets ×
   20 commodities) at 50% fill, zero production, zero consumption.
3. **Runs 1,440 ticks** — simulates 24 hours of economy at 1-tick
   intervals. If you have routes and rates configured via MCP before
   warmup, they'll be included.
4. **Saves state** — writes final state to SQLite.
5. **Starts the alarm** — the real-time tick begins.

### Important: Warmup creates a blank canvas

After warmup, every commodity on every planet sits at 50% fill with
no production, no consumption, and no routes. You configure everything
via MCP after the warmup completes.

---

## 6. Planets & Commodities

### Planets (Phase 1)

| Planet | Economy Type | Trade Modifier | Identity |
|--------|-------------|----------------|----------|
| Nexara | Trade Hub | 0.95 | Commerce center — consumes everything, produces nothing |
| Velkar | Mining | 1.0 | Raw materials — iron, titanium, crystals |
| Zephyra | Research | 1.0 | High-tech — quantum cores, AI modules, sensors |
| Arctis | Industrial | 1.0 | Manufacturing — steel, polymers, fuel cells |

These planet definitions live in `worker/src/data/planet-economies.ts`.
They define the *identity* of each planet (what it's known for), but
they do NOT control production rates or routes. Those are set via MCP.

### Commodities (20 at launch)

| Category | Commodities | Base Price Range |
|----------|------------|-----------------|
| Minerals | Iron, Titanium, Helium-3, Rare Earths, Crystals | 25-180 cr |
| Food | Grain, Protein Packs, Luxury Food, Spice | 25-150 cr |
| Tech | Microchips, Quantum Cores, AI Modules, Sensors | 85-350 cr |
| Industrial | Steel, Polymers, Coolant, Fuel Cells | 55-120 cr |
| Luxury | Wine, Jewelry, Art | 95-200 cr |

Commodity definitions live in `worker/src/data/commodities.ts`. Each
defines `basePrice`, `minPrice`, `maxPrice`, and `volatility` — these
feed the sigmoid price curve.

**Storage capacity** scales with base price:
`capacity = max(100, sqrt(basePrice) × 25)`. Cheap bulk goods (Grain,
basePrice=25) get ~125 capacity. Expensive tech (Quantum Cores,
basePrice=350) gets ~467 capacity.

---

## 7. Price Curve

Prices are driven entirely by the **fill ratio** — how full a planet's
storage is for a given commodity. The relationship follows an inverted
sigmoid:

| Fill Ratio | Meaning | Price |
|-----------|---------|-------|
| 0% (empty) | Extreme shortage | Near `maxPrice` |
| 25% | Significant shortage | Well above `basePrice` |
| 50% | Equilibrium | At `basePrice` |
| 75% | Surplus | Below `basePrice` |
| 100% (full) | Extreme oversupply | Near `minPrice` |

The `volatility` parameter controls how steep the curve is. High
volatility means prices swing dramatically with small stock changes.
Low volatility means prices are stable even under stress.

There is no mean reversion, no random noise, no external price
manipulation. Price is a pure function of fill ratio. Change the
stock, and the price changes instantly.

---

## 8. Source Files

| File | Role |
|------|------|
| `worker/src/economy-region.ts` | The Durable Object — tick engine, state management, API handlers |
| `worker/src/economy/trade-routes.ts` | NPC brain — decision engine, cargo calculation, trip jitter |
| `worker/src/economy/pricing.ts` | Sigmoid price curve, external exports |
| `worker/src/economy/disruptions.ts` | Disruption modifiers (production halt/boost, demand surge) |
| `worker/src/data/commodities.ts` | 20 commodity definitions (price, volatility, category) |
| `worker/src/data/planet-economies.ts` | 4 planet definitions (type, trade modifier) |
| `worker/src/types/economy.ts` | TypeScript types for all economy structures |

---

## 9. Deployment

Deployment of the Worker and Durable Object is covered in
**[Cloudflare Setup](./cloudflare-setup.md)**.

---

## Related Docs

- **[NPC Economy](./npc-economy.md)** -- NPC trade brain, cargo sizing, sawtooth patterns
- **[MCP Server Guide](./mcp-guide.md)** -- Full MCP tool reference and common workflows
- **[Backend Guide](./backend-guide.md)** -- Worker architecture, Durable Objects, API routing
- **[Cloudflare Setup](./cloudflare-setup.md)** -- Deployment, Wrangler config, environment setup
