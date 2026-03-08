/**
 * EconomyRegion Durable Object — the NPC-driven economy engine.
 *
 * One instance per region (Phase 1: "core-worlds" only).
 * Alarm ticks every 60s to simulate NPC production, consumption,
 * trade routes, and disruptions. Pure supply/demand — no mean reversion.
 * Self-publishes price snapshots to R2.
 */

import { DurableObject } from "cloudflare:workers";
import type {
  AdminCommodityState,
  AdminDisruptionView,
  AdminPlanetMarketState,
  AdminRegionDetail,
  AdminRegionSummary,
  AdminTickStats,
  CommodityStock,
  EnrichedPriceHistoryPoint,
  MarketDisruption,
  NpcTradeEvent,
  NpcTradeRoute,
  PlanetMarket,
  PriceHistoryPoint,
} from "./types/economy";
import { COMMODITIES, COMMODITY_MAP } from "./data/commodities";
import { PLANET_ECONOMIES } from "./data/planet-economies";
import { calculatePrice, applyExternalExports } from "./economy/pricing";
import { generateInitialRoutes, simulateNpcTrades } from "./economy/trade-routes";
import { generateRandomDisruption, applyDisruptedEconomy } from "./economy/disruptions";

interface Env {
  STATIC_DATA: R2Bucket;
  ADMIN_API_KEY?: string;
}

const TICK_INTERVAL_MS = 60_000;       // 1 minute
const R2_SNAPSHOT_EVERY = 1;           // every tick = 60s (CDN serves players)
const PRICE_HISTORY_EVERY = 5;         // every 5th tick = 5 min (frequent for Layer 0 proof)
const DISRUPTION_CHANCE = 0.001;       // ~0.1% per tick = ~once per 16 hours

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export class EconomyRegionDO extends DurableObject<Env> {
  private planets: Map<string, PlanetMarket> = new Map();
  private tradeRoutes: NpcTradeRoute[] = [];
  private disruptions: MarketDisruption[] = [];
  private tickNumber = 0;
  private lastTickAt = 0;
  private lastR2WriteAt = 0;
  private warmupComplete = false;
  private warmupCompletedAt = 0;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
      await this.loadState();
      // Self-heal: if the economy is running but the alarm chain was broken
      // (e.g., Wrangler hot-reload in dev loses the alarm timer even though the
      // alarm record remains in storage), reschedule so ticks resume automatically.
      //
      // We reschedule if:
      //   a) No alarm is scheduled at all, OR
      //   b) The last tick is more than 2× the interval ago (timer was lost after hot-reload)
      if (this.initialized && this.warmupComplete) {
        const scheduled = await this.ctx.storage.getAlarm();
        if (!scheduled) {
          // No alarm at all — schedule the next tick. This handles the case
          // where Wrangler hot-reload cleared alarms without persisting them.
          console.log("[EconomyRegion] Alarm self-heal: rescheduling tick loop");
          await this.ctx.storage.setAlarm(Date.now() + TICK_INTERVAL_MS);
        }
      }
    });
  }

  // ── Schema ──

  private initSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS planet_markets (
        planet_id TEXT NOT NULL,
        commodity_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        capacity REAL NOT NULL,
        fill_ratio REAL NOT NULL,
        base_production REAL DEFAULT 0,
        base_consumption REAL DEFAULT 0,
        last_trade_price REAL DEFAULT 0,
        last_trade_time INTEGER DEFAULT 0,
        PRIMARY KEY (planet_id, commodity_id)
      );

      CREATE TABLE IF NOT EXISTS price_history (
        planet_id TEXT NOT NULL,
        commodity_id TEXT NOT NULL,
        price REAL NOT NULL,
        fill_ratio REAL NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trade_routes (
        id TEXT PRIMARY KEY,
        commodity_id TEXT NOT NULL,
        source_planet TEXT NOT NULL,
        dest_planet TEXT NOT NULL,
        volume_per_trip REAL NOT NULL,
        trip_duration_ms INTEGER NOT NULL,
        last_departure INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        in_transit INTEGER DEFAULT 0,
        cargo_in_transit REAL DEFAULT 0,
        effective_trip_ms INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS active_disruptions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        planet_id TEXT NOT NULL,
        commodity_id TEXT,
        multiplier REAL,
        started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tick_log (
        tick_number INTEGER PRIMARY KEY,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        disruptions_active INTEGER NOT NULL,
        r2_write INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS trade_events (
        id TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        type TEXT NOT NULL,
        commodity_id TEXT NOT NULL,
        source_planet TEXT NOT NULL,
        dest_planet TEXT NOT NULL,
        quantity REAL NOT NULL,
        source_price REAL NOT NULL,
        dest_price REAL NOT NULL,
        margin REAL NOT NULL,
        source_fill_before REAL NOT NULL,
        dest_fill_before REAL NOT NULL,
        source_fill_after REAL NOT NULL,
        dest_fill_after REAL NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Create indices if not exists
    try {
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_ph_lookup
          ON price_history(planet_id, commodity_id, timestamp DESC);
      `);
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_te_lookup
          ON trade_events(commodity_id, timestamp DESC);
      `);
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_te_planet
          ON trade_events(dest_planet, commodity_id, timestamp DESC);
      `);
    } catch {
      // Indices may already exist
    }

    // Migration: add NPC intelligence columns to existing trade_routes tables
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE trade_routes ADD COLUMN cargo_in_transit REAL DEFAULT 0",
      );
    } catch {
      // Column already exists
    }
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE trade_routes ADD COLUMN effective_trip_ms INTEGER DEFAULT 0",
      );
    } catch {
      // Column already exists
    }

    // Migration: rename active → in_transit + add enabled column
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE trade_routes ADD COLUMN enabled INTEGER DEFAULT 1",
      );
    } catch {
      // Column already exists
    }
    try {
      this.ctx.storage.sql.exec(
        "ALTER TABLE trade_routes ADD COLUMN in_transit INTEGER DEFAULT 0",
      );
      // Backfill: copy existing active values into in_transit
      this.ctx.storage.sql.exec(
        "UPDATE trade_routes SET in_transit = active WHERE active IS NOT NULL",
      );
    } catch {
      // Column already exists
    }
  }

  // ── State Loading ──

  private async loadState(): Promise<void> {
    // Load meta
    const metaRows = this.ctx.storage.sql.exec(
      "SELECT key, value FROM meta",
    ).toArray();
    const meta = new Map(metaRows.map((r) => [r.key as string, r.value as string]));
    this.tickNumber = parseInt(meta.get("tickNumber") || "0", 10);
    this.lastTickAt = parseInt(meta.get("lastTickAt") || "0", 10);
    this.lastR2WriteAt = parseInt(meta.get("lastR2WriteAt") || "0", 10);
    this.warmupComplete = meta.get("warmupComplete") === "true";
    this.warmupCompletedAt = parseInt(meta.get("warmupCompletedAt") || "0", 10);

    // Backfill: if warmup ran before this field existed, infer from tick_log
    if (this.warmupComplete && this.warmupCompletedAt === 0) {
      try {
        const earliest = this.ctx.storage.sql
          .exec("SELECT MIN(timestamp) as ts FROM tick_log")
          .toArray();
        if (earliest[0]?.ts) {
          this.warmupCompletedAt = earliest[0].ts as number;
          this.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO meta (key, value) VALUES ('warmupCompletedAt', ?)`,
            String(this.warmupCompletedAt),
          );
        }
      } catch {
        // tick_log may not exist yet
      }
    }

    // Load planet markets
    const marketRows = this.ctx.storage.sql.exec(
      "SELECT * FROM planet_markets",
    ).toArray();

    if (marketRows.length > 0) {
      this.planets = new Map();
      for (const row of marketRows) {
        const planetId = row.planet_id as string;
        if (!this.planets.has(planetId)) {
          const config = PLANET_ECONOMIES.find((p) => p.planetId === planetId);
          this.planets.set(planetId, {
            planetId,
            economyType: config?.economyType || "trade-hub",
            tradeModifier: config?.tradeModifier || 1.0,
            inventory: new Map(),
          });
        }
        const market = this.planets.get(planetId)!;
        market.inventory.set(row.commodity_id as string, {
          commodityId: row.commodity_id as string,
          quantity: row.quantity as number,
          capacity: row.capacity as number,
          fillRatio: row.fill_ratio as number,
          baseProduction: row.base_production as number,
          baseConsumption: row.base_consumption as number,
          lastTradePrice: row.last_trade_price as number,
          lastTradeTime: row.last_trade_time as number,
        });
      }
      this.initialized = true;
    }

    // Load trade routes
    const routeRows = this.ctx.storage.sql.exec(
      "SELECT * FROM trade_routes",
    ).toArray();
    this.tradeRoutes = routeRows.map((r) => ({
      id: r.id as string,
      commodityId: r.commodity_id as string,
      sourcePlanet: r.source_planet as string,
      destPlanet: r.dest_planet as string,
      volumePerTrip: r.volume_per_trip as number,
      tripDurationMs: r.trip_duration_ms as number,
      lastDeparture: r.last_departure as number,
      enabled: (r.enabled as number) !== 0,
      inTransit: (r.in_transit as number) === 1,
      cargoInTransit: (r.cargo_in_transit as number) || 0,
      effectiveTripMs: (r.effective_trip_ms as number) || 0,
    }));

    // Load active disruptions
    const disruptRows = this.ctx.storage.sql.exec(
      "SELECT * FROM active_disruptions",
    ).toArray();
    this.disruptions = disruptRows.map((r) => {
      const base = {
        id: r.id as string,
        planetId: r.planet_id as string,
        startedAt: r.started_at as number,
        expiresAt: r.expires_at as number,
      };
      const type = r.type as string;
      if (type === "production_halt") {
        return { ...base, type: "production_halt" as const, commodityId: r.commodity_id as string };
      }
      if (type === "production_boost") {
        return { ...base, type: "production_boost" as const, commodityId: r.commodity_id as string, multiplier: r.multiplier as number };
      }
      if (type === "demand_surge") {
        return { ...base, type: "demand_surge" as const, commodityId: r.commodity_id as string, multiplier: r.multiplier as number };
      }
      return { ...base, type: "discovery" as const, commodityId: r.commodity_id as string, capacityIncrease: r.multiplier as number };
    });
  }

  // ── Bootstrap ──

  private bootstrapMarkets(): void {
    this.planets = new Map();

    for (const config of PLANET_ECONOMIES) {
      const producesSet = new Set(config.produces);
      const consumesSet = new Set(config.consumes);
      const inventory = new Map<string, CommodityStock>();

      for (const commodity of COMMODITIES) {
        // Capacity scales with sqrt(basePrice) × 25 → range 125-470
        const capacity = Math.max(100, Math.round(Math.sqrt(commodity.basePrice) * 25));
        const quantity = Math.round(capacity * 0.50);

        // Apply production/consumption from planet economy config.
        // Producing planets: 0.5 units/tick. Consuming planets: 0.3 units/tick.
        // External export safety valve (pricing.ts) prevents overflow above 80%.
        const baseProduction = producesSet.has(commodity.id) ? 0.5 : 0;
        const baseConsumption = consumesSet.has(commodity.id) ? 0.3 : 0;

        inventory.set(commodity.id, {
          commodityId: commodity.id,
          quantity,
          capacity,
          fillRatio: 0.50,
          baseProduction,
          baseConsumption,
          lastTradePrice: commodity.basePrice,
          lastTradeTime: Date.now(),
        });
      }

      this.planets.set(config.planetId, {
        planetId: config.planetId,
        economyType: config.economyType,
        tradeModifier: config.tradeModifier,
        inventory,
      });
    }

    // Generate NPC trade routes from production/consumption data.
    // A route is created for every source→dest pair where source produces
    // what dest consumes. MCP tools can add/remove routes after bootstrap.
    this.tradeRoutes = generateInitialRoutes(
      Array.from(this.planets.values()),
      COMMODITY_MAP,
    );
    this.initialized = true;
  }

  // ── Alarm: Economy Tick ──

  async alarm(): Promise<void> {
    if (!this.initialized) return;

    const tickStart = Date.now();
    const dt = 1; // rates are per-tick (was TICK_INTERVAL_MS/1000 = 60, causing 60× amplification)

    // 1. Apply NPC production/consumption with disruption modifiers
    for (const [, market] of this.planets) {
      for (const [, stock] of market.inventory) {
        applyDisruptedEconomy(
          stock,
          this.disruptions,
          market.planetId,
          dt,
        );
      }
    }

    // 1b. Apply external solar system exports (drain overflow above 80%)
    for (const [, market] of this.planets) {
      applyExternalExports(market, dt);
    }

    // 2. Simulate NPC trade routes
    const tradeEvents = simulateNpcTrades(
      this.tradeRoutes,
      this.planets,
      COMMODITY_MAP,
      tickStart,
    );
    if (tradeEvents.length > 0) {
      this.saveTradeEvents(tradeEvents);
    }

    // 3. Record price history (every 30 ticks = 30 min)
    if (this.tickNumber % PRICE_HISTORY_EVERY === 0) {
      this.recordPriceHistory(tickStart);
    }

    // 4. Random disruptions — DISABLED for Layer 0 proof.
    // Re-enable once baseline NPC sawtooth is validated.
    // if (Math.random() < DISRUPTION_CHANCE) { ... }

    // 5. Clean expired disruptions
    this.cleanExpiredDisruptions(tickStart);

    // 6. Save state
    this.saveMarketState();
    this.saveTradeRoutes();

    this.tickNumber++;
    this.lastTickAt = tickStart;

    // 7. Publish R2 snapshot (every 5 ticks = 5 min)
    if (this.tickNumber % R2_SNAPSHOT_EVERY === 0) {
      await this.publishR2Snapshot();
    }

    // 8. Log tick
    const tickDuration = Date.now() - tickStart;
    this.logTick(tickStart, tickDuration);

    // 9. Save meta
    this.saveMeta();

    // 10. Reschedule alarm
    await this.ctx.storage.setAlarm(Date.now() + TICK_INTERVAL_MS);
  }

  // ── Warmup ──

  private async runWarmup(): Promise<{ ticksRun: number; durationMs: number }> {
    // Clear ALL history tables before re-seeding.
    // Multiple warmups wrote overlapping fakeNow timestamps, creating
    // ghost price oscillations in charts. Start fresh every time.
    this.ctx.storage.sql.exec("DELETE FROM price_history");
    this.ctx.storage.sql.exec("DELETE FROM trade_events");
    this.ctx.storage.sql.exec("DELETE FROM tick_log");
    this.ctx.storage.sql.exec("DELETE FROM trade_routes");
    this.ctx.storage.sql.exec("DELETE FROM active_disruptions");

    this.bootstrapMarkets();
    const start = Date.now();
    const ticksToRun = 1440; // 24 hours at 1-min ticks
    const dt = 1; // rates are per-tick (was 60, causing 60× amplification)

    for (let i = 0; i < ticksToRun; i++) {
      const fakeNow = start - (ticksToRun - i) * TICK_INTERVAL_MS;

      // NPC economy with disruption modifiers
      for (const [, market] of this.planets) {
        for (const [, stock] of market.inventory) {
          applyDisruptedEconomy(
            stock,
            this.disruptions,
            market.planetId,
            dt,
          );
        }
      }

      // NPC trade routes
      simulateNpcTrades(
        this.tradeRoutes,
        this.planets,
        COMMODITY_MAP,
        fakeNow,
      );

      // Record price history every 30 ticks
      if (i % PRICE_HISTORY_EVERY === 0) {
        this.recordPriceHistory(fakeNow);
      }

      // Occasional random disruption
      if (Math.random() < 0.005) {
        const d = generateRandomDisruption(
          Array.from(this.planets.values()),
          fakeNow,
        );
        if (d) this.disruptions.push(d);
      }

      // Clean expired disruptions
      this.disruptions = this.disruptions.filter(
        (d) => d.expiresAt > fakeNow,
      );
    }

    // Save all state
    this.saveMarketState();
    this.saveTradeRoutes();
    this.saveAllDisruptions();
    this.tickNumber = ticksToRun;
    this.lastTickAt = Date.now();
    this.warmupComplete = true;
    this.warmupCompletedAt = Date.now();
    this.saveMeta();

    // Publish initial R2 snapshot
    await this.publishR2Snapshot();

    // Start the live alarm loop
    await this.ctx.storage.setAlarm(Date.now() + TICK_INTERVAL_MS);

    const durationMs = Date.now() - start;
    return { ticksRun: ticksToRun, durationMs };
  }

  // ── Persistence ──

  private saveMarketState(): void {
    for (const [, market] of this.planets) {
      for (const [, stock] of market.inventory) {
        // NaN guard: clamp corrupted values before persisting
        const qty = Number.isNaN(stock.quantity) ? 0 : stock.quantity;
        const fill = Number.isNaN(stock.fillRatio) ? 0 : stock.fillRatio;
        const prod = Number.isNaN(stock.baseProduction) ? 0 : stock.baseProduction;
        const cons = Number.isNaN(stock.baseConsumption) ? 0 : stock.baseConsumption;
        const price = Number.isNaN(stock.lastTradePrice) ? 0 : stock.lastTradePrice;

        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO planet_markets
           (planet_id, commodity_id, quantity, capacity, fill_ratio,
            base_production, base_consumption, last_trade_price, last_trade_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          market.planetId,
          stock.commodityId,
          qty,
          stock.capacity,
          fill,
          prod,
          cons,
          price,
          stock.lastTradeTime,
        );
      }
    }
  }

  /**
   * Save a single planet-commodity entry to SQLite.
   * Use this for targeted admin mutations (set-rates, set-stock, set-capacity)
   * instead of saveMarketState() which writes ALL 80 entries.
   */
  private saveOneStock(planetId: string, stock: CommodityStock): void {
    // NaN guard: clamp corrupted values before persisting
    const qty = Number.isNaN(stock.quantity) ? 0 : stock.quantity;
    const fill = Number.isNaN(stock.fillRatio) ? 0 : stock.fillRatio;

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO planet_markets
       (planet_id, commodity_id, quantity, capacity, fill_ratio,
        base_production, base_consumption, last_trade_price, last_trade_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      planetId,
      stock.commodityId,
      qty,
      stock.capacity,
      fill,
      stock.baseProduction,
      stock.baseConsumption,
      stock.lastTradePrice,
      stock.lastTradeTime,
    );
  }

  private recordPriceHistory(timestamp: number): void {
    for (const [, market] of this.planets) {
      for (const [, stock] of market.inventory) {
        const commodity = COMMODITY_MAP.get(stock.commodityId);
        if (!commodity) continue;
        const price = calculatePrice(commodity, stock);
        this.ctx.storage.sql.exec(
          `INSERT INTO price_history (planet_id, commodity_id, price, fill_ratio, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
          market.planetId,
          stock.commodityId,
          price,
          stock.fillRatio,
          timestamp,
        );
      }
    }

    // Prune old history (keep last 24 hours)
    const cutoff = timestamp - 24 * 60 * 60 * 1000;
    this.ctx.storage.sql.exec(
      "DELETE FROM price_history WHERE timestamp < ?",
      cutoff,
    );
  }

  private saveTradeRoutes(): void {
    for (const route of this.tradeRoutes) {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO trade_routes
         (id, commodity_id, source_planet, dest_planet,
          volume_per_trip, trip_duration_ms, last_departure, enabled, in_transit,
          cargo_in_transit, effective_trip_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        route.id,
        route.commodityId,
        route.sourcePlanet,
        route.destPlanet,
        route.volumePerTrip,
        route.tripDurationMs,
        route.lastDeparture,
        route.enabled ? 1 : 0,
        route.inTransit ? 1 : 0,
        route.cargoInTransit,
        route.effectiveTripMs,
      );
    }
  }

  private saveDisruption(d: MarketDisruption): void {
    const commodityId = "commodityId" in d ? d.commodityId : null;
    const multiplier =
      d.type === "production_boost" || d.type === "demand_surge"
        ? d.multiplier
        : d.type === "discovery"
          ? d.capacityIncrease
          : null;

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO active_disruptions
       (id, type, planet_id, commodity_id, multiplier, started_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      d.id,
      d.type,
      d.planetId,
      commodityId,
      multiplier,
      d.startedAt,
      d.expiresAt,
    );
  }

  private saveAllDisruptions(): void {
    this.ctx.storage.sql.exec("DELETE FROM active_disruptions");
    for (const d of this.disruptions) {
      this.saveDisruption(d);
    }
  }

  private cleanExpiredDisruptions(now: number): void {
    const before = this.disruptions.length;
    this.disruptions = this.disruptions.filter((d) => d.expiresAt > now);
    if (this.disruptions.length !== before) {
      this.ctx.storage.sql.exec(
        "DELETE FROM active_disruptions WHERE expires_at <= ?",
        now,
      );
    }
  }

  private logTick(startedAt: number, durationMs: number): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO tick_log
       (tick_number, started_at, duration_ms, disruptions_active, r2_write)
       VALUES (?, ?, ?, ?, ?)`,
      this.tickNumber,
      startedAt,
      durationMs,
      this.disruptions.length,
      this.tickNumber % R2_SNAPSHOT_EVERY === 0 ? 1 : 0,
    );

    // Keep last 1000 tick logs
    if (this.tickNumber % 100 === 0) {
      const cutoff = this.tickNumber - 1000;
      this.ctx.storage.sql.exec(
        "DELETE FROM tick_log WHERE tick_number < ?",
        cutoff,
      );
    }
  }

  private saveTradeEvents(events: NpcTradeEvent[]): void {
    for (const e of events) {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO trade_events
         (id, route_id, type, commodity_id, source_planet, dest_planet,
          quantity, source_price, dest_price, margin,
          source_fill_before, dest_fill_before, source_fill_after, dest_fill_after,
          timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id, e.routeId, e.type, e.commodityId,
        e.sourcePlanet, e.destPlanet,
        e.quantity, e.sourcePrice, e.destPrice, e.margin,
        e.sourceFillBefore, e.destFillBefore,
        e.sourceFillAfter, e.destFillAfter,
        e.timestamp,
      );
    }

    // Prune old trade events (keep last 24 hours)
    if (this.tickNumber % 100 === 0) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      this.ctx.storage.sql.exec(
        "DELETE FROM trade_events WHERE timestamp < ?",
        cutoff,
      );
    }
  }

  private getTradeEvents(
    planetId: string,
    commodityId: string,
    hours: number,
  ): NpcTradeEvent[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT * FROM trade_events
         WHERE commodity_id = ?
           AND (source_planet = ? OR dest_planet = ?)
           AND timestamp > ?
         ORDER BY timestamp DESC
         LIMIT 50`,
        commodityId, planetId, planetId, cutoff,
      )
      .toArray();

    return rows.map((r) => ({
      id: r.id as string,
      routeId: r.route_id as string,
      type: r.type as "departure" | "delivery",
      commodityId: r.commodity_id as string,
      sourcePlanet: r.source_planet as string,
      destPlanet: r.dest_planet as string,
      quantity: r.quantity as number,
      sourcePrice: r.source_price as number,
      destPrice: r.dest_price as number,
      margin: r.margin as number,
      sourceFillBefore: r.source_fill_before as number,
      destFillBefore: r.dest_fill_before as number,
      sourceFillAfter: r.source_fill_after as number,
      destFillAfter: r.dest_fill_after as number,
      timestamp: r.timestamp as number,
    }));
  }

  private getTradeEventsFiltered(
    planetId: string | null,
    commodityId: string | null,
    hours: number,
  ): NpcTradeEvent[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    // Build dynamic WHERE clause
    const conditions: string[] = ["timestamp > ?"];
    const params: unknown[] = [cutoff];

    if (commodityId) {
      conditions.push("commodity_id = ?");
      params.push(commodityId);
    }
    if (planetId) {
      conditions.push("(source_planet = ? OR dest_planet = ?)");
      params.push(planetId, planetId);
    }

    const rows = this.ctx.storage.sql
      .exec(
        `SELECT * FROM trade_events
         WHERE ${conditions.join(" AND ")}
         ORDER BY timestamp DESC
         LIMIT 200`,
        ...params,
      )
      .toArray();

    return rows.map((r) => ({
      id: r.id as string,
      routeId: r.route_id as string,
      type: r.type as "departure" | "delivery",
      commodityId: r.commodity_id as string,
      sourcePlanet: r.source_planet as string,
      destPlanet: r.dest_planet as string,
      quantity: r.quantity as number,
      sourcePrice: r.source_price as number,
      destPrice: r.dest_price as number,
      margin: r.margin as number,
      sourceFillBefore: r.source_fill_before as number,
      destFillBefore: r.dest_fill_before as number,
      sourceFillAfter: r.source_fill_after as number,
      destFillAfter: r.dest_fill_after as number,
      timestamp: r.timestamp as number,
    }));
  }

  private getEnrichedHistory(
    planetId: string,
    commodityId: string,
    hours: number,
  ): EnrichedPriceHistoryPoint[] {
    const points = this.getPriceHistory(planetId, commodityId, hours);
    const market = this.planets.get(planetId);
    const stock = market?.inventory.get(commodityId);

    return points.map((point, i) => {
      // Find trade events near this price snapshot (within 30 min window)
      const windowStart = i > 0 ? points[i - 1]!.timestamp : point.timestamp - 30 * 60 * 1000;
      const windowEnd = point.timestamp;

      const tradeEvents = this.getTradeEventsInWindow(
        planetId, commodityId, windowStart, windowEnd,
      );

      // Find disruptions active at this timestamp
      const activeDisruptions = this.getDisruptionsAtTime(
        planetId, commodityId, point.timestamp,
      );

      return {
        ...point,
        tradeEvents,
        activeDisruptions,
        production: stock?.baseProduction || 0,
        consumption: stock?.baseConsumption || 0,
      };
    });
  }

  private getTradeEventsInWindow(
    planetId: string,
    commodityId: string,
    start: number,
    end: number,
  ): NpcTradeEvent[] {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT * FROM trade_events
         WHERE commodity_id = ?
           AND (source_planet = ? OR dest_planet = ?)
           AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp DESC
         LIMIT 10`,
        commodityId, planetId, planetId, start, end,
      )
      .toArray();

    return rows.map((r) => ({
      id: r.id as string,
      routeId: r.route_id as string,
      type: r.type as "departure" | "delivery",
      commodityId: r.commodity_id as string,
      sourcePlanet: r.source_planet as string,
      destPlanet: r.dest_planet as string,
      quantity: r.quantity as number,
      sourcePrice: r.source_price as number,
      destPrice: r.dest_price as number,
      margin: r.margin as number,
      sourceFillBefore: r.source_fill_before as number,
      destFillBefore: r.dest_fill_before as number,
      sourceFillAfter: r.source_fill_after as number,
      destFillAfter: r.dest_fill_after as number,
      timestamp: r.timestamp as number,
    }));
  }

  private getDisruptionsAtTime(
    planetId: string,
    commodityId: string,
    timestamp: number,
  ): AdminDisruptionView[] {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT * FROM active_disruptions
         WHERE planet_id = ?
           AND (commodity_id = ? OR commodity_id IS NULL)
           AND started_at <= ? AND expires_at > ?`,
        planetId, commodityId, timestamp, timestamp,
      )
      .toArray();

    // Also check in-memory disruptions that may match
    const fromMemory = this.disruptions.filter(
      (d) =>
        d.planetId === planetId &&
        ("commodityId" in d ? d.commodityId === commodityId : true) &&
        d.startedAt <= timestamp &&
        d.expiresAt > timestamp,
    );

    // Combine and deduplicate by id
    const allIds = new Set<string>();
    const results: AdminDisruptionView[] = [];

    const addView = (d: { id: string; type: string; planetId: string; commodityId?: string; multiplier?: number; startedAt: number; expiresAt: number }) => {
      if (allIds.has(d.id)) return;
      allIds.add(d.id);
      results.push({
        id: d.id,
        type: d.type,
        planetId: d.planetId,
        commodityId: d.commodityId,
        multiplier: d.multiplier,
        startedAt: d.startedAt,
        expiresAt: d.expiresAt,
        remainingMs: Math.max(0, d.expiresAt - Date.now()),
      });
    };

    for (const r of rows) {
      addView({
        id: r.id as string,
        type: r.type as string,
        planetId: r.planet_id as string,
        commodityId: r.commodity_id as string | undefined,
        multiplier: r.multiplier as number | undefined,
        startedAt: r.started_at as number,
        expiresAt: r.expires_at as number,
      });
    }

    for (const d of fromMemory) {
      addView({
        id: d.id,
        type: d.type,
        planetId: d.planetId,
        commodityId: "commodityId" in d ? d.commodityId : undefined,
        multiplier:
          d.type === "production_boost" || d.type === "demand_surge"
            ? d.multiplier
            : undefined,
        startedAt: d.startedAt,
        expiresAt: d.expiresAt,
      });
    }

    return results;
  }

  private saveMeta(): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO meta (key, value) VALUES ('tickNumber', ?)`,
      String(this.tickNumber),
    );
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO meta (key, value) VALUES ('lastTickAt', ?)`,
      String(this.lastTickAt),
    );
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO meta (key, value) VALUES ('lastR2WriteAt', ?)`,
      String(this.lastR2WriteAt),
    );
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO meta (key, value) VALUES ('warmupComplete', ?)`,
      this.warmupComplete ? "true" : "false",
    );
    if (this.warmupCompletedAt > 0) {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO meta (key, value) VALUES ('warmupCompletedAt', ?)`,
        String(this.warmupCompletedAt),
      );
    }
  }

  // ── R2 Publishing ──

  private async publishR2Snapshot(): Promise<void> {
    const snapshot = this.buildPriceSnapshot();
    try {
      await this.env.STATIC_DATA.put(
        `market/regions/core-worlds.json`,
        JSON.stringify(snapshot),
        {
          httpMetadata: {
            contentType: "application/json",
            cacheControl: "public, max-age=15",
          },
        },
      );
      this.lastR2WriteAt = Date.now();
    } catch (err) {
      console.error("R2 snapshot write failed:", err);
    }
  }

  private buildPriceSnapshot(): unknown {
    const planets: Record<string, Record<string, unknown>> = {};

    for (const [planetId, market] of this.planets) {
      const commodities: Record<string, unknown> = {};
      for (const [commodityId, stock] of market.inventory) {
        const commodity = COMMODITY_MAP.get(commodityId);
        if (!commodity) continue;
        commodities[commodityId] = {
          price: calculatePrice(commodity, stock),
          fillRatio: stock.fillRatio,
          quantity: Math.round(stock.quantity),
          capacity: stock.capacity,
        };
      }
      planets[planetId] = {
        economyType: market.economyType,
        commodities,
      };
    }

    return {
      regionId: "core-worlds",
      updatedAt: new Date().toISOString(),
      tickNumber: this.tickNumber,
      planets,
    };
  }

  // ── HTTP Routing ──

  async fetch(request: Request): Promise<Response> {
    try {
      // Auto-seed on first use in local dev (no ADMIN_API_KEY = wrangler dev).
      // Skipped on /warmup (it seeds itself) and status routes that work without data.
      if (!this.initialized && !this.env.ADMIN_API_KEY) {
        const path = new URL(request.url).pathname;
        if (path !== "/warmup" && path !== "/summary" && path !== "/tick-stats") {
          console.log("[EconomyRegion] Auto-seeding for local dev...");
          await this.runWarmup();
          console.log("[EconomyRegion] Auto-seed complete.");
        }
      }
      return await this._route(request);
    } catch (err: unknown) {
      console.error(`[EconomyRegion] Unhandled error:`, err);
      return errorResponse("Internal error", 500);
    }
  }

  private async _route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── Admin / State queries ──

    if (path === "/state" && request.method === "GET") {
      return this.handleGetState();
    }

    // Live market snapshot — same format as the R2 CDN file.
    // Used by the frontend in local dev (fetched via /api/market/snapshot
    // through the Vite proxy) so the CDN is not required locally.
    if (path === "/snapshot" && request.method === "GET") {
      return json(this.buildPriceSnapshot());
    }

    if (path === "/summary" && request.method === "GET") {
      return this.handleGetSummary();
    }

    if (path === "/tick-stats" && request.method === "GET") {
      return this.handleGetTickStats();
    }

    if (path === "/disruptions" && request.method === "GET") {
      return json(this.getDisruptionViews());
    }

    if (path === "/disrupt" && request.method === "POST") {
      return this.handleTriggerDisruption(request);
    }

    if (path === "/warmup" && request.method === "POST") {
      const forceParam = url.searchParams.get("force");
      return this.handleWarmup(forceParam === "true");
    }

    // ── Price history ──

    if (path === "/history" && request.method === "GET") {
      const planetId = url.searchParams.get("planet");
      const commodityId = url.searchParams.get("commodity");
      const hours = Math.min(Math.max(parseInt(url.searchParams.get("hours") || "24", 10) || 24, 1), 24);
      if (!planetId || !commodityId) {
        return errorResponse("Missing planet or commodity query param");
      }
      return json({
        points: this.getPriceHistory(planetId, commodityId, hours),
        warmupCompletedAt: this.warmupCompletedAt,
      });
    }

    // ── Enriched price history (with trade events + disruptions) ──

    if (path === "/history/enriched" && request.method === "GET") {
      const planetId = url.searchParams.get("planet");
      const commodityId = url.searchParams.get("commodity");
      const hours = Math.min(Math.max(parseInt(url.searchParams.get("hours") || "24", 10) || 24, 1), 24);
      if (!planetId || !commodityId) {
        return errorResponse("Missing planet or commodity query param");
      }
      return json({
        points: this.getEnrichedHistory(planetId, commodityId, hours),
        warmupCompletedAt: this.warmupCompletedAt,
      });
    }

    // ── Trade events ──

    if (path === "/trade-events" && request.method === "GET") {
      const planetId = url.searchParams.get("planet");
      const commodityId = url.searchParams.get("commodity");
      const hours = Math.min(Math.max(parseInt(url.searchParams.get("hours") || "24", 10) || 24, 1), 24);
      return json({
        events: this.getTradeEventsFiltered(planetId, commodityId, hours),
      });
    }

    // ── Price queries ──

    const pricesMatch = path.match(/^\/prices\/(\w+)$/);
    if (pricesMatch && request.method === "GET") {
      return this.handleGetPrices(pricesMatch[1]);
    }

    // ── Trade routes ──

    if (path === "/routes" && request.method === "GET") {
      return json(this.tradeRoutes);
    }

    // ── Deep diagnostics (admin observability) ──

    if (path === "/diagnostics" && request.method === "GET") {
      return this.handleDiagnostics();
    }

    // ── MCP write endpoints ──

    if (path === "/set-stock" && request.method === "POST") {
      return this.handleSetStock(request);
    }

    if (path === "/set-rates" && request.method === "POST") {
      return this.handleSetRates(request);
    }

    if (path === "/set-capacity" && request.method === "POST") {
      return this.handleSetCapacity(request);
    }

    if (path === "/create-route" && request.method === "POST") {
      return this.handleCreateRoute(request);
    }

    if (path === "/rebalance-consumption" && request.method === "POST") {
      return this.handleRebalanceConsumption();
    }

    const routeMatch = path.match(/^\/route\/(.+)$/);
    if (routeMatch) {
      if (request.method === "PATCH") {
        return this.handleUpdateRoute(routeMatch[1], request);
      }
      if (request.method === "DELETE") {
        return this.handleDeleteRoute(routeMatch[1]);
      }
    }

    const disruptionMatch = path.match(/^\/disruption\/(.+)$/);
    if (disruptionMatch && request.method === "DELETE") {
      return this.handleCancelDisruption(disruptionMatch[1]);
    }

    // ── Raw SQL passthrough (MCP database tools) ──

    if (path === "/raw-query" && request.method === "GET") {
      return this.handleRawQuery(url);
    }

    if (path === "/raw-mutate" && request.method === "POST") {
      return this.handleRawMutate(request);
    }

    if (path === "/schema" && request.method === "GET") {
      return this.handleSchema();
    }

    return errorResponse("Not found", 404);
  }

  // ── Handlers ──

  private handleGetState(): Response {
    const now = Date.now();
    const planets: AdminPlanetMarketState[] = [];

    for (const [planetId, market] of this.planets) {
      const config = PLANET_ECONOMIES.find((p) => p.planetId === planetId);
      const commodities: AdminCommodityState[] = [];

      for (const [commodityId, stock] of market.inventory) {
        const commodity = COMMODITY_MAP.get(commodityId);
        if (!commodity) continue;

        const currentPrice = calculatePrice(commodity, stock);
        const sparkline = this.getSparklineData(planetId, commodityId);
        const priceChange24h = this.calculate24hChange(sparkline, currentPrice);

        commodities.push({
          commodityId,
          name: commodity.name,
          category: commodity.category,
          icon: commodity.icon,
          currentPrice,
          basePrice: commodity.basePrice,
          fillRatio: stock.fillRatio,
          quantity: Math.round(stock.quantity),
          capacity: stock.capacity,
          production: stock.baseProduction,
          consumption: stock.baseConsumption,
          priceChange24h,
          trend:
            priceChange24h > 2 ? "up" : priceChange24h < -2 ? "down" : "stable",
          sparkline,
        });
      }

      planets.push({
        planetId,
        name: config?.name || planetId,
        economyType: market.economyType,
        tradeModifier: market.tradeModifier,
        commodities,
      });
    }

    const detail: AdminRegionDetail = {
      regionId: "core-worlds",
      planets,
      routes: this.tradeRoutes,
      disruptions: this.getDisruptionViews(),
      tickStats: this.getTickStatsData(),
    };

    return json(detail);
  }

  private handleGetSummary(): Response {
    const now = Date.now();
    const health: "green" | "yellow" | "red" =
      !this.initialized
        ? "red"
        : now - this.lastTickAt > TICK_INTERVAL_MS * 3
          ? "red"
          : now - this.lastTickAt > TICK_INTERVAL_MS * 2
            ? "yellow"
            : "green";

    const summary: AdminRegionSummary = {
      regionId: "core-worlds",
      planetCount: this.planets.size,
      commodityCount: COMMODITIES.length,
      lastTickAt: this.lastTickAt,
      tickIntervalMs: TICK_INTERVAL_MS,
      tickNumber: this.tickNumber,
      activeDisruptions: this.disruptions.length,
      health,
    };

    return json(summary);
  }

  private handleGetTickStats(): Response {
    return json(this.getTickStatsData());
  }

  private getTickStatsData(): AdminTickStats {
    // Average tick duration from last 50 ticks
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT AVG(duration_ms) as avg_ms, COUNT(*) as cnt FROM tick_log WHERE tick_number > ?",
        Math.max(0, this.tickNumber - 50),
      )
      .toArray();

    const avgMs = rows.length > 0 ? (rows[0].avg_ms as number) || 0 : 0;

    return {
      totalTicks: this.tickNumber,
      avgTickDurationMs: Math.round(avgMs * 100) / 100,
      lastTickAt: this.lastTickAt,
      lastR2WriteAt: this.lastR2WriteAt,
      tickNumber: this.tickNumber,
      warmupComplete: this.warmupComplete,
    };
  }

  private handleGetPrices(planetId: string): Response {
    const market = this.planets.get(planetId);
    if (!market) return errorResponse("Planet not found", 404);

    const prices: Record<string, unknown> = {};
    for (const [commodityId, stock] of market.inventory) {
      const commodity = COMMODITY_MAP.get(commodityId);
      if (!commodity) continue;
      prices[commodityId] = {
        name: commodity.name,
        price: calculatePrice(commodity, stock),
        fillRatio: stock.fillRatio,
        quantity: Math.round(stock.quantity),
        capacity: stock.capacity,
      };
    }

    return json({ planetId, prices });
  }

  private async handleTriggerDisruption(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      type: string;
      planetId: string;
      commodityId?: string;
      multiplier?: number;
      durationMs?: number;
    };

    const now = Date.now();
    const durationMs = body.durationMs || 2 * 3_600_000; // default 2 hours
    const id = `disrupt-${now}-${Math.random().toString(36).slice(2, 8)}`;

    let disruption: MarketDisruption;

    switch (body.type) {
      case "production_halt":
        disruption = {
          type: "production_halt",
          id,
          planetId: body.planetId,
          commodityId: body.commodityId || "iron",
          startedAt: now,
          expiresAt: now + durationMs,
        };
        break;
      case "production_boost":
        disruption = {
          type: "production_boost",
          id,
          planetId: body.planetId,
          commodityId: body.commodityId || "iron",
          multiplier: body.multiplier || 2.0,
          startedAt: now,
          expiresAt: now + durationMs,
        };
        break;
      case "demand_surge":
        disruption = {
          type: "demand_surge",
          id,
          planetId: body.planetId,
          commodityId: body.commodityId || "iron",
          multiplier: body.multiplier || 2.5,
          startedAt: now,
          expiresAt: now + durationMs,
        };
        break;
      default:
        return errorResponse("Invalid disruption type");
    }

    this.disruptions.push(disruption);
    this.saveDisruption(disruption);

    return json({ ok: true, disruptionId: id });
  }

  private async handleWarmup(force = false): Promise<Response> {
    // Self-heal: if warmup claims complete but has no routes, the state was seeded
    // before route generation was added (or the economy config was changed).
    // Treat this as needing a re-bootstrap regardless of the force flag.
    const staleState = this.warmupComplete && this.tradeRoutes.length === 0;

    if (this.warmupComplete && !force && !staleState) {
      return json({ ok: true, message: "Warmup already complete. Use ?force=true to re-bootstrap.", ticksRun: 0, durationMs: 0 });
    }
    const result = await this.runWarmup();
    return json({ ok: true, forced: force || staleState, ...result });
  }

  /**
   * Deep diagnostics — full system health for admin observability.
   * Exposes SQLite table sizes, tick duration trend, alarm state,
   * R2 write tracking, and anomaly flags.
   */
  private handleDiagnostics(): Response {
    const now = Date.now();

    // ── SQLite table row counts ──
    const tableRows = (table: string): number => {
      const r = this.ctx.storage.sql
        .exec(`SELECT COUNT(*) as cnt FROM ${table}`)
        .toArray();
      return (r[0]?.cnt as number) || 0;
    };

    const sqliteTables = {
      planet_markets: tableRows("planet_markets"),
      price_history: tableRows("price_history"),
      trade_routes: tableRows("trade_routes"),
      active_disruptions: tableRows("active_disruptions"),
      tick_log: tableRows("tick_log"),
      meta: tableRows("meta"),
    };

    // ── Tick duration trend (last 60 ticks) ──
    const tickTrend = this.ctx.storage.sql
      .exec(
        `SELECT tick_number, duration_ms, started_at, disruptions_active, r2_write
         FROM tick_log ORDER BY tick_number DESC LIMIT 60`,
      )
      .toArray()
      .map((r) => ({
        tick: r.tick_number as number,
        durationMs: r.duration_ms as number,
        startedAt: r.started_at as number,
        disruptions: r.disruptions_active as number,
        r2Write: (r.r2_write as number) === 1,
      }))
      .reverse();

    // ── Tick timing stats from trend ──
    const durations = tickTrend.map((t) => t.durationMs);
    const avgTickMs = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
    const maxTickMs = durations.length > 0 ? Math.max(...durations) : 0;
    const minTickMs = durations.length > 0 ? Math.min(...durations) : 0;
    const p95TickMs = durations.length > 0
      ? durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)] || 0
      : 0;

    // ── Tick gap detection (alarm health) ──
    const tickGaps: { tick: number; gapMs: number }[] = [];
    for (let i = 1; i < tickTrend.length; i++) {
      const gap = tickTrend[i]!.startedAt - tickTrend[i - 1]!.startedAt;
      // Expected gap is ~60s. Flag gaps > 90s (50% over)
      if (gap > 90_000) {
        tickGaps.push({ tick: tickTrend[i]!.tick, gapMs: gap });
      }
    }

    // ── R2 write tracking ──
    const r2Writes = tickTrend.filter((t) => t.r2Write);
    const lastR2Tick = r2Writes.length > 0 ? r2Writes[r2Writes.length - 1]! : null;
    const r2WriteCount = r2Writes.length;
    // Expected: every tick. In 60 ticks, expect ~60.
    const r2WriteRate = tickTrend.length > 0
      ? r2WriteCount / tickTrend.length
      : 0;

    // ── Price history growth ──
    let priceHistoryOldest = 0;
    let priceHistoryNewest = 0;
    try {
      const oldest = this.ctx.storage.sql
        .exec("SELECT MIN(timestamp) as ts FROM price_history")
        .toArray();
      priceHistoryOldest = (oldest[0]?.ts as number) || 0;
      const newest = this.ctx.storage.sql
        .exec("SELECT MAX(timestamp) as ts FROM price_history")
        .toArray();
      priceHistoryNewest = (newest[0]?.ts as number) || 0;
    } catch {
      // table may be empty
    }
    const priceHistorySpanHours = priceHistoryOldest > 0
      ? (priceHistoryNewest - priceHistoryOldest) / 3_600_000
      : 0;

    // ── Alarm state ──
    // Check time since last tick to infer alarm health
    const timeSinceLastTick = this.lastTickAt > 0 ? now - this.lastTickAt : -1;
    const alarmHealth: "ok" | "delayed" | "missed" | "stopped" =
      !this.warmupComplete
        ? "stopped"
        : timeSinceLastTick < 0
          ? "stopped"
          : timeSinceLastTick <= 90_000
            ? "ok"
            : timeSinceLastTick <= 180_000
              ? "delayed"
              : "missed";

    // ── Anomaly flags ──
    const anomalies: string[] = [];

    if (maxTickMs > 1000) {
      anomalies.push(`TICK_SLOW: max tick took ${maxTickMs}ms (>1s)`);
    }
    if (p95TickMs > 500) {
      anomalies.push(`TICK_P95_HIGH: p95 tick is ${p95TickMs}ms (>500ms)`);
    }
    if (tickGaps.length > 0) {
      anomalies.push(`ALARM_GAPS: ${tickGaps.length} tick gaps >90s detected`);
    }
    if (alarmHealth === "missed" || alarmHealth === "stopped") {
      anomalies.push(`ALARM_${alarmHealth.toUpperCase()}: last tick was ${Math.round(timeSinceLastTick / 1000)}s ago`);
    }
    if (sqliteTables.price_history > 25_000) {
      anomalies.push(`PRICE_HISTORY_LARGE: ${sqliteTables.price_history} rows (pruning may be failing)`);
    }
    if (priceHistorySpanHours > 25) {
      // 24h + 1h buffer
      anomalies.push(`PRICE_HISTORY_OLD: data spans ${priceHistorySpanHours.toFixed(1)}h (should prune at 24h)`);
    }
    if (sqliteTables.tick_log > 1100) {
      anomalies.push(`TICK_LOG_LARGE: ${sqliteTables.tick_log} rows (should cap at 1000)`);
    }
    if (this.lastR2WriteAt > 0 && now - this.lastR2WriteAt > 600_000) {
      anomalies.push(`R2_STALE: last R2 write was ${Math.round((now - this.lastR2WriteAt) / 60_000)}m ago (>10m)`);
    }
    if (r2WriteRate < 0.80 && tickTrend.length >= 10) {
      anomalies.push(`R2_WRITE_LOW: only ${(r2WriteRate * 100).toFixed(0)}% of ticks wrote to R2 (expected ~100%)`);
    }

    return json({
      regionId: "core-worlds",
      timestamp: now,
      initialized: this.initialized,
      warmupComplete: this.warmupComplete,

      // Core tick state
      tick: {
        number: this.tickNumber,
        lastTickAt: this.lastTickAt,
        timeSinceLastTickMs: timeSinceLastTick,
        intervalMs: TICK_INTERVAL_MS,
        alarmHealth,
      },

      // Tick performance
      tickPerformance: {
        avgMs: Math.round(avgTickMs * 100) / 100,
        minMs: minTickMs,
        maxMs: maxTickMs,
        p95Ms: p95TickMs,
        sampleSize: durations.length,
        trend: tickTrend.map((t) => ({
          tick: t.tick,
          ms: t.durationMs,
        })),
      },

      // Alarm gaps
      tickGaps,

      // SQLite storage
      sqlite: {
        tables: sqliteTables,
        totalRows: Object.values(sqliteTables).reduce((a, b) => a + b, 0),
      },

      // R2 write health
      r2: {
        lastWriteAt: this.lastR2WriteAt,
        timeSinceLastWriteMs: this.lastR2WriteAt > 0 ? now - this.lastR2WriteAt : -1,
        snapshotEveryNTicks: R2_SNAPSHOT_EVERY,
        recentWriteCount: r2WriteCount,
        writeRatePercent: Math.round(r2WriteRate * 10000) / 100,
      },

      // Price history span
      priceHistory: {
        rowCount: sqliteTables.price_history,
        oldestTimestamp: priceHistoryOldest,
        newestTimestamp: priceHistoryNewest,
        spanHours: Math.round(priceHistorySpanHours * 10) / 10,
        pruneThresholdHours: 24,
      },

      // Disruptions
      disruptions: {
        active: this.disruptions.length,
        list: this.getDisruptionViews(),
      },

      // In-memory state sizes
      memory: {
        planets: this.planets.size,
        totalCommoditySlots: Array.from(this.planets.values()).reduce(
          (acc, p) => acc + p.inventory.size,
          0,
        ),
        tradeRoutes: this.tradeRoutes.length,
      },

      // Anomaly flags
      anomalies,
      healthy: anomalies.length === 0,
    });
  }

  // ── MCP Write Handlers ──

  private async handleSetStock(request: Request): Promise<Response> {
    let body: { planetId: string; commodityId: string; quantity: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    if (!body.planetId || !body.commodityId || body.quantity === undefined) {
      return errorResponse("planetId, commodityId, and quantity are required");
    }

    const market = this.planets.get(body.planetId);
    if (!market) return errorResponse("Planet not found", 404);

    const stock = market.inventory.get(body.commodityId);
    if (!stock) return errorResponse("Commodity not found on this planet", 404);

    const before = { quantity: stock.quantity, fillRatio: stock.fillRatio };
    stock.quantity = Math.max(0, body.quantity);
    stock.fillRatio = stock.capacity > 0 ? stock.quantity / stock.capacity : 0;
    if (Number.isNaN(stock.fillRatio)) stock.fillRatio = 0;

    this.saveOneStock(market.planetId, stock);

    const commodity = COMMODITY_MAP.get(body.commodityId);
    const newPrice = commodity ? calculatePrice(commodity, stock) : 0;

    return json({
      ok: true,
      before,
      after: { quantity: stock.quantity, fillRatio: stock.fillRatio, price: newPrice },
    });
  }

  private async handleSetRates(request: Request): Promise<Response> {
    let body: { planetId: string; commodityId: string; production?: number; consumption?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    if (!body.planetId || !body.commodityId) {
      return errorResponse("planetId and commodityId are required");
    }

    const market = this.planets.get(body.planetId);
    if (!market) return errorResponse("Planet not found", 404);

    const stock = market.inventory.get(body.commodityId);
    if (!stock) return errorResponse("Commodity not found on this planet", 404);

    const before = { production: stock.baseProduction, consumption: stock.baseConsumption };
    if (body.production !== undefined) stock.baseProduction = Math.max(0, body.production);
    if (body.consumption !== undefined) stock.baseConsumption = Math.max(0, body.consumption);

    this.saveOneStock(market.planetId, stock);

    return json({
      ok: true,
      before,
      after: { production: stock.baseProduction, consumption: stock.baseConsumption },
    });
  }

  private async handleSetCapacity(request: Request): Promise<Response> {
    let body: { planetId: string; commodityId: string; capacity: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    if (!body.planetId || !body.commodityId || !body.capacity) {
      return errorResponse("planetId, commodityId, and capacity are required");
    }

    const market = this.planets.get(body.planetId);
    if (!market) return errorResponse("Planet not found", 404);

    const stock = market.inventory.get(body.commodityId);
    if (!stock) return errorResponse("Commodity not found on this planet", 404);

    const before = { capacity: stock.capacity, fillRatio: stock.fillRatio };
    stock.capacity = Math.max(1, body.capacity);
    // NaN guard: if quantity was corrupted, reset to 0 before computing ratio
    if (Number.isNaN(stock.quantity)) stock.quantity = 0;
    stock.fillRatio = stock.capacity > 0 ? stock.quantity / stock.capacity : 0;
    if (Number.isNaN(stock.fillRatio)) stock.fillRatio = 0;

    this.saveOneStock(market.planetId, stock);

    const commodity = COMMODITY_MAP.get(body.commodityId);
    const newPrice = commodity ? calculatePrice(commodity, stock) : 0;

    return json({
      ok: true,
      before,
      after: { capacity: stock.capacity, fillRatio: stock.fillRatio, price: newPrice },
    });
  }

  /**
   * Rebalance consumption rates on the live economy without resetting.
   * Applies tiered logic: advanced (tech/luxury) = 0 unless consumed, basic = 0.3-0.5.
   */
  private handleRebalanceConsumption(): Response {
    const changes: { planet: string; commodity: string; before: number; after: number }[] = [];

    for (const [planetId, market] of this.planets) {
      const config = PLANET_ECONOMIES.find((p) => p.planetId === planetId);
      if (!config) continue;

      for (const [commodityId, stock] of market.inventory) {
        const isConsumed = config.consumes.includes(commodityId);
        if (isConsumed) continue; // leave explicit consumers untouched

        // Non-consumed commodities: zero drain. Player-driven markets only.
        const newRate = 0;
        const before = stock.baseConsumption;

        if (Math.abs(before - newRate) > 0.01) {
          stock.baseConsumption = newRate;
          changes.push({ planet: planetId, commodity: commodityId, before: Math.round(before * 100) / 100, after: Math.round(newRate * 100) / 100 });
        }
      }
    }

    this.saveMarketState();

    return json({
      ok: true,
      changesApplied: changes.length,
      changes: changes.slice(0, 30), // cap output
      narrative: `Rebalanced ${changes.length} consumption rates. Non-consumed commodities set to 0 (player-driven markets).`,
    });
  }

  private async handleCreateRoute(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      commodityId: string;
      sourcePlanet: string;
      destPlanet: string;
      volumePerTrip?: number;
      tripDurationMs?: number;
    };
    if (!body.commodityId || !body.sourcePlanet || !body.destPlanet) {
      return errorResponse("commodityId, sourcePlanet, and destPlanet are required");
    }

    // Validate planets exist
    if (!this.planets.has(body.sourcePlanet)) return errorResponse("Source planet not found", 404);
    if (!this.planets.has(body.destPlanet)) return errorResponse("Dest planet not found", 404);

    // Validate commodity exists
    if (!COMMODITY_MAP.has(body.commodityId)) return errorResponse("Commodity not found", 404);

    const id = `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const route: NpcTradeRoute = {
      id,
      commodityId: body.commodityId,
      sourcePlanet: body.sourcePlanet,
      destPlanet: body.destPlanet,
      volumePerTrip: body.volumePerTrip || 30,
      tripDurationMs: body.tripDurationMs || 3_600_000,
      lastDeparture: 0,
      enabled: true,
      inTransit: false,
      cargoInTransit: 0,
      effectiveTripMs: 0,
    };

    this.tradeRoutes.push(route);
    this.saveTradeRoutes();

    return json({ ok: true, routeId: id, route });
  }

  private async handleUpdateRoute(routeId: string, request: Request): Promise<Response> {
    const body = (await request.json()) as {
      volumePerTrip?: number;
      tripDurationMs?: number;
      active?: boolean;   // Legacy — maps to enabled
      enabled?: boolean;
    };

    const route = this.tradeRoutes.find((r) => r.id === routeId);
    if (!route) return errorResponse("Route not found", 404);

    const before = {
      volumePerTrip: route.volumePerTrip,
      tripDurationMs: route.tripDurationMs,
      enabled: route.enabled,
    };

    if (body.volumePerTrip !== undefined) route.volumePerTrip = body.volumePerTrip;
    if (body.tripDurationMs !== undefined) route.tripDurationMs = body.tripDurationMs;
    // Support both "enabled" and legacy "active" (active maps to enabled)
    if (body.enabled !== undefined) route.enabled = body.enabled;
    else if (body.active !== undefined) route.enabled = body.active;

    this.saveTradeRoutes();

    return json({ ok: true, before, after: { volumePerTrip: route.volumePerTrip, tripDurationMs: route.tripDurationMs, enabled: route.enabled } });
  }

  private handleDeleteRoute(routeId: string): Response {
    const idx = this.tradeRoutes.findIndex((r) => r.id === routeId);
    if (idx === -1) return errorResponse("Route not found", 404);

    const removed = this.tradeRoutes.splice(idx, 1)[0];
    this.ctx.storage.sql.exec("DELETE FROM trade_routes WHERE id = ?", routeId);

    return json({ ok: true, deleted: routeId, route: removed });
  }

  private handleCancelDisruption(disruptionId: string): Response {
    const idx = this.disruptions.findIndex((d) => d.id === disruptionId);
    if (idx === -1) return errorResponse("Disruption not found", 404);

    const removed = this.disruptions.splice(idx, 1)[0];
    this.ctx.storage.sql.exec("DELETE FROM active_disruptions WHERE id = ?", disruptionId);

    return json({
      ok: true,
      cancelled: disruptionId,
      type: removed!.type,
      planetId: removed!.planetId,
    });
  }

  // ── Raw SQL Handlers (MCP database tools) ──

  private handleRawQuery(url: URL): Response {
    const sql = url.searchParams.get("sql");
    if (!sql) return errorResponse("'sql' query param is required");

    // Only allow SELECT statements; block multi-statement injection via semicolons
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("PRAGMA") && !trimmed.startsWith("EXPLAIN")) {
      return errorResponse("Only SELECT, PRAGMA, and EXPLAIN statements are allowed", 403);
    }
    if (sql.includes(";")) {
      return errorResponse("Multi-statement queries are not allowed", 403);
    }

    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "100", 10),
      1000,
    );

    try {
      const rows = this.ctx.storage.sql.exec(sql).toArray();
      return json({
        rows: rows.slice(0, limit),
        count: Math.min(rows.length, limit),
        totalRows: rows.length,
        truncated: rows.length > limit,
      });
    } catch (err: unknown) {
      console.error("[EconomyRegion] Raw query error:", err);
      return errorResponse("Query failed", 400);
    }
  }

  private async handleRawMutate(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      sql: string;
      params?: unknown[];
    };
    if (!body.sql) return errorResponse("'sql' is required");

    // Block destructive DDL and multi-statement injection
    const trimmed = body.sql.trim().toUpperCase();
    if (trimmed.startsWith("DROP") || trimmed.startsWith("ALTER")) {
      return errorResponse("DROP and ALTER statements are blocked", 403);
    }
    if (body.sql.includes(";")) {
      return errorResponse("Multi-statement queries are not allowed", 403);
    }

    try {
      if (body.params && body.params.length > 0) {
        this.ctx.storage.sql.exec(body.sql, ...body.params);
      } else {
        this.ctx.storage.sql.exec(body.sql);
      }
      return json({ ok: true, sql: body.sql });
    } catch (err: unknown) {
      console.error("[EconomyRegion] Raw mutate error:", err);
      return errorResponse("Query failed", 400);
    }
  }

  private handleSchema(): Response {
    const tables = this.ctx.storage.sql
      .exec(
        `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .toArray();

    const indices = this.ctx.storage.sql
      .exec(
        `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name`,
      )
      .toArray();

    // Get row counts for each table
    const tableDetails = tables.map((t) => {
      const name = t.name as string;
      let rowCount = 0;
      try {
        const r = this.ctx.storage.sql.exec(`SELECT COUNT(*) as cnt FROM "${name}"`).toArray();
        rowCount = (r[0]?.cnt as number) || 0;
      } catch {
        // Table may not be readable
      }

      // Get columns
      let columns: { name: string; type: string }[] = [];
      try {
        const cols = this.ctx.storage.sql.exec(`PRAGMA table_info("${name}")`).toArray();
        columns = cols.map((c) => ({
          name: c.name as string,
          type: c.type as string,
        }));
      } catch {
        // PRAGMA may fail
      }

      return {
        name,
        createSql: t.sql as string,
        rowCount,
        columns,
      };
    });

    return json({
      tables: tableDetails,
      indices: indices.map((i) => ({
        name: i.name as string,
        table: i.tbl_name as string,
        createSql: i.sql as string,
      })),
      tableCount: tables.length,
      indexCount: indices.length,
    });
  }

  // ── Helpers ──

  private getSparklineData(
    planetId: string,
    commodityId: string,
  ): number[] {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT price FROM price_history
         WHERE planet_id = ? AND commodity_id = ?
         ORDER BY timestamp DESC
         LIMIT 48`,
        planetId,
        commodityId,
      )
      .toArray();

    return rows.map((r) => r.price as number).reverse();
  }

  private getPriceHistory(
    planetId: string,
    commodityId: string,
    hours: number,
  ): PriceHistoryPoint[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT price, fill_ratio, timestamp FROM price_history
         WHERE planet_id = ? AND commodity_id = ? AND timestamp > ?
         ORDER BY timestamp ASC`,
        planetId,
        commodityId,
        cutoff,
      )
      .toArray();

    return rows.map((r) => ({
      price: r.price as number,
      fillRatio: r.fill_ratio as number,
      timestamp: r.timestamp as number,
    }));
  }

  private calculate24hChange(sparkline: number[], currentPrice: number): number {
    if (sparkline.length < 2) return 0;
    const oldest = sparkline[0];
    if (oldest === 0) return 0;
    return Math.round(((currentPrice - oldest) / oldest) * 10000) / 100;
  }

  private getDisruptionViews(): AdminDisruptionView[] {
    const now = Date.now();
    return this.disruptions.map((d) => ({
      id: d.id,
      type: d.type,
      planetId: d.planetId,
      commodityId: "commodityId" in d ? d.commodityId : undefined,
      multiplier:
        d.type === "production_boost" || d.type === "demand_surge"
          ? d.multiplier
          : undefined,
      startedAt: d.startedAt,
      expiresAt: d.expiresAt,
      remainingMs: Math.max(0, d.expiresAt - now),
    }));
  }
}
