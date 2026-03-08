/**
 * Trade Route Tools — Analytical + Action
 *
 * query_routes:  Analytical query with scope/sort/limit
 * create_route:  Action → { ok, message }
 * update_route:  Action → { ok, message }
 * delete_route:  Action → { ok, message }
 */

import type { Env, AdminRegionDetail } from "../types";
import { Logger } from "../logger";
import { callEconomyDO } from "./api-client";

export async function handleTradeRoutes(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "query_routes":
      return queryRoutes(args, env, logger);
    case "create_route":
      return createRoute(args, env, logger);
    case "update_route":
      return updateRoute(args, env, logger);
    case "delete_route":
      return deleteRoute(args, env, logger);
    default:
      throw new Error(`Unknown trade-routes tool: ${toolName}`);
  }
}

// ── query_routes ──

async function queryRoutes(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const commodityFilter = args.commodity as string | undefined;
  const planetFilter = args.planet as string | undefined;
  const activeFilter = args.active as boolean | undefined;
  const enabledFilter = args.enabled as boolean | undefined;
  const sortField = (args.sort as string) || "-margin";
  const limit = Math.min(Math.max(1, (args.limit as number) || 10), 100);

  logger.tool("query_routes", `commodity=${commodityFilter || "all"} planet=${planetFilter || "all"} limit=${limit}`);

  const region = (await callEconomyDO(env, "/state")) as AdminRegionDetail;

  let routes = region.routes;

  if (commodityFilter) {
    routes = routes.filter((r) => r.commodityId === commodityFilter.toLowerCase());
  }
  if (planetFilter) {
    const p = planetFilter.toLowerCase();
    routes = routes.filter((r) => r.sourcePlanet === p || r.destPlanet === p);
  }
  if (activeFilter !== undefined) {
    routes = routes.filter((r) => r.inTransit === activeFilter);
  }
  if (enabledFilter !== undefined) {
    routes = routes.filter((r) => r.enabled === enabledFilter);
  }

  // Enrich with margin
  const enriched = routes.map((r) => {
    const srcCommodity = region.planets.find((p) => p.planetId === r.sourcePlanet)
      ?.commodities.find((c) => c.commodityId === r.commodityId);
    const dstCommodity = region.planets.find((p) => p.planetId === r.destPlanet)
      ?.commodities.find((c) => c.commodityId === r.commodityId);

    const srcPrice = srcCommodity?.currentPrice || 0;
    const dstPrice = dstCommodity?.currentPrice || 0;
    const margin = srcPrice > 0 ? Math.round(((dstPrice - srcPrice) / srcPrice) * 100) : 0;

    return {
      id: r.id,
      commodity: srcCommodity?.name || r.commodityId,
      from: r.sourcePlanet,
      to: r.destPlanet,
      margin,
      volume: r.volumePerTrip,
      tripMin: Math.round(r.tripDurationMs / 60000),
      enabled: r.enabled,
      inTransit: r.inTransit,
    };
  });

  // Sort
  const desc = sortField.startsWith("-");
  const field = desc ? sortField.slice(1) : sortField;
  enriched.sort((a, b) => {
    const av = (a as any)[field] ?? 0;
    const bv = (b as any)[field] ?? 0;
    return desc ? bv - av : av - bv;
  });

  const result = enriched.slice(0, limit);
  const enabledCount = enriched.filter((r) => r.enabled).length;
  const inTransitCount = enriched.filter((r) => r.inTransit).length;
  const summary = `${enriched.length} routes (${enabledCount} enabled, ${inTransitCount} in transit). Top margin: ${result[0]?.margin || 0}%.`;

  // Contextual hint
  let hint: string | undefined;
  const negativeMargin = result.filter((r) => r.margin < 0);
  if (negativeMargin.length > 0) {
    hint = `${negativeMargin.length} route(s) have negative margin — hauling goods at a loss. This suppresses prices at the destination. Consider pausing or deleting them.`;
  } else if (commodityFilter && result.length === 0) {
    hint = `No routes exist for this commodity. Supply depends entirely on local production. Use create_route to add trade capacity.`;
  } else if (planetFilter) {
    const inbound = result.filter((r) => r.to === planetFilter.toLowerCase());
    const outbound = result.filter((r) => r.from === planetFilter.toLowerCase());
    if (inbound.length === 0 && outbound.length > 0) {
      hint = `This planet only exports — no inbound routes. If any commodity is draining, it has no route-based resupply.`;
    } else if (outbound.length === 0 && inbound.length > 0) {
      hint = `This planet only imports — no outbound routes. Surplus commodities have no trade outlet.`;
    }
  }

  const out: Record<string, unknown> = { summary, routes: result };
  if (hint) out.hint = hint;
  return out;
}

// ── Action tools: all return { ok, message } ──

async function createRoute(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const commodity = (args.commodity as string || "").toLowerCase();
  const sourcePlanet = (args.sourcePlanet as string || "").toLowerCase();
  const destPlanet = (args.destPlanet as string || "").toLowerCase();
  const volumePerTrip = (args.volumePerTrip as number) || 30;
  const tripDurationMin = (args.tripDurationMin as number) || 60;

  if (!commodity || !sourcePlanet || !destPlanet) {
    throw new Error("'commodity', 'sourcePlanet', and 'destPlanet' are required");
  }

  logger.tool("create_route", `${commodity}: ${sourcePlanet} -> ${destPlanet}`);

  await callEconomyDO(env, "/create-route", {
    method: "POST",
    body: {
      commodityId: commodity,
      sourcePlanet,
      destPlanet,
      volumePerTrip,
      tripDurationMs: tripDurationMin * 60000,
    },
  });

  return {
    ok: true,
    message: `Route created: ${commodity} from ${sourcePlanet} to ${destPlanet} (${volumePerTrip}u/trip, ${tripDurationMin}min cycle).`,
  };
}

async function updateRoute(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const routeId = args.routeId as string;
  if (!routeId) throw new Error("'routeId' is required");

  const updates: Record<string, unknown> = {};
  const changes: string[] = [];

  if (args.volumePerTrip !== undefined) {
    updates.volumePerTrip = args.volumePerTrip;
    changes.push(`volume=${args.volumePerTrip}`);
  }
  if (args.tripDurationMin !== undefined) {
    updates.tripDurationMs = (args.tripDurationMin as number) * 60000;
    changes.push(`trip=${args.tripDurationMin}min`);
  }
  if (args.active !== undefined) {
    updates.enabled = args.active;
    changes.push(args.active ? "resumed" : "paused");
  }

  logger.tool("update_route", `${routeId}: ${changes.join(", ")}`);

  await callEconomyDO(env, `/route/${routeId}`, {
    method: "PATCH",
    body: updates,
  });

  return {
    ok: true,
    message: `Route ${routeId} updated: ${changes.join(", ")}.`,
  };
}

async function deleteRoute(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const routeId = args.routeId as string;
  if (!routeId) throw new Error("'routeId' is required");

  logger.tool("delete_route", routeId);

  await callEconomyDO(env, `/route/${routeId}`, { method: "DELETE" });

  return {
    ok: true,
    message: `Route ${routeId} deleted.`,
  };
}
