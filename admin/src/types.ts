/**
 * Admin frontend types — mirrors worker/src/types/economy.ts admin types.
 * Kept separate to avoid cross-workspace imports.
 */

export type CommodityCategory =
  | "minerals"
  | "food"
  | "tech"
  | "industrial"
  | "luxury";

export interface CommodityDef {
  id: string;
  name: string;
  category: CommodityCategory;
  basePrice: number;
  minPrice: number;
  maxPrice: number;
  volatility: number;
  decayRate: number;
  unitSize: number;
  legal: boolean;
  description: string;
  icon: string;
}

export interface AdminRegionSummary {
  regionId: string;
  planetCount: number;
  commodityCount: number;
  lastTickAt: number;
  tickIntervalMs: number;
  tickNumber: number;
  activeDisruptions: number;
  health: "green" | "yellow" | "red";
}

export interface AdminCommodityState {
  commodityId: string;
  name: string;
  category: CommodityCategory;
  icon: string;
  currentPrice: number;
  basePrice: number;
  fillRatio: number;
  quantity: number;
  capacity: number;
  production: number;
  consumption: number;
  priceChange24h: number;
  trend: "up" | "down" | "stable";
  sparkline: number[];
}

export interface AdminPlanetMarketState {
  planetId: string;
  name: string;
  economyType: string;
  tradeModifier: number;
  commodities: AdminCommodityState[];
}

export interface NpcTradeRoute {
  id: string;
  commodityId: string;
  sourcePlanet: string;
  destPlanet: string;
  volumePerTrip: number;
  tripDurationMs: number;
  lastDeparture: number;
  enabled: boolean;
  inTransit: boolean;
}

export interface AdminDisruptionView {
  id: string;
  type: string;
  planetId: string;
  commodityId?: string;
  multiplier?: number;
  startedAt: number;
  expiresAt: number;
  remainingMs: number;
}

export interface AdminTickStats {
  totalTicks: number;
  avgTickDurationMs: number;
  lastTickAt: number;
  lastR2WriteAt: number;
  tickNumber: number;
  warmupComplete: boolean;
}

export interface AdminRegionDetail {
  regionId: string;
  planets: AdminPlanetMarketState[];
  routes: NpcTradeRoute[];
  disruptions: AdminDisruptionView[];
  tickStats: AdminTickStats;
}

export interface AdminInfraHealth {
  workerVersion: string;
  economy: {
    regionId: string;
    lastTickAt: number;
    tickHealth: "ok" | "delayed" | "stopped";
    avgTickMs: number;
    totalTicks: number;
    warmupComplete: boolean;
  };
  r2: {
    lastWriteAt: number;
    snapshotIntervalMs: number;
  };
}

export interface PriceHistoryPoint {
  price: number;
  fillRatio: number;
  timestamp: number;
}

export interface PriceHistoryResponse {
  points: PriceHistoryPoint[];
  warmupCompletedAt: number;
}

// ── NPC Trade Events ──

export interface NpcTradeEvent {
  id: string;
  routeId: string;
  type: "departure" | "delivery";
  commodityId: string;
  sourcePlanet: string;
  destPlanet: string;
  quantity: number;
  sourcePrice: number;
  destPrice: number;
  margin: number;
  sourceFillBefore: number;
  destFillBefore: number;
  sourceFillAfter: number;
  destFillAfter: number;
  timestamp: number;
}

export interface TradeEventsResponse {
  events: NpcTradeEvent[];
}

// ── Enriched Price History ──

export interface EnrichedPriceHistoryPoint extends PriceHistoryPoint {
  tradeEvents: NpcTradeEvent[];
  activeDisruptions: AdminDisruptionView[];
  production: number;
  consumption: number;
}

export interface EnrichedPriceHistoryResponse {
  points: EnrichedPriceHistoryPoint[];
  warmupCompletedAt: number;
}

/** Deep diagnostics from EconomyRegion DO */
export interface EconomyDiagnostics {
  regionId: string;
  timestamp: number;
  initialized: boolean;
  warmupComplete: boolean;

  tick: {
    number: number;
    lastTickAt: number;
    timeSinceLastTickMs: number;
    intervalMs: number;
    alarmHealth: "ok" | "delayed" | "missed" | "stopped";
  };

  tickPerformance: {
    avgMs: number;
    minMs: number;
    maxMs: number;
    p95Ms: number;
    sampleSize: number;
    trend: { tick: number; ms: number }[];
  };

  tickGaps: { tick: number; gapMs: number }[];

  sqlite: {
    tables: {
      planet_markets: number;
      price_history: number;
      trade_routes: number;
      active_disruptions: number;
      tick_log: number;
      meta: number;
    };
    totalRows: number;
  };

  r2: {
    lastWriteAt: number;
    timeSinceLastWriteMs: number;
    snapshotEveryNTicks: number;
    recentWriteCount: number;
    writeRatePercent: number;
  };

  priceHistory: {
    rowCount: number;
    oldestTimestamp: number;
    newestTimestamp: number;
    spanHours: number;
    pruneThresholdHours: number;
  };

  disruptions: {
    active: number;
    list: AdminDisruptionView[];
  };

  memory: {
    planets: number;
    totalCommoditySlots: number;
    tradeRoutes: number;
  };

  anomalies: string[];
  healthy: boolean;
}

export type Page = "economy" | "region" | "viewer" | "infra";
