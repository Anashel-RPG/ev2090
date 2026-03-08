/**
 * Economy type definitions for EV 2090.
 * Used by EconomyRegion DO, admin API, and admin frontend.
 */

// ── Commodity Catalog ──

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
  basePrice: number;       // Galactic average in credits
  minPrice: number;        // Floor (never below)
  maxPrice: number;        // Ceiling (never above)
  volatility: number;      // 0-1, sigmoid steepness
  decayRate: number;       // Ornstein-Uhlenbeck theta (mean reversion speed)
  unitSize: number;        // Tons per unit
  legal: boolean;
  description: string;
  icon: string;            // Emoji
}

export interface CommodityCatalog {
  commodities: CommodityDef[];
  categories: CommodityCategory[];
  updatedAt: string;
}

// ── Planet Economy ──

export type PlanetEconomyType =
  | "mining"
  | "agricultural"
  | "industrial"
  | "trade-hub"
  | "research";

export interface PlanetEconomyConfig {
  planetId: string;
  name: string;
  economyType: PlanetEconomyType;
  produces: string[];      // commodity IDs
  consumes: string[];      // commodity IDs
  tradeModifier: number;   // 1.0 = normal, 0.85 = 15% cheaper
}

// ── Market State (runtime, in EconomyRegion DO) ──

export interface CommodityStock {
  commodityId: string;
  quantity: number;
  capacity: number;
  fillRatio: number;       // quantity / capacity
  baseProduction: number;  // units/tick produced by NPC factories
  baseConsumption: number; // units/tick consumed by NPC demand
  lastTradePrice: number;
  lastTradeTime: number;   // unix ms
}

export interface PlanetMarket {
  planetId: string;
  economyType: PlanetEconomyType;
  tradeModifier: number;
  inventory: Map<string, CommodityStock>;
}

// ── NPC Trade Routes ──

export interface NpcTradeRoute {
  id: string;
  commodityId: string;
  sourcePlanet: string;
  destPlanet: string;
  volumePerTrip: number;     // Cargo capacity — scales with route length
  tripDurationMs: number;    // Base trip duration (30-120 min)
  lastDeparture: number;     // unix ms
  enabled: boolean;          // Admin toggle — false = route won't dispatch
  inTransit: boolean;        // True while cargo is mid-flight
  // Per-trip state (set on departure, cleared on delivery)
  cargoInTransit: number;    // Actual cargo loaded on current trip
  effectiveTripMs: number;   // Jittered trip duration for this trip
}

// ── Market Disruptions ──

export type MarketDisruption =
  | {
      type: "production_boost";
      id: string;
      planetId: string;
      commodityId: string;
      multiplier: number;
      startedAt: number;
      expiresAt: number;
    }
  | {
      type: "production_halt";
      id: string;
      planetId: string;
      commodityId: string;
      startedAt: number;
      expiresAt: number;
    }
  | {
      type: "demand_surge";
      id: string;
      planetId: string;
      commodityId: string;
      multiplier: number;
      startedAt: number;
      expiresAt: number;
    }
  | {
      type: "discovery";
      id: string;
      planetId: string;
      commodityId: string;
      capacityIncrease: number;
      startedAt: number;
      expiresAt: number;
    };

// ── Trade Execution ──

export interface PlayerTrade {
  planetId: string;
  commodityId: string;
  action: "buy" | "sell";
  quantity: number;
}

export interface TradeResult {
  success: boolean;
  error?: string;
  pricePerUnit?: number;
  total?: number;
  newPrice?: number;
  quantityFilled?: number;
}

// ── Admin API Response Types ──

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

export interface AdminPlanetMarketState {
  planetId: string;
  name: string;
  economyType: PlanetEconomyType;
  tradeModifier: number;
  commodities: AdminCommodityState[];
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

export interface AdminTickStats {
  totalTicks: number;
  avgTickDurationMs: number;
  lastTickAt: number;
  lastR2WriteAt: number;
  tickNumber: number;
  warmupComplete: boolean;
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

// ── NPC Trade Events (logged per-trade for admin analytics) ──

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
  margin: number;             // (destPrice - sourcePrice) / sourcePrice
  sourceFillBefore: number;   // fill ratio before trade
  destFillBefore: number;
  sourceFillAfter: number;    // fill ratio after trade
  destFillAfter: number;
  timestamp: number;
}

// ── Enriched price history (with trade events + disruptions at that time) ──

export interface EnrichedPriceHistoryPoint extends PriceHistoryPoint {
  tradeEvents: NpcTradeEvent[];
  activeDisruptions: AdminDisruptionView[];
  production: number;
  consumption: number;
}
