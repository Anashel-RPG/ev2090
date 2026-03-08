/**
 * EV 2090 MCP Server — Type Definitions
 */

// ── Environment bindings ──

export interface Env {
  // MCP Session (local DO)
  MCP_SESSION: DurableObjectNamespace;

  // Cross-worker DO bindings (from ev-2090-ws)
  ECONOMY_REGION: DurableObjectNamespace;
  CHAT_ROOM: DurableObjectNamespace;
  BOARD_ROOM: DurableObjectNamespace;
  SHIP_FORGE: DurableObjectNamespace;

  // R2 Buckets
  STATIC_DATA: R2Bucket;
  SHIP_MODELS: R2Bucket;

  // Service binding to game worker
  GAME_API: Fetcher;

  // API keys (3-tier)
  MCP_API_KEY?: string;     // Full access (delete, raw SQL, etc.)
  MCP_API_KEY_RW?: string;  // Read/write (no delete, no raw SQL)
  MCP_API_KEY_RO?: string;  // Read-only

  // OAuth
  OAUTH_HMAC_SECRET?: string;

  // Config
  WORKER_VERSION: string;
  LOG_LEVEL: string;
  ALLOWED_ORIGINS?: string;
}

// ── MCP Protocol ──

export interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, PropertySchema>;
    required?: string[];
  };
}

export interface PropertySchema {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
  items?: PropertySchema;
  properties?: Record<string, PropertySchema>;
}

// ── Auth ──

export type MCPScope = "none" | "full" | "rw" | "ro";

export interface AuthResult {
  authorized: boolean;
  scope: MCPScope;
  error?: string;
}

// ── Logging ──

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  sessionId?: string;
  tool?: string;
  message: string;
  data?: unknown;
}

// ── Economy types (mirrors worker/src/types/economy.ts) ──

export interface CommodityDef {
  id: string;
  name: string;
  category: "minerals" | "food" | "tech" | "industrial" | "luxury";
  basePrice: number;
  minPrice: number;
  maxPrice: number;
  volatility: number;
  decayRate: number;
  unitSize: number;
  legal: boolean;
  icon: string;
  description: string;
}

export interface AdminCommodityState {
  commodityId: string;
  name: string;
  category: string;
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

export interface AdminRegionDetail {
  regionId: string;
  planets: AdminPlanetMarketState[];
  routes: NpcTradeRoute[];
  disruptions: AdminDisruptionView[];
  tickStats: AdminTickStats;
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
  type: "production_halt" | "production_boost" | "demand_surge" | "discovery";
  planetId: string;
  commodityId?: string;
  multiplier?: number;
  startedAt: number;
  expiresAt: number;
  remainingMs: number;
}

export interface AdminTickStats {
  currentTick: number;
  lastTickAt: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p95DurationMs: number;
  warmupComplete: boolean;
}

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

export interface PriceHistoryPoint {
  price: number;
  fillRatio: number;
  timestamp: number;
}

export interface EnrichedPriceHistoryPoint extends PriceHistoryPoint {
  tradeEvents: NpcTradeEvent[];
  activeDisruptions: AdminDisruptionView[];
  production: number;
  consumption: number;
}

// ── MCP tool response helpers ──

export type HealthStatus = "healthy" | "strained" | "critical" | "halted";

export interface ToolResponse {
  [key: string]: unknown;
}
