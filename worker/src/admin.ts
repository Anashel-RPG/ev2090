/**
 * Admin API route handler for EV 2090.
 * All routes require Authorization: Bearer <ADMIN_API_KEY>.
 */

import { COMMODITIES } from "./data/commodities";
import { REGIONS } from "./data/planet-economies";

interface Env {
  ECONOMY_REGION: DurableObjectNamespace;
  STATIC_DATA: R2Bucket;
  ADMIN_API_KEY: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Check admin auth. Returns a 401 Response if auth fails, null if OK.
 */
export function requireAdminAuth(request: Request, env: Env): Response | null {
  // No ADMIN_API_KEY configured = local dev mode. Allow all admin requests.
  if (!env.ADMIN_API_KEY) return null;

  const auth = request.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (token !== env.ADMIN_API_KEY) return json({ error: "Unauthorized" }, 403);

  return null;
}

/**
 * Route admin requests to the appropriate handler.
 */
export async function handleAdminRoute(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/admin/, "");

  // ── Commodity catalog ──

  if (path === "/commodities" && request.method === "GET") {
    return json({
      commodities: COMMODITIES,
      categories: [...new Set(COMMODITIES.map((c) => c.category))],
      updatedAt: new Date().toISOString(),
    });
  }

  // ── Economy regions ──

  if (path === "/economy/regions" && request.method === "GET") {
    const summaries = [];
    for (const region of REGIONS) {
      const id = env.ECONOMY_REGION.idFromName(region.regionId);
      const stub = env.ECONOMY_REGION.get(id);
      try {
        const res = await stub.fetch(
          new Request("https://internal/summary", { method: "GET" }),
        );
        summaries.push(await res.json());
      } catch {
        summaries.push({
          regionId: region.regionId,
          health: "red",
          planetCount: 0,
          commodityCount: 0,
          lastTickAt: 0,
          tickIntervalMs: 60000,
          tickNumber: 0,
          activeDisruptions: 0,
        });
      }
    }
    return json(summaries);
  }

  // ── Region detail ──

  const regionDetailMatch = path.match(
    /^\/economy\/region\/([a-z0-9-]+)$/,
  );
  if (regionDetailMatch && request.method === "GET") {
    const regionId = regionDetailMatch[1];
    return forwardToRegion(env, regionId, "/state", request);
  }

  // ── Region price history ──

  const historyMatch = path.match(
    /^\/economy\/region\/([a-z0-9-]+)\/history$/,
  );
  if (historyMatch && request.method === "GET") {
    const regionId = historyMatch[1];
    const doUrl = new URL("https://internal/history");
    doUrl.search = url.search; // forward planet, commodity, hours params
    return forwardToRegionUrl(env, regionId, doUrl.toString(), request);
  }

  // ── Enriched price history ──

  const enrichedHistoryMatch = path.match(
    /^\/economy\/region\/([a-z0-9-]+)\/history\/enriched$/,
  );
  if (enrichedHistoryMatch && request.method === "GET") {
    const regionId = enrichedHistoryMatch[1];
    const doUrl = new URL("https://internal/history/enriched");
    doUrl.search = url.search;
    return forwardToRegionUrl(env, regionId, doUrl.toString(), request);
  }

  // ── Trade events ──

  const tradeEventsMatch = path.match(
    /^\/economy\/region\/([a-z0-9-]+)\/trade-events$/,
  );
  if (tradeEventsMatch && request.method === "GET") {
    const regionId = tradeEventsMatch[1];
    const doUrl = new URL("https://internal/trade-events");
    doUrl.search = url.search;
    return forwardToRegionUrl(env, regionId, doUrl.toString(), request);
  }

  // ── Region tick stats ──

  const ticksMatch = path.match(
    /^\/economy\/region\/([a-z0-9-]+)\/ticks$/,
  );
  if (ticksMatch && request.method === "GET") {
    const regionId = ticksMatch[1];
    return forwardToRegion(env, regionId, "/tick-stats", request);
  }

  // ── Trigger disruption ──

  const disruptMatch = path.match(
    /^\/economy\/region\/([a-z0-9-]+)\/disrupt$/,
  );
  if (disruptMatch && request.method === "POST") {
    const regionId = disruptMatch[1];
    return forwardToRegion(env, regionId, "/disrupt", request);
  }

  // ── Trigger warmup ──

  const warmupMatch = path.match(
    /^\/economy\/region\/([a-z0-9-]+)\/warmup$/,
  );
  if (warmupMatch && request.method === "POST") {
    const regionId = warmupMatch[1];
    return forwardToRegion(env, regionId, "/warmup", request);
  }

  // ── Infra health ──

  if (path === "/infra/health" && request.method === "GET") {
    return handleInfraHealth(env);
  }

  // ── Deep diagnostics (full EconomyRegion observability) ──

  const diagMatch = path.match(
    /^\/economy\/region\/([a-z0-9-]+)\/diagnostics$/,
  );
  if (diagMatch && request.method === "GET") {
    const regionId = diagMatch[1];
    return forwardToRegion(env, regionId, "/diagnostics", request);
  }

  // ── Seed / reset ──
  // ?force=true  → always re-bootstrap the economy (used by npm run reset)
  // no param     → skip if already seeded (used by npm run dev auto-seed)

  if (path === "/seed" && request.method === "POST") {
    const force = url.searchParams.get("force") === "true";
    return handleAdminSeed(env, force);
  }

  return json({ error: "Not found" }, 404);
}

// ── Helpers ──

async function forwardToRegion(
  env: Env,
  regionId: string,
  doPath: string,
  request: Request,
): Promise<Response> {
  const id = env.ECONOMY_REGION.idFromName(regionId);
  const stub = env.ECONOMY_REGION.get(id);
  try {
    const res = await stub.fetch(
      new Request(`https://internal${doPath}`, {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" ? request.body : undefined,
      }),
    );
    return res;
  } catch (err) {
    console.error(`[Admin] Failed to reach region ${regionId}:`, err);
    return json({ error: "Service unavailable" }, 502);
  }
}

async function forwardToRegionUrl(
  env: Env,
  regionId: string,
  doUrl: string,
  request: Request,
): Promise<Response> {
  const id = env.ECONOMY_REGION.idFromName(regionId);
  const stub = env.ECONOMY_REGION.get(id);
  try {
    const res = await stub.fetch(
      new Request(doUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" ? request.body : undefined,
      }),
    );
    return res;
  } catch (err) {
    console.error(`[Admin] Failed to reach region ${regionId}:`, err);
    return json({ error: "Service unavailable" }, 502);
  }
}

async function handleInfraHealth(env: Env): Promise<Response> {
  // Check economy region health
  let economyHealth: unknown = {
    regionId: "core-worlds",
    lastTickAt: 0,
    tickHealth: "stopped",
    avgTickMs: 0,
    totalTicks: 0,
    warmupComplete: false,
  };

  try {
    const id = env.ECONOMY_REGION.idFromName("core-worlds");
    const stub = env.ECONOMY_REGION.get(id);
    const res = await stub.fetch(
      new Request("https://internal/tick-stats", { method: "GET" }),
    );
    const stats = (await res.json()) as {
      lastTickAt: number;
      avgTickDurationMs: number;
      totalTicks: number;
      warmupComplete: boolean;
    };

    const now = Date.now();
    const tickHealth =
      !stats.warmupComplete
        ? "stopped"
        : now - stats.lastTickAt > 180_000
          ? "stopped"
          : now - stats.lastTickAt > 120_000
            ? "delayed"
            : "ok";

    economyHealth = {
      regionId: "core-worlds",
      lastTickAt: stats.lastTickAt,
      tickHealth,
      avgTickMs: stats.avgTickDurationMs,
      totalTicks: stats.totalTicks,
      warmupComplete: stats.warmupComplete,
    };
  } catch {
    // DO not yet initialized
  }

  // R2 health — check if snapshot exists
  let r2Health = { lastWriteAt: 0, snapshotIntervalMs: 300_000 };
  try {
    const obj = await env.STATIC_DATA.head("market/regions/core-worlds.json");
    if (obj) {
      r2Health.lastWriteAt = obj.uploaded?.getTime() || 0;
    }
  } catch {
    // R2 bucket may not exist yet
  }

  return json({
    workerVersion: "2026-02-28.1",
    economy: economyHealth,
    r2: r2Health,
  });
}

export async function handleAdminSeed(env: Env, force = false): Promise<Response> {
  // 1. Write commodity catalog to R2
  const catalog = {
    commodities: COMMODITIES,
    categories: [...new Set(COMMODITIES.map((c) => c.category))],
    updatedAt: new Date().toISOString(),
  };

  await env.STATIC_DATA.put(
    "market/commodities.json",
    JSON.stringify(catalog),
    {
      httpMetadata: {
        contentType: "application/json",
        cacheControl: "public, max-age=3600",
      },
    },
  );

  // 2. Trigger economy warmup.
  // force=true: always re-bootstrap (used by npm run reset).
  // force=false: skip if already seeded (first-run auto-seed from npm run dev).
  const id = env.ECONOMY_REGION.idFromName("core-worlds");
  const stub = env.ECONOMY_REGION.get(id);
  const warmupUrl = force
    ? "https://internal/warmup?force=true"
    : "https://internal/warmup";
  const res = await stub.fetch(new Request(warmupUrl, { method: "POST" }));
  const warmupResult = await res.json();

  return json({
    ok: true,
    forced: force,
    commoditiesWritten: COMMODITIES.length,
    warmupResult,
  });
}
