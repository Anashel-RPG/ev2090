/**
 * EV 2090 MCP Server — Tool Registry
 *
 * 37 tools across 10 categories. Analytical query architecture.
 * Tools are analytical instruments — they accept scope, dimensions, and measures.
 * Action tools return { ok, message }. Read tools lead with a summary sentence.
 */

import type { Env, MCPScope, MCPToolDefinition } from "../types";
import { Logger } from "../logger";

// Tool handler imports
import { handleEconomyIntel } from "./economy-intel";
import { handleMarketOps } from "./market-ops";
import { handleTradeRoutes } from "./trade-routes";
import { handleDisruptions } from "./disruptions";
import { handleForecast } from "./forecast";
import { handleDatabase } from "./database";
import { handleR2Storage } from "./r2-storage";
import { handleShipForge } from "./ship-forge";
import { handleSocial } from "./social";
import { handleInfra } from "./infra";

// ── Scope-based access control ──

function toolVerb(toolName: string): string {
  const idx = toolName.indexOf("_");
  return idx === -1 ? toolName : toolName.slice(0, idx);
}

export function isToolAllowedForScope(
  toolName: string,
  scope: MCPScope
): boolean {
  if (scope === "full") return true;

  const verb = toolVerb(toolName);

  // Delete/mutate never allowed for rw or ro
  const isDestructive = verb === "delete" || verb === "mutate";
  if (isDestructive) return false;

  // These tools carry full-scope blast radius and require explicit elevation
  const FULL_SCOPE_ONLY = new Set(["write_r2", "warmup_economy", "seed_data"]);

  if (scope === "rw") {
    if (FULL_SCOPE_ONLY.has(toolName)) return false;
    return true;
  }

  if (scope === "ro") {
    if (toolName === "help") return true;
    const readVerbs = [
      "inspect",
      "find",
      "get",
      "list",
      "forecast",
      "diagnose",
      "crosscheck",
      "check",
      "describe",
      "read",
      "query",
    ];
    return readVerbs.includes(verb);
  }

  return false;
}

export function toolDefinitionsForScope(
  scope: MCPScope
): MCPToolDefinition[] {
  if (scope === "full") return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.filter((t) => isToolAllowedForScope(t.name, scope));
}

// ── Tool dispatch ──

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger,
  scope: MCPScope
): Promise<unknown> {
  if (!isToolAllowedForScope(toolName, scope)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const category = TOOL_CATEGORY_MAP[toolName];
  if (!category) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  switch (category) {
    case "economy-intel":
      return handleEconomyIntel(toolName, args, env, logger);
    case "market-ops":
      return handleMarketOps(toolName, args, env, logger);
    case "trade-routes":
      return handleTradeRoutes(toolName, args, env, logger);
    case "disruptions":
      return handleDisruptions(toolName, args, env, logger);
    case "forecast":
      return handleForecast(toolName, args, env, logger);
    case "database":
      return handleDatabase(toolName, args, env, logger);
    case "r2-storage":
      return handleR2Storage(toolName, args, env, logger);
    case "ship-forge":
      return handleShipForge(toolName, args, env, logger);
    case "social":
      return handleSocial(toolName, args, env, logger);
    case "infra":
      return handleInfra(toolName, args, env, logger);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ── Tool → Category mapping ──

type ToolCategory =
  | "economy-intel"
  | "market-ops"
  | "trade-routes"
  | "disruptions"
  | "forecast"
  | "database"
  | "r2-storage"
  | "ship-forge"
  | "social"
  | "infra";

const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  // Economy Intelligence (analytical queries)
  query_economy: "economy-intel",
  inspect_commodity: "economy-intel",
  find_arbitrage: "economy-intel",

  // Market Operations (actions → { ok, message })
  set_stock_level: "market-ops",
  set_production_rate: "market-ops",
  set_capacity: "market-ops",
  rebalance_consumption: "market-ops",

  // Trade Route Management
  query_routes: "trade-routes",
  create_route: "trade-routes",
  update_route: "trade-routes",
  delete_route: "trade-routes",

  // Event & Disruption Control
  trigger_disruption: "disruptions",
  list_disruptions: "disruptions",
  cancel_disruption: "disruptions",
  get_event_log: "disruptions",

  // Forecast & Diagnosis
  forecast_economy: "forecast",
  diagnose_commodity: "forecast",
  crosscheck_r2: "forecast",
  query_history: "forecast",

  // D1 Database (escape hatches)
  query_db: "database",
  mutate_db: "database",
  describe_schema: "database",

  // R2 Storage
  list_r2: "r2-storage",
  read_r2: "r2-storage",
  write_r2: "r2-storage",
  delete_r2: "r2-storage",

  // Ship Forge
  list_ships: "ship-forge",
  inspect_ship: "ship-forge",
  delete_ship: "ship-forge",

  // Social
  read_chat: "social",
  send_chat: "social",
  read_board: "social",
  post_board: "social",

  // Infrastructure
  check_health: "infra",
  get_tick_log: "infra",
  warmup_economy: "infra",
  seed_data: "infra",
};

// ── Tool definitions (37 tools) ──

export const TOOL_DEFINITIONS: MCPToolDefinition[] = [
  // ═══════════════════════════════════════
  // Economy Intelligence — Analytical Queries
  // ═══════════════════════════════════════
  {
    name: "query_economy",
    description:
      "Analytical pivot tool for the entire economy. Filter by scope (planet, commodity, category, health status), group by dimension (planet, commodity, category), choose detail or summary aggregation, sort and limit. Replaces scan_economy, scan_planet, get_market_prices, and compare_commodity in a single call.",
    inputSchema: {
      type: "object",
      properties: {
        planet: {
          type: "string",
          description: "Filter to one planet (e.g., \"velkar\")",
        },
        commodity: {
          type: "string",
          description: "Filter to one commodity (e.g., \"iron\")",
        },
        category: {
          type: "string",
          description: "Filter by commodity category",
          enum: ["minerals", "food", "tech", "industrial", "luxury"],
        },
        health: {
          type: "string",
          description: "Filter by health status",
          enum: ["halted", "critical", "strained", "healthy"],
        },
        groupBy: {
          type: "string",
          description: "Pivot axis for grouping results",
          enum: ["planet", "commodity", "category"],
        },
        aggregate: {
          type: "string",
          description: "\"detail\" returns per-row data, \"summary\" returns min/max/avg per group (requires groupBy)",
          enum: ["detail", "summary"],
        },
        sort: {
          type: "string",
          description: "Sort field. Prefix \"-\" for descending. Options: price, fill, prod, cons, net, health, price_ratio, change_24h (default: -health)",
        },
        limit: {
          type: "number",
          description: "Max rows to return (default 10, max 100)",
        },
      },
    },
  },
  {
    name: "inspect_commodity",
    description:
      "Narrative-first deep dive into one commodity at one planet. Returns health status, supply/demand balance, route coverage, and active disruptions. Use query_economy for cross-planet comparison instead.",
    inputSchema: {
      type: "object",
      properties: {
        commodity: {
          type: "string",
          description: "Commodity ID (e.g., \"steel\")",
        },
        planet: {
          type: "string",
          description: "Planet ID (e.g., \"velkar\")",
        },
      },
      required: ["commodity", "planet"],
    },
  },
  {
    name: "find_arbitrage",
    description:
      "Ranked trade opportunities across all planet pairs. Returns margin, buy/sell prices, profit per unit, and NPC route count.",
    inputSchema: {
      type: "object",
      properties: {
        minMargin: {
          type: "number",
          description: "Minimum margin % to include (default 10)",
        },
        commodity: {
          type: "string",
          description: "Filter to specific commodity",
        },
        limit: {
          type: "number",
          description: "Max results (default 20)",
        },
      },
    },
  },

  // ═══════════════════════════════════════
  // Market Operations — Actions → { ok, message }
  // ═══════════════════════════════════════
  {
    name: "set_stock_level",
    description:
      "Set absolute quantity of a commodity at a planet. Recalculates fill ratio and price.",
    inputSchema: {
      type: "object",
      properties: {
        planet: { type: "string", description: "Planet ID" },
        commodity: { type: "string", description: "Commodity ID" },
        quantity: {
          type: "number",
          description: "New absolute quantity (0 to capacity)",
        },
      },
      required: ["planet", "commodity", "quantity"],
    },
  },
  {
    name: "set_production_rate",
    description:
      "Modify base production or consumption rate. Permanent until changed again. For temporary effects, use trigger_disruption.",
    inputSchema: {
      type: "object",
      properties: {
        planet: { type: "string", description: "Planet ID" },
        commodity: { type: "string", description: "Commodity ID" },
        production: {
          type: "number",
          description: "New base production rate (units/tick)",
        },
        consumption: {
          type: "number",
          description: "New base consumption rate (units/tick)",
        },
      },
      required: ["planet", "commodity"],
    },
  },
  {
    name: "set_capacity",
    description:
      "Change storage capacity for a commodity at a planet. Affects fill ratio and price.",
    inputSchema: {
      type: "object",
      properties: {
        planet: { type: "string", description: "Planet ID" },
        commodity: { type: "string", description: "Commodity ID" },
        capacity: { type: "number", description: "New capacity value" },
      },
      required: ["planet", "commodity", "capacity"],
    },
  },
  {
    name: "rebalance_consumption",
    description:
      "Apply tiered consumption rates: tech/luxury zeroed, basic goods 0.3-0.5/tick. Does not reset stock levels.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ═══════════════════════════════════════
  // Trade Route Management
  // ═══════════════════════════════════════
  {
    name: "query_routes",
    description:
      "Analytical query over NPC trade routes. Filter by planet, commodity, or active status. Returns enriched routes with live margin calculation.",
    inputSchema: {
      type: "object",
      properties: {
        commodity: {
          type: "string",
          description: "Filter by commodity",
        },
        planet: {
          type: "string",
          description: "Filter by source or destination planet",
        },
        active: {
          type: "boolean",
          description: "Filter by in-transit state (true/false)",
        },
        enabled: {
          type: "boolean",
          description: "Filter by enabled state (true/false)",
        },
        sort: {
          type: "string",
          description: "Sort field, \"-\" prefix for desc (default: \"-margin\")",
        },
        limit: {
          type: "number",
          description: "Max routes (default 10)",
        },
      },
    },
  },
  {
    name: "create_route",
    description:
      "Create a new NPC trade lane between two planets for a commodity.",
    inputSchema: {
      type: "object",
      properties: {
        commodity: { type: "string", description: "Commodity ID" },
        sourcePlanet: { type: "string", description: "Source planet ID" },
        destPlanet: { type: "string", description: "Destination planet ID" },
        volumePerTrip: {
          type: "number",
          description: "Units per trip (default 30)",
        },
        tripDurationMin: {
          type: "number",
          description: "Trip duration in minutes (default 60)",
        },
      },
      required: ["commodity", "sourcePlanet", "destPlanet"],
    },
  },
  {
    name: "update_route",
    description:
      "Modify a trade route's volume, duration, or active status.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "Route ID" },
        volumePerTrip: { type: "number", description: "New volume per trip" },
        tripDurationMin: {
          type: "number",
          description: "New trip duration in minutes",
        },
        active: {
          type: "boolean",
          description: "Enable or disable the route (pause/resume dispatching)",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "delete_route",
    description:
      "Permanently remove a trade route.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "Route ID to delete" },
      },
      required: ["routeId"],
    },
  },

  // ═══════════════════════════════════════
  // Event & Disruption Control
  // ═══════════════════════════════════════
  {
    name: "trigger_disruption",
    description:
      "Inject a market disruption. Supports production_halt, production_boost, and demand_surge.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Disruption type",
          enum: ["production_halt", "production_boost", "demand_surge"],
        },
        planet: { type: "string", description: "Planet ID" },
        commodity: { type: "string", description: "Commodity ID" },
        multiplier: {
          type: "number",
          description: "Multiplier for boost/surge (default 2.0)",
        },
        durationHours: {
          type: "number",
          description: "Duration in hours (default 2)",
        },
      },
      required: ["type", "planet", "commodity"],
    },
  },
  {
    name: "list_disruptions",
    description:
      "Active disruptions with remaining time and impact scope.",
    inputSchema: {
      type: "object",
      properties: {
        planet: {
          type: "string",
          description: "Filter by planet (optional)",
        },
      },
    },
  },
  {
    name: "cancel_disruption",
    description:
      "End an active disruption immediately.",
    inputSchema: {
      type: "object",
      properties: {
        disruptionId: {
          type: "string",
          description: "Disruption ID to cancel",
        },
      },
      required: ["disruptionId"],
    },
  },
  {
    name: "get_event_log",
    description:
      "NPC trade events (departures/deliveries) with prices, margins, and fill impacts.",
    inputSchema: {
      type: "object",
      properties: {
        planet: {
          type: "string",
          description: "Filter by planet (source or dest)",
        },
        commodity: { type: "string", description: "Filter by commodity" },
        hours: {
          type: "number",
          description: "Lookback hours (default 24, max 24)",
        },
        limit: {
          type: "number",
          description: "Max events (default 50)",
        },
      },
    },
  },

  // ═══════════════════════════════════════
  // Forecast & Diagnosis
  // ═══════════════════════════════════════
  {
    name: "forecast_economy",
    description:
      "Forward simulation using tick engine logic. Returns crisis predictions (shortages, overflows) and summary narrative.",
    inputSchema: {
      type: "object",
      properties: {
        hours: {
          type: "number",
          description: "Hours to simulate (default 4, max 24)",
        },
        planet: {
          type: "string",
          description: "Focus on specific planet (optional)",
        },
        commodity: {
          type: "string",
          description: "Focus on specific commodity (optional)",
        },
      },
    },
  },
  {
    name: "diagnose_commodity",
    description:
      "Root-cause analysis for an unhealthy commodity. Cross-references price history, trade events, disruptions, and route coverage.",
    inputSchema: {
      type: "object",
      properties: {
        commodity: { type: "string", description: "Commodity ID" },
        planet: { type: "string", description: "Planet ID" },
        hours: {
          type: "number",
          description: "Lookback window in hours (default 24)",
        },
      },
      required: ["commodity", "planet"],
    },
  },
  {
    name: "crosscheck_r2",
    description:
      "Compare live Durable Object state against last R2 snapshot. Flags price/fill divergence above threshold.",
    inputSchema: {
      type: "object",
      properties: {
        threshold: {
          type: "number",
          description: "Minimum % divergence to flag (default 5)",
        },
      },
    },
  },
  {
    name: "query_history",
    description:
      "Price + fill time series with OHLC aggregation. Returns hourly or daily buckets instead of raw points. Use for trend analysis.",
    inputSchema: {
      type: "object",
      properties: {
        planet: { type: "string", description: "Planet ID" },
        commodity: { type: "string", description: "Commodity ID" },
        hours: {
          type: "number",
          description: "Lookback hours (default 24, max 24)",
        },
        aggregate: {
          type: "string",
          description: "Aggregation level (default \"hourly\")",
          enum: ["raw", "hourly", "daily"],
        },
      },
      required: ["planet", "commodity"],
    },
  },

  // ═══════════════════════════════════════
  // D1 Database — Escape Hatches
  // ═══════════════════════════════════════
  {
    name: "query_db",
    description:
      "Read-only SQL (SELECT) against EconomyRegion SQLite. Escape hatch for edge cases.",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "SELECT query to execute",
        },
        params: {
          type: "string",
          description: "Bind parameters as JSON array (optional)",
        },
        limit: {
          type: "number",
          description: "Max rows (default 100, max 1000)",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "mutate_db",
    description:
      "Write SQL (INSERT/UPDATE/DELETE) against SQLite. Bypasses business logic — use with caution.",
    inputSchema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "SQL statement (INSERT, UPDATE, or DELETE)",
        },
        params: {
          type: "string",
          description: "Bind parameters as JSON array (optional)",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "describe_schema",
    description:
      "List all SQLite tables with schemas, row counts, and index info.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ═══════════════════════════════════════
  // R2 Storage — Escape Hatches
  // ═══════════════════════════════════════
  {
    name: "list_r2",
    description:
      "Browse R2 bucket files. Returns keys, sizes (bytes), and modification times.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: {
          type: "string",
          description: "\"data\" or \"ships\" (default: \"data\")",
          enum: ["data", "ships"],
        },
        prefix: {
          type: "string",
          description: "Key prefix filter (e.g., \"market/\")",
        },
        limit: {
          type: "number",
          description: "Max results (default 50, max 500)",
        },
      },
    },
  },
  {
    name: "read_r2",
    description:
      "Read a file from R2. JSON is parsed. Binary returns metadata only.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: {
          type: "string",
          description: "\"data\" or \"ships\" (default: \"data\")",
          enum: ["data", "ships"],
        },
        key: {
          type: "string",
          description: "Object key (e.g., \"market/regions/core-worlds.json\")",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "write_r2",
    description:
      "Write or overwrite a file in R2. JSON is auto-serialized.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: {
          type: "string",
          description: "\"data\" or \"ships\" (default: \"data\")",
          enum: ["data", "ships"],
        },
        key: { type: "string", description: "Object key" },
        content: {
          type: "string",
          description: "Content to write (JSON string or raw text)",
        },
        contentType: {
          type: "string",
          description: "MIME type (default \"application/json\")",
        },
      },
      required: ["key", "content"],
    },
  },
  {
    name: "delete_r2",
    description:
      "Delete a file from R2. Permanent.",
    inputSchema: {
      type: "object",
      properties: {
        bucket: {
          type: "string",
          description: "\"data\" or \"ships\" (default: \"data\")",
          enum: ["data", "ships"],
        },
        key: { type: "string", description: "Object key to delete" },
      },
      required: ["key"],
    },
  },

  // ═══════════════════════════════════════
  // Ship Forge
  // ═══════════════════════════════════════
  {
    name: "list_ships",
    description:
      "List community ships in the forge catalog with metadata, stats, and model URLs.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max ships (default 20)",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor",
        },
      },
    },
  },
  {
    name: "inspect_ship",
    description:
      "Full detail for a community ship — generation history, stats, materials, creator.",
    inputSchema: {
      type: "object",
      properties: {
        shipId: { type: "string", description: "Ship ID" },
      },
      required: ["shipId"],
    },
  },
  {
    name: "delete_ship",
    description:
      "Remove a ship from forge catalog and delete its R2 assets.",
    inputSchema: {
      type: "object",
      properties: {
        shipId: { type: "string", description: "Ship ID to delete" },
      },
      required: ["shipId"],
    },
  },

  // ═══════════════════════════════════════
  // Social
  // ═══════════════════════════════════════
  {
    name: "read_chat",
    description:
      "Recent global chat messages (server retains last 7).",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max messages (default 7, max 10)",
        },
      },
    },
  },
  {
    name: "send_chat",
    description:
      "Post a system/DM message to global chat. Visible to all connected players.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Message text (max 500 chars)",
        },
        nickname: {
          type: "string",
          description: "Display name (default \"SYSTEM\")",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "read_board",
    description:
      "Planet station community board notes, sorted by recency.",
    inputSchema: {
      type: "object",
      properties: {
        planet: { type: "string", description: "Planet ID" },
        limit: {
          type: "number",
          description: "Max notes (default 20, max 50)",
        },
      },
      required: ["planet"],
    },
  },
  {
    name: "post_board",
    description:
      "Post a note to a planet's community board. For lore, quest hints, or warnings.",
    inputSchema: {
      type: "object",
      properties: {
        planet: { type: "string", description: "Planet ID" },
        text: {
          type: "string",
          description: "Note text (max 280 chars)",
        },
        nickname: {
          type: "string",
          description: "Display name (default \"STATION BULLETIN\")",
        },
      },
      required: ["planet", "text"],
    },
  },

  // ═══════════════════════════════════════
  // Infrastructure
  // ═══════════════════════════════════════
  {
    name: "check_health",
    description:
      "System health check: tick engine, R2, SQLite, anomalies. Returns overall status with narrative.",
    inputSchema: {
      type: "object",
      properties: {
        includeRaw: {
          type: "boolean",
          description: "Include raw diagnostics payload (default false)",
        },
      },
    },
  },
  {
    name: "get_tick_log",
    description:
      "Recent tick execution log with duration trends and gap detection.",
    inputSchema: {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "Number of recent ticks (default 60, max 1000)",
        },
      },
    },
  },
  {
    name: "warmup_economy",
    description:
      "Bootstrap economy with 1440 ticks (24h simulation). For fresh deployments or resets.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "seed_data",
    description:
      "Verify commodity catalog in R2 and trigger economy warmup. One-time setup.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];
