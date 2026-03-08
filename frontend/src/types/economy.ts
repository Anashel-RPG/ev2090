/**
 * Economy types — player cargo, market prices, and transactions.
 * All player state is persisted to localStorage.
 * Market prices come from the EconomyRegion Durable Object API.
 */

export type CommodityCategory = "minerals" | "food" | "tech" | "industrial" | "luxury";

/** Lightweight commodity info for frontend display (mirrors worker/src/data/commodities.ts) */
export interface CommodityInfo {
  id: string;
  name: string;
  category: CommodityCategory;
  icon: string;
  unitSize: number;     // tons per unit
  basePrice: number;    // equilibrium reference price
  description: string;
}

/** Per-commodity price data from the market snapshot */
export interface MarketPrice {
  price: number;
  fillRatio: number;
  quantity: number;
  capacity: number;
}

/** Full market snapshot from /api/market/state */
export interface MarketSnapshot {
  regionId: string;
  updatedAt: string;
  tickNumber: number;
  planets: Record<string, {
    economyType: string;
    commodities: Record<string, MarketPrice>;
  }>;
}

/** Single item in the player's cargo hold */
export interface CargoItem {
  commodityId: string;
  quantity: number;
  avgBuyPrice: number;   // weighted average purchase price for P&L
}

/** Buy/sell transaction log entry */
export interface TradeTransaction {
  id: string;
  timestamp: number;     // unix ms
  planetId: string;
  commodityId: string;
  action: "buy" | "sell";
  quantity: number;
  pricePerUnit: number;
  total: number;
}

/** Complete player economy state — persisted to localStorage */
export interface PlayerEconomyState {
  credits: number;
  cargo: CargoItem[];
  transactions: TradeTransaction[];  // capped at 100
  version: 1;
}

/** Initial state for new players */
export const INITIAL_PLAYER_ECONOMY: PlayerEconomyState = {
  credits: 10_000,
  cargo: [],
  transactions: [],
  version: 1,
};
