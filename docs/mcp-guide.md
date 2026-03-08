[<- Back to index](/README.md)

# MCP Server Guide

What if you could manage a game economy by talking to an AI? The MCP server makes that possible. Instead of building an admin dashboard with buttons and dropdowns, EV 2090 exposes its entire universe as a set of tools that any MCP-compatible AI assistant can call. You say "What's the iron market doing on Arctis?" and Claude inspects the commodity, reads the price history, checks for disruptions, and tells you what's happening -- all in natural language.

This guide covers what the MCP server is, how to connect it, and a complete reference for all 37 tools.

---

## What is MCP?

MCP stands for **Model Context Protocol** -- an open standard for connecting AI assistants to external tools and data sources. Think of it as a USB port for AI: a universal interface that lets any compatible client (Claude, Claude Code, or custom agents) discover and use your tools without bespoke integration work.

For EV 2090, this means your game economy becomes something you can query and control through conversation:

```
You: "Show me the economy health"
Claude: [calls check_health]
        "The economy looks healthy overall. 24 commodities across 5 planets,
         2 at critical fill levels. Iron on Velkar has been stuck at 4% fill
         for 3 hours -- no inbound trade routes and zero production.
         Want me to diagnose it?"

You: "Yeah, what's going on?"
Claude: [calls diagnose_commodity with commodity: "iron", planet: "velkar"]
        "Root cause: Velkar has no iron production and no inbound NPC routes.
         The only supply was a route from Nexara that was deleted 6 hours ago.
         Consumption is draining the last 4% of stock at 0.3 units/tick.

         Options:
         1. Create a new trade route from a producing planet
         2. Set a production rate to give Velkar local supply
         3. Trigger a production_boost disruption as a temporary fix"

You: "Create a route from Nexara, 40 units per trip"
Claude: [calls create_route with commodity: "iron", sourcePlanet: "nexara",
         destPlanet: "velkar", volumePerTrip: 40]
        "Done. Iron route created: Nexara -> Velkar, 40 units/trip,
         60-minute cycles. First delivery should arrive within the hour."
```

No admin panel needed. No clicking through menus. Just conversation.

---

## Quick Start

### 1. Deploy the MCP worker

```bash
cd worker-mcp
npx wrangler deploy
```

See [cloudflare-setup.md](./cloudflare-setup.md) for full deployment details including wrangler.toml configuration, DO bindings, R2 buckets, secrets, and environment variables.

### 2. Set your API secrets

```bash
cd worker-mcp
npx wrangler secret put MCP_API_KEY          # Full access (admin)
npx wrangler secret put MCP_API_KEY_RW       # Read/write (no delete, no raw SQL)
npx wrangler secret put MCP_API_KEY_RO       # Read-only
npx wrangler secret put OAUTH_HMAC_SECRET    # For Claude.ai OAuth flow
```

You need at least `MCP_API_KEY` set. The other two are optional if you only need one access tier.

### 3. Connect a client

There are three ways to connect an MCP client to the server:

**Claude.ai (web) -- OAuth flow:**

1. Open [claude.ai](https://claude.ai) and go to Settings
2. Find the MCP integrations section
3. Add a new MCP server with URL: `https://mcp.ev2090.com`
4. Claude will redirect you through the OAuth authorization flow
5. When prompted for credentials, enter your API key as the `client_secret`
6. After authorization, you will be redirected back to Claude
7. All tools matching your key's tier will be available in conversations

**Claude Code (CLI) -- Bearer token:**

Add the server to your Claude Code MCP settings (typically `~/.claude/settings.json` or your project's `.claude/settings.local.json`):

```json
{
  "mcpServers": {
    "ev2090": {
      "url": "https://mcp.ev2090.com",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

Claude Code will discover all available tools on startup and make them callable in your session.

**Cursor -- Bearer token:**

Same pattern as Claude Code. Add to your Cursor MCP settings (`.cursor/mcp.json` or global settings):

```json
{
  "mcpServers": {
    "ev2090": {
      "url": "https://mcp.ev2090.com",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

### 4. Start talking

```
"Show me the economy health"
"What's the best arbitrage opportunity right now?"
"Trigger a mining accident on Velkar that halts iron production for 4 hours"
"Forecast the next 12 hours for the steel market"
```

---

## Authentication

The MCP server uses a layered auth system. Every request must carry a valid API key -- there are no public endpoints beyond the health check and OAuth metadata.

### 3-Tier API Key System

Three keys, three access levels. Each key unlocks a progressively larger set of tools:

| Tier | Secret Name | What It Can Do | What It Cannot Do |
|------|-------------|----------------|-------------------|
| **Full** | `MCP_API_KEY` | Everything -- all 37 tools including delete, raw SQL, and R2 writes | Nothing is off-limits |
| **Read/Write** | `MCP_API_KEY_RW` | All read tools + write tools (create routes, set prices, trigger disruptions) | `delete_*`, `mutate_db` |
| **Read-Only** | `MCP_API_KEY_RO` | All query, inspect, list, forecast, diagnose, and check tools | Any tool that modifies state |

The scope is resolved by checking the provided key against all three secrets using **timing-safe comparison** (constant-time string matching). Even when one key matches early, all three comparisons still execute to prevent timing-based key enumeration.

**How scope filtering works:** When a client connects and calls `tools/list`, the server returns only the tools that their key tier allows. A read-only key will never even see `trigger_disruption` in the tool list. The filtering is based on the tool name's verb prefix:

- Read verbs: `query`, `inspect`, `find`, `list`, `get`, `describe`, `read`, `check`, `forecast`, `diagnose`, `crosscheck`
- Write verbs: `set`, `create`, `update`, `trigger`, `cancel`, `send`, `post`, `write`, `rebalance`, `warmup`, `seed`
- Destructive verbs: `delete`, `mutate` (full-access only)

### API Key Delivery

Keys can be sent in any of these headers:

```
Authorization: Bearer <key>
X-MCP-API-Key: <key>
X-API-Key: <key>
```

### OAuth 2.0 Flow (Claude.ai)

Claude.ai uses OAuth 2.0 with PKCE to authenticate. The MCP server implements this as a **stateless** flow -- no database, no session store, no server-side state.

Here is how it works:

```
+--------------+         +---------------+         +--------------+
|  Claude.ai   |         |  MCP Server   |         |    User      |
|  (client)    |         |  (ev2090-mcp) |         |  (browser)   |
+------+-------+         +------+--------+         +------+-------+
       |                        |                         |
       |  1. /authorize         |                         |
       |  + code_challenge      |                         |
       |  + redirect_uri        |                         |
       | ---------------------->|                         |
       |                        |                         |
       |  2. 302 redirect       |                         |
       |  + auth code           |                         |
       | <----------------------|                         |
       |                        |                         |
       |  3. /oauth/token       |                         |
       |  + code                |                         |
       |  + code_verifier       |                         |
       |  + client_secret       |                         |
       |  (= your API key)      |                         |
       | ---------------------->|                         |
       |                        |                         |
       |  4. access_token       |                         |
       |  (= your API key)      |                         |
       | <----------------------|                         |
       |                        |                         |
       |  5. MCP requests       |                         |
       |  + Bearer token        |                         |
       | ---------------------->|                         |
```

Key details:

- **Stateless auth codes:** The authorization code is a JSON payload (code_challenge + redirect_uri + client_id + timestamp) encoded in base64 and signed with HMAC-SHA256. No database lookup needed to verify it.
- **5-minute TTL:** Auth codes expire after 5 minutes. The timestamp is baked into the signed payload.
- **PKCE (S256):** The server verifies that SHA256(code_verifier) matches the code_challenge from the authorization step.
- **The access token IS the API key:** After the OAuth dance, the returned `access_token` is your original API key. The OAuth flow is purely for Claude.ai's authentication handshake.
- **client_credentials grant:** Also supported for direct API usage without the browser redirect flow. Send `grant_type=client_credentials` with your API key as `client_secret`.

### Security Headers

Every response includes:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Block iframe embedding |
| `X-XSS-Protection` | `1; mode=block` | XSS filter |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Cache-Control` | `no-store, no-cache, must-revalidate` | Prevent caching of sensitive data |

Request bodies are capped at **64 KB** to prevent abuse.

---

## Architecture

The MCP server is a separate Cloudflare Worker (`ev2090-mcp`) that acts as a bridge between MCP clients and the game's backend infrastructure.

```
+--------------------------------+
|  Claude.ai / Claude Code       |
|  (MCP Client)                  |
+-------------+------------------+
              | WebSocket / SSE / HTTP POST
              |
+-------------v------------------+
|  ev2090-mcp  (Cloudflare Worker)|
|                                 |
|  +---------------------------+ |
|  | MCPSession Durable Object | |
|  | - WebSocket transport     | |
|  | - SSE transport           | |
|  | - HTTP POST JSON-RPC      | |
|  | - Auth scope per session  | |
|  | - Tool dispatch           | |
|  +----------+----------------+ |
|             |                   |
|  +----------v----------------+ |
|  | Tool Handlers (10 modules)| |
|  | - economy-intel           | |
|  | - market-ops              | |
|  | - trade-routes            | |
|  | - disruptions             | |
|  | - forecast                | |
|  | - database                | |
|  | - r2-storage              | |
|  | - ship-forge              | |
|  | - social                  | |
|  | - infra                   | |
|  +----------+----------------+ |
|             |                   |
|  +----------v----------------+ |
|  | API Client Layer          | |
|  | - callEconomyDO()        | |
|  | - callChatDO()           | |
|  | - callBoardDO()          | |
|  | - callForgeDO()          | |
|  | - callAdminApi()         | |
|  | - getR2Bucket()          | |
|  +----------+----------------+ |
+--------------+------------------+
              | Cross-worker DO bindings
              | + Service binding + R2
              |
+--------------v------------------+
|  ev-2090-ws  (Game Worker)      |
|                                 |
|  EconomyRegionDO  (economy)     |
|  ChatRoom         (global chat) |
|  BoardRoom        (planet notes)|
|  ShipForge        (ship gen)    |
|                                 |
|  R2: ev2090-data (market data)  |
|  R2: ev2090-ships (ship models) |
+---------------------------------+
```

### How it connects

The MCP worker does not call the game worker over HTTP. Instead, it uses Cloudflare's **cross-worker Durable Object bindings** to talk directly to the game's Durable Objects. This means:

- **Zero network hops.** The MCP worker calls `env.ECONOMY_REGION.get(id).fetch(...)` which routes directly to the EconomyRegion Durable Object in the game worker. No external HTTP, no DNS, no TLS handshake.
- **Shared R2 buckets.** Both workers bind to the same R2 buckets (`ev2090-data` and `ev2090-ships`), so the MCP server can read and write market data and ship models directly.
- **Service binding fallback.** For admin API endpoints that live on the game worker's HTTP router (rather than a specific DO), the MCP server uses a service binding (`GAME_API`) to make internal fetch calls.

### Transport modes

The MCPSession Durable Object handles three transport protocols:

| Transport | How It Connects | Best For |
|-----------|----------------|----------|
| **WebSocket** | `Upgrade: websocket` header | Persistent bidirectional sessions |
| **SSE** | `GET /sse` or `Accept: text/event-stream` | Server-push streaming |
| **HTTP POST** | `POST /` or `POST /rpc` (JSON-RPC body) | Claude.ai Streamable HTTP transport |

All three speak the same JSON-RPC 2.0 protocol underneath. The session ID is either provided via query param (`?session=...`) or auto-generated.

---

## Tool Reference

37 tools organized into 10 categories. Each tool is described with its purpose, parameters, and which access tier can use it.

### Economy Intelligence (3 tools)

The analytical core. These tools read market state and return structured data with narrative summaries.

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `query_economy` | Analytical pivot across all markets. Filter by planet, commodity, category, or health status. Group by dimension, choose detail or summary aggregation, sort, and limit. This is the flagship query tool -- it replaces half a dozen single-purpose queries. | None (all optional) | ro, rw, full |
| `inspect_commodity` | Narrative deep dive into one commodity at one planet. Returns health status, supply/demand balance, trade route coverage, active disruptions, and contextual hints about what to do next. | `commodity`, `planet` | ro, rw, full |
| `find_arbitrage` | Ranked trade opportunities across all planet pairs. Returns margin percentage, buy/sell prices, profit per unit, and whether NPC routes already cover the lane. | None (all optional) | ro, rw, full |

**Example -- query_economy:**
```json
{
  "planet": "velkar",
  "sort": "-health",
  "limit": 5
}
```
Returns the 5 unhealthiest commodities on Velkar, sorted worst-first, with a summary like: "Velkar: 24 commodities. 1 halted, 2 critical. Avg fill 42%."

**Example -- find_arbitrage:**
```json
{
  "minMargin": 25,
  "commodity": "iron"
}
```
Returns all iron trade opportunities with 25%+ margin, ranked by profitability.

---

### Market Operations (4 tools)

Direct market manipulation. All return `{ ok: true, message: "..." }` on success.

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `set_stock_level` | Set absolute quantity of a commodity at a planet. Automatically recalculates fill ratio and price. | `planet`, `commodity`, `quantity` | rw, full |
| `set_production_rate` | Modify base production and/or consumption rate. Permanent until changed again. For temporary effects, use `trigger_disruption` instead. | `planet`, `commodity` + at least one of `production`, `consumption` | rw, full |
| `set_capacity` | Change storage capacity for a commodity at a planet. Affects fill ratio and therefore price. | `planet`, `commodity`, `capacity` | rw, full |
| `rebalance_consumption` | Apply tiered consumption rates across all commodities: tech/luxury zeroed, basic goods 0.3-0.5/tick. Does not reset stock levels. | None | rw, full |

---

### Trade Routes (4 tools)

Manage NPC trade lanes between planets. NPC ships automatically haul commodities along active routes, balancing supply and demand across the system.

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `query_routes` | Analytical query over NPC trade routes with live margin calculation. Filter by planet, commodity, or active status. | None (all optional) | ro, rw, full |
| `create_route` | Create a new NPC trade lane between two planets for a commodity. | `commodity`, `sourcePlanet`, `destPlanet` | rw, full |
| `update_route` | Modify a route's volume per trip, trip duration, or active/inactive state. | `routeId` | rw, full |
| `delete_route` | Permanently remove a trade route. | `routeId` | full only |

---

### Disruptions (4 tools)

Inject temporary market events. Disruptions are time-limited and self-expire. They are the primary tool for creating interesting economic dynamics without permanently changing production rates.

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `trigger_disruption` | Inject a market disruption: `production_halt`, `production_boost`, or `demand_surge`. Specify planet, commodity, multiplier, and duration. | `type`, `planet`, `commodity` | rw, full |
| `list_disruptions` | List active disruptions with remaining time and impact scope. Optionally filter by planet. | None (all optional) | ro, rw, full |
| `cancel_disruption` | End an active disruption immediately. | `disruptionId` | rw, full |
| `get_event_log` | NPC trade events (departures and deliveries) with prices, margins, and fill ratio impacts. | None (all optional) | ro, rw, full |

---

### Forecast and Diagnostics (4 tools)

Forward-looking analysis and root-cause investigation. These tools help you understand what will happen and why things went wrong.

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `forecast_economy` | Forward simulation using the tick engine's logic. Returns crisis predictions (shortages, overflows) and a narrative summary. | None (all optional: `hours`, `planet`, `commodity`) | ro, rw, full |
| `diagnose_commodity` | Root-cause analysis for an unhealthy commodity. Cross-references price history, trade events, disruptions, and route coverage. | `commodity`, `planet` | ro, rw, full |
| `crosscheck_r2` | Compare live Durable Object state against the last R2 snapshot. Flags any price or fill divergence above a threshold percentage. | None (optional: `threshold`) | ro, rw, full |
| `query_history` | Price and fill time series with OHLC aggregation. Returns hourly or daily buckets for trend analysis. | `planet`, `commodity` | ro, rw, full |

---

### Database (3 tools)

Escape hatches for when the structured tools do not cover your query. Use with care -- these bypass all business logic.

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `query_db` | Read-only SQL (`SELECT`) against the EconomyRegion's SQLite database. Supports bind parameters and row limits. | `sql` | ro, rw, full |
| `mutate_db` | Write SQL (`INSERT`/`UPDATE`/`DELETE`) against SQLite. **Bypasses business logic.** Changes are real and immediate. | `sql` | full only |
| `describe_schema` | List all SQLite tables with their schemas, row counts, and index information. Great for understanding what is queryable. | None | ro, rw, full |

---

### R2 Storage (4 tools)

Direct access to the R2 object storage buckets shared with the game worker. Two buckets are available: `data` (market data, commodity catalogs) and `ships` (community ship models).

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `list_r2` | Browse bucket files. Returns keys, sizes in bytes, and modification times. | None (optional: `bucket`, `prefix`, `limit`) | ro, rw, full |
| `read_r2` | Read a file. JSON is automatically parsed. Binary files return metadata only. | `key` | ro, rw, full |
| `write_r2` | Write or overwrite a file. JSON content is auto-serialized. | `key`, `content` | rw, full |
| `delete_r2` | Permanently delete a file. | `key` | full only |

---

### Ship Forge (3 tools)

Manage community-generated ships in the forge catalog. Ships are created through the game's AI pipeline (Grok + Gemini + MeshyAI) and stored as GLB models in R2.

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `list_ships` | List community ships with metadata, stats, and model URLs. Supports pagination. | None (optional: `limit`, `cursor`) | ro, rw, full |
| `inspect_ship` | Full detail for one ship: generation history, stats, materials, and creator info. | `shipId` | ro, rw, full |
| `delete_ship` | Remove a ship from the forge catalog and delete its R2 assets (model + textures). | `shipId` | full only |

---

### Social (4 tools)

Read and write to the game's communication channels -- the global chat and planet-specific community boards.

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `read_chat` | Recent global chat messages. The server retains the last 7 messages. | None (optional: `limit`) | ro, rw, full |
| `send_chat` | Post a system or DM message to global chat. Visible to all connected players. Max 500 characters. | `text` | rw, full |
| `read_board` | Planet station community board notes, sorted by recency. | `planet` | ro, rw, full |
| `post_board` | Post a note to a planet's community board. For lore, quest hints, or warnings. Max 280 characters. | `planet`, `text` | rw, full |

---

### Infrastructure (4 tools)

System health, tick engine monitoring, and bootstrap operations.

| Tool | Description | Required Params | Access |
|------|-------------|-----------------|--------|
| `check_health` | System health check covering the tick engine, R2, SQLite, and anomaly detection. Returns an overall status with narrative. | None (optional: `includeRaw`) | ro, rw, full |
| `get_tick_log` | Recent tick execution log with duration trends and gap detection. Useful for spotting tick engine issues. | None (optional: `count`) | ro, rw, full |
| `warmup_economy` | Bootstrap the economy with 1440 ticks (equivalent to 24 hours of simulation). For fresh deployments or resets. | None | rw, full |
| `seed_data` | Verify the commodity catalog in R2 and trigger economy warmup. One-time setup for new deployments. | None | rw, full |

---

## Common Workflows

### Diagnose a Failing Market

When a commodity is unhealthy, follow this investigation path:

```
1. check_health
   -> Spot the problem: "Iron on Velkar: HALTED at 0% fill"

2. diagnose_commodity  (commodity: "iron", planet: "velkar")
   -> Root cause: "Zero supply -- no production, no inbound routes.
      Last route deleted 6h ago. Consumption draining at 0.3/tick."

3. query_routes  (commodity: "iron", planet: "velkar")
   -> Confirm: no active routes serving Velkar for iron

4. query_economy  (commodity: "iron", groupBy: "planet")
   -> Find surplus: "Nexara has iron at 78% fill, net +2.1/tick"

5. create_route  (commodity: "iron", sourcePlanet: "nexara", destPlanet: "velkar")
   -> Fix: NPC haulers begin supplying iron to Velkar
```

### Set Up a New Commodity Pipeline

When adding supply infrastructure for a commodity:

```
1. query_economy  (commodity: "steel", sort: "fill")
   -> See which planets have surplus and which have deficit

2. find_arbitrage  (commodity: "steel")
   -> Identify the most profitable trade lanes

3. create_route  (for each lane with high margin and no existing route)
   -> Establish NPC trade infrastructure

4. forecast_economy  (commodity: "steel", hours: 24)
   -> Verify the new routes will balance supply over time

5. query_routes  (commodity: "steel")
   -> Confirm all routes are active and margins are viable
```

### Run a Forecast and Act on It

```
1. forecast_economy  (hours: 12)
   -> "CRISIS: Silicon will deplete on Arctis in ~4 hours.
      Circuits surplus building on Meridian (92% fill by hour 8)."

2. trigger_disruption  (type: "demand_surge", planet: "meridian",
                         commodity: "circuits", durationHours: 6)
   -> Increase demand to drain the surplus

3. create_route  (commodity: "silicon", sourcePlanet: "nexara",
                   destPlanet: "arctis", volumePerTrip: 50)
   -> Prevent the silicon shortage

4. forecast_economy  (hours: 12)
   -> Verify the interventions resolve both issues
```

### Manage Community Ships

```
1. list_ships  (limit: 50)
   -> Browse the forge catalog

2. inspect_ship  (shipId: "some-ship-id")
   -> Check generation history, stats, and model quality

3. delete_ship  (shipId: "some-ship-id")
   -> Remove a problematic or low-quality ship (full access only)
```

---

## Source Files

All MCP server code lives in `worker-mcp/src/`:

| File | Purpose |
|------|---------|
| `worker-mcp/src/index.ts` | Worker entry point -- HTTP routing, OAuth endpoints, CORS, session dispatch |
| `worker-mcp/src/mcp-session.ts` | MCPSession Durable Object -- WebSocket/SSE/HTTP transports, JSON-RPC protocol, tool dispatch |
| `worker-mcp/src/auth.ts` | 3-tier API key resolution, OAuth 2.0 + PKCE (stateless auth codes with HMAC) |
| `worker-mcp/src/security.ts` | Timing-safe comparison, CORS headers, security headers, body size validation, audit logging |
| `worker-mcp/src/logger.ts` | Structured logger -- session-aware, level-filtered, tool-tagged |
| `worker-mcp/src/types.ts` | Type definitions -- Env bindings, MCP protocol types, economy types, auth types |
| `worker-mcp/src/tools/index.ts` | Tool registry -- 37 definitions, scope filtering, category dispatch |
| `worker-mcp/src/tools/api-client.ts` | Internal API client -- DO bindings (Economy, Chat, Board, Forge) + service binding + R2 |
| `worker-mcp/src/tools/economy-intel.ts` | `query_economy`, `inspect_commodity`, `find_arbitrage` |
| `worker-mcp/src/tools/market-ops.ts` | `set_stock_level`, `set_production_rate`, `set_capacity`, `rebalance_consumption` |
| `worker-mcp/src/tools/trade-routes.ts` | `query_routes`, `create_route`, `update_route`, `delete_route` |
| `worker-mcp/src/tools/disruptions.ts` | `trigger_disruption`, `list_disruptions`, `cancel_disruption`, `get_event_log` |
| `worker-mcp/src/tools/forecast.ts` | `forecast_economy`, `diagnose_commodity`, `crosscheck_r2`, `query_history` |
| `worker-mcp/src/tools/database.ts` | `query_db`, `mutate_db`, `describe_schema` |
| `worker-mcp/src/tools/r2-storage.ts` | `list_r2`, `read_r2`, `write_r2`, `delete_r2` |
| `worker-mcp/src/tools/ship-forge.ts` | `list_ships`, `inspect_ship`, `delete_ship` |
| `worker-mcp/src/tools/social.ts` | `read_chat`, `send_chat`, `read_board`, `post_board` |
| `worker-mcp/src/tools/infra.ts` | `check_health`, `get_tick_log`, `warmup_economy`, `seed_data` |
| `worker-mcp/wrangler.toml` | Worker configuration -- DO bindings, R2 buckets, service bindings, variables |

---

## Related Docs

- **[architecture.md](./architecture.md)** -- Big picture, how all the pieces fit together
- **[backend-guide.md](./backend-guide.md)** -- Game worker, Durable Objects, and the chat system
- **[economy-engine.md](./economy-engine.md)** -- How the economy tick engine works (the system the MCP tools control)
- **[npc-economy.md](./npc-economy.md)** -- NPC trade simulation, route mechanics, and market dynamics
- **[forge-guide.md](./forge-guide.md)** -- Ship Forge pipeline: AI generation, catalog, and community ships
- **[recipes.md](./recipes.md)** -- Step-by-step recipes including how to add a new MCP tool
- **[cloudflare-setup.md](./cloudflare-setup.md)** -- Deployment configuration, wrangler.toml, secrets, and environment variables
