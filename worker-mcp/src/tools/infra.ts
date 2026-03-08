/**
 * Category 10: Infrastructure Tools
 *
 * check_health, get_tick_log, warmup_economy, seed_data
 */

import type { Env } from "../types";
import { Logger } from "../logger";
import { callEconomyDO, getR2Bucket } from "./api-client";

export async function handleInfra(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "check_health":
      return checkHealth(env, logger, args.includeRaw === true);
    case "get_tick_log":
      return getTickLog(args, env, logger);
    case "warmup_economy":
      return warmupEconomy(env, logger);
    case "seed_data":
      return seedData(env, logger);
    default:
      throw new Error(`Unknown infra tool: ${toolName}`);
  }
}

async function checkHealth(env: Env, logger: Logger, includeRaw = false): Promise<unknown> {
  logger.tool("check_health", "Running diagnostics");

  // Fetch economy tick stats, diagnostics, and R2 health in parallel
  const [tickStats, diagnostics, r2Head] = await Promise.all([
    callEconomyDO(env, "/tick-stats").catch((e) => ({ error: e.message })),
    callEconomyDO(env, "/diagnostics").catch((e) => ({ error: e.message })),
    getR2Bucket(env, "data").head("market/regions/core-worlds.json").catch((e) => null),
  ]);

  const t = tickStats as Record<string, unknown>;
  const d = diagnostics as Record<string, unknown>;

  // Determine overall status
  const anomalies = (d.anomalies as string[]) || [];
  const tickHealth = (d as any)?.tick?.alarmHealth || "unknown";
  const lastTickAge = (d as any)?.tick?.timeSinceLastTickMs;

  let overall: "healthy" | "degraded" | "critical" = "healthy";
  if (tickHealth === "stopped" || tickHealth === "missed") overall = "critical";
  else if (anomalies.length > 0 || tickHealth === "delayed") overall = "degraded";

  // Build narrative
  const parts: string[] = [];
  if (overall === "healthy") {
    parts.push("All systems nominal.");
  } else if (overall === "critical") {
    parts.push(`CRITICAL: Tick engine ${tickHealth}.`);
  } else {
    parts.push(`Degraded: ${anomalies.length} anomaly(ies) detected.`);
  }

  // Extract only essential perf metrics (strip the 60-entry trend array)
  const perf = d.tickPerformance as Record<string, unknown> || {};
  const { trend, ...essentialPerf } = perf;

  // Contextual hint
  let hint: string | undefined;
  if (overall === "critical" && (tickHealth === "stopped" || tickHealth === "missed")) {
    hint = "Tick engine is not running — economy is frozen. Call warmup_economy to restart it.";
  } else if (r2Head === null) {
    hint = "No R2 snapshot exists. Frontend will show stale/empty data. Run seed_data to initialize.";
  } else if (anomalies.length > 5) {
    hint = `${anomalies.length} anomalies detected. Use query_economy with health: "critical" to identify the worst commodities and prioritize fixes.`;
  } else if (lastTickAge && lastTickAge > 120000) {
    hint = `Last tick was ${Math.round(lastTickAge / 1000)}s ago (expected ~60s). Tick engine may be falling behind.`;
  }

  const result: Record<string, unknown> = {
    overall,
    workerVersion: env.WORKER_VERSION,
    economy: {
      tickHealth,
      lastTickAgeSeconds: lastTickAge ? Math.round(lastTickAge / 1000) : null,
      ...essentialPerf,
    },
    storage: d.storage || {},
    r2: {
      snapshotExists: r2Head !== null,
      ...(d.r2 as Record<string, unknown> || {}),
    },
    anomalies,
    summary: parts.join(" "),
  };

  if (hint) result.hint = hint;

  // Only include raw data when explicitly requested
  if (includeRaw) {
    result.raw = { tickStats: t, diagnostics: d };
  }

  return result;
}

async function getTickLog(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const count = Math.min((args.count as number) || 60, 1000);

  logger.tool("get_tick_log", `count=${count}`);

  const ticks = await callEconomyDO(env, "/tick-stats");
  return ticks;
}

async function warmupEconomy(env: Env, logger: Logger): Promise<unknown> {
  logger.tool("warmup_economy", "Triggering 24h warmup");

  await callEconomyDO(env, "/warmup", { method: "POST" });

  return { ok: true, message: "Economy bootstrapped with 1440 ticks (24h simulated history)." };
}

async function seedData(env: Env, logger: Logger): Promise<unknown> {
  logger.tool("seed_data", "Checking commodity catalog + warmup");

  const r2Head = await getR2Bucket(env, "data").head("market/commodities.json");
  if (!r2Head) {
    return { ok: false, message: "Commodity catalog not found in R2. Deploy the game worker and call /api/admin/seed first." };
  }

  await callEconomyDO(env, "/warmup", { method: "POST" });

  return { ok: true, message: "Commodity catalog found. Economy warmed up with 24h of simulated history." };
}
