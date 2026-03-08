/**
 * Forecast, Diagnosis & History Tools
 *
 * forecast_economy:   Forward simulation → crises + narrative (no recommendedActions)
 * diagnose_commodity: Root-cause analysis → narrative (no recommendedActions)
 * crosscheck_r2:      DO vs R2 divergence check
 * query_history:      OHLC-style price aggregation (replaces get_price_history)
 */

import type { Env, AdminRegionDetail, PriceHistoryPoint } from "../types";
import { Logger } from "../logger";
import { callEconomyDO, getR2Bucket } from "./api-client";

export async function handleForecast(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "forecast_economy":
      return forecastEconomy(args, env, logger);
    case "diagnose_commodity":
      return diagnoseCommodity(args, env, logger);
    case "crosscheck_r2":
      return crosscheckR2(args, env, logger);
    case "query_history":
      return queryHistory(args, env, logger);
    default:
      throw new Error(`Unknown forecast tool: ${toolName}`);
  }
}

// ── Sigmoid price calculation (mirrors worker/src/economy/pricing.ts) ──

function calcPrice(fillRatio: number, basePrice: number, minPrice: number, maxPrice: number, volatility: number): number {
  const fill = Math.max(0, Math.min(1, fillRatio));
  const k = 8 * volatility;
  const sigmoid = 1 / (1 + Math.exp(k * (fill - 0.5)));
  return Math.round((minPrice + (maxPrice - minPrice) * sigmoid) * 100) / 100;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── forecast_economy ──

async function forecastEconomy(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const hours = Math.min((args.hours as number) || 4, 24);
  const planetFilter = args.planet as string | undefined;
  const commodityFilter = args.commodity as string | undefined;
  const verbose = args.verbose === true;

  logger.tool("forecast_economy", `${hours}h ahead`);

  const region = (await callEconomyDO(env, "/state")) as AdminRegionDetail;

  const r2Obj = await getR2Bucket(env, "data").get("market/commodities.json");
  if (!r2Obj) throw new Error("Commodity catalog not found in R2. Run seed_data first.");
  const commodities = JSON.parse(await r2Obj.text()) as {
    commodities: { id: string; basePrice: number; minPrice: number; maxPrice: number; volatility: number }[];
  };
  const commodityMap = new Map(commodities.commodities.map((c) => [c.id, c]));

  // Clone state
  const simState = new Map<string, Map<string, { quantity: number; capacity: number; production: number; consumption: number }>>();
  for (const planet of region.planets) {
    const cs = new Map<string, { quantity: number; capacity: number; production: number; consumption: number }>();
    for (const c of planet.commodities) {
      cs.set(c.commodityId, { quantity: c.quantity, capacity: c.capacity, production: c.production, consumption: c.consumption });
    }
    simState.set(planet.planetId, cs);
  }

  const totalTicks = Math.floor(hours * 60);
  const sampleEvery = 10;
  const timeline: unknown[] = [];
  const crises: unknown[] = [];
  const seenCrises = new Set<string>();

  for (let tick = 1; tick <= totalTicks; tick++) {
    const tickTimeMs = Date.now() + tick * 60000;

    for (const [planetId, commodityStates] of simState) {
      for (const [cid, state] of commodityStates) {
        const disruption = region.disruptions.find(
          (d) => d.planetId === planetId && (!d.commodityId || d.commodityId === cid) && d.expiresAt > tickTimeMs
        );

        let prodMult = 1, consMult = 1;
        if (disruption) {
          if (disruption.type === "production_halt") prodMult = 0;
          else if (disruption.type === "production_boost") prodMult = disruption.multiplier || 2;
          else if (disruption.type === "demand_surge") consMult = disruption.multiplier || 2;
        }

        state.quantity = Math.min(state.capacity, state.quantity + state.production * prodMult);
        state.quantity = Math.max(0, state.quantity - state.consumption * consMult);

        const fill = state.quantity / state.capacity;
        const key = `${planetId}:${cid}`;
        if (fill < 0.05 && !seenCrises.has(`shortage:${key}`)) {
          seenCrises.add(`shortage:${key}`);
          crises.push({ planet: planetId, commodity: cid, type: "shortage", hoursUntil: r2(tick / 60) });
        }
        if (fill > 0.95 && !seenCrises.has(`overflow:${key}`)) {
          seenCrises.add(`overflow:${key}`);
          crises.push({ planet: planetId, commodity: cid, type: "overflow", hoursUntil: r2(tick / 60) });
        }
      }
    }

    // NPC trade (simplified)
    for (const route of region.routes) {
      if (!route.enabled) continue;
      const tripTicks = Math.round(route.tripDurationMs / 60000);
      if (tick % Math.round(tripTicks * 2.5) !== 0) continue;

      const srcState = simState.get(route.sourcePlanet)?.get(route.commodityId);
      const dstState = simState.get(route.destPlanet)?.get(route.commodityId);
      if (!srcState || !dstState) continue;
      if (srcState.quantity / srcState.capacity < 0.3) continue;

      const cDef = commodityMap.get(route.commodityId);
      if (!cDef) continue;
      const srcPrice = calcPrice(srcState.quantity / srcState.capacity, cDef.basePrice, cDef.minPrice, cDef.maxPrice, cDef.volatility);
      const dstPrice = calcPrice(dstState.quantity / dstState.capacity, cDef.basePrice, cDef.minPrice, cDef.maxPrice, cDef.volatility);
      if ((dstPrice - srcPrice) / srcPrice < 0.15) continue;

      const vol = Math.min(route.volumePerTrip, srcState.quantity);
      srcState.quantity -= vol;
      dstState.quantity = Math.min(dstState.capacity, dstState.quantity + vol);
    }

    // Timeline sampling (verbose only)
    if (verbose && tick % sampleEvery === 0) {
      const snapshot: Record<string, Record<string, { price: number; fill: number }>> = {};
      for (const [planetId, commodityStates] of simState) {
        if (planetFilter && planetId !== planetFilter.toLowerCase()) continue;
        snapshot[planetId] = {};
        for (const [cid, state] of commodityStates) {
          if (commodityFilter && cid !== commodityFilter.toLowerCase()) continue;
          const cDef = commodityMap.get(cid);
          const fill = state.quantity / state.capacity;
          snapshot[planetId][cid] = {
            price: cDef ? calcPrice(fill, cDef.basePrice, cDef.minPrice, cDef.maxPrice, cDef.volatility) : 0,
            fill: r2(fill),
          };
        }
      }
      timeline.push({ hoursAhead: r2(tick / 60), planets: snapshot });
    }
  }

  // Summary
  const urgent = crises.filter((c: any) => c.hoursUntil <= 1);
  let narrative = crises.length === 0
    ? `No crises predicted in the next ${hours} hours.`
    : `${crises.length} crisis point(s) in the next ${hours}h.${urgent.length > 0 ? ` ${urgent.length} within 1h.` : ""}`;

  const result: Record<string, unknown> = {
    summary: narrative,
    crises: crises.slice(0, 10),
  };

  if (verbose) {
    result.timeline = timeline.slice(0, 10);
  }

  // Contextual hint
  const shortages = crises.filter((c: any) => c.type === "shortage");
  const overflows = crises.filter((c: any) => c.type === "overflow");
  if (urgent.length >= 3) {
    result.hint = `${urgent.length} crises within 1h. Shortages need routes or stock injection (set_stock_level). Overflows need consumption increase or route creation to export surplus.`;
  } else if (crises.length === 0 && region.disruptions.length > 0) {
    const expiresInWindow = region.disruptions.filter((d) => d.expiresAt < Date.now() + hours * 3600000);
    if (expiresInWindow.length > 0) {
      result.hint = `No crises predicted, but ${expiresInWindow.length} disruption(s) expire during this window. Post-disruption rebound may cause price volatility — recheck after expiry.`;
    }
  } else if (shortages.length > 0 && overflows.length > 0) {
    result.hint = `Both shortages and overflows predicted. A trade route between surplus and deficit planets could solve both. Use find_arbitrage to identify the best pairs.`;
  }

  return result;
}

// ── diagnose_commodity ──

async function diagnoseCommodity(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const commodity = (args.commodity as string || "").toLowerCase();
  const planet = (args.planet as string || "").toLowerCase();
  const hours = (args.hours as number) || 24;

  if (!commodity || !planet) throw new Error("'commodity' and 'planet' are required");

  logger.tool("diagnose_commodity", `${commodity}@${planet} lookback=${hours}h`);

  const [region, history, events] = await Promise.all([
    callEconomyDO(env, "/state") as Promise<AdminRegionDetail>,
    callEconomyDO(env, "/history/enriched", { query: { planet, commodity, hours } }),
    callEconomyDO(env, "/trade-events", { query: { planet, commodity, hours } }),
  ]);

  const planetData = region.planets.find((p) => p.planetId === planet);
  const commodityData = planetData?.commodities.find((c) => c.commodityId === commodity);
  if (!commodityData) throw new Error(`${commodity} not found on ${planet}`);

  const disruptions = region.disruptions.filter(
    (d) => d.planetId === planet && (!d.commodityId || d.commodityId === commodity)
  );

  // Root causes
  const rootCauses: { cause: string; impact: string; severity: string }[] = [];

  for (const d of disruptions) {
    rootCauses.push({
      cause: `${d.type} disruption (${Math.round(d.remainingMs / 60000)}m remaining)`,
      impact: d.type === "production_halt" ? "Production at 0"
        : d.type === "demand_surge" ? `Consumption ${d.multiplier}x`
        : `Production ${d.multiplier}x`,
      severity: "primary",
    });
  }

  const netFlow = commodityData.production - commodityData.consumption;
  if (netFlow < -1) {
    rootCauses.push({
      cause: `Net flow ${r2(netFlow)}/tick (consumption > production)`,
      impact: `Draining ${Math.abs(r2(netFlow))} units/tick`,
      severity: disruptions.length > 0 ? "contributing" : "primary",
    });
  }

  const inboundRoutes = region.routes.filter((r) => r.commodityId === commodity && r.destPlanet === planet);
  if (inboundRoutes.length === 0 && commodityData.production === 0) {
    rootCauses.push({
      cause: "No production and no inbound routes",
      impact: "Zero supply — stock can only decrease",
      severity: "primary",
    });
  }

  // Price trajectory
  const historyPoints = (history as { points?: { price: number }[] })?.points || [];
  let priceChange: number | undefined;
  if (historyPoints.length > 1) {
    const oldest = historyPoints[0].price;
    const newest = historyPoints[historyPoints.length - 1].price;
    priceChange = oldest > 0 ? r2(((newest - oldest) / oldest) * 100) : undefined;
  }

  // Self-resolving?
  let selfResolving: string;
  if (disruptions.length > 0 && disruptions[0].type === "production_halt") {
    selfResolving = `Disruption expires in ${Math.round(disruptions[0].remainingMs / 60000)}m. Production will resume.`;
  } else if (netFlow > 0) {
    selfResolving = `Positive net flow (+${r2(netFlow)}/tick). Self-resolving.`;
  } else {
    selfResolving = "Not self-resolving. Intervention needed.";
  }

  // Contextual hint
  let hint: string | undefined;
  if (selfResolving.includes("Not self-resolving") && inboundRoutes.length === 0) {
    // Find which planets produce this commodity
    const producers = region.planets
      .filter((p) => p.planetId !== planet)
      .filter((p) => {
        const c = p.commodities.find((c) => c.commodityId === commodity);
        return c && c.production > c.consumption && c.fillRatio > 0.3;
      })
      .map((p) => p.name);
    if (producers.length > 0) {
      hint = `No inbound routes. ${producers.join(", ")} ha${producers.length === 1 ? "s" : "ve"} surplus — create a trade route to restore supply.`;
    } else {
      hint = "No inbound routes and no other planet has surplus. Set a production rate or inject stock directly.";
    }
  } else if (rootCauses.length > 1) {
    const primary = rootCauses.filter((r) => r.severity === "primary");
    if (primary.length === 1) {
      hint = `Multiple factors, but "${primary[0].cause}" is the primary driver. Fix that first.`;
    }
  }

  const result: Record<string, unknown> = {
    summary: `${commodityData.name} on ${planet}: ${rootCauses.length} root cause(s). ${selfResolving}`,
    state: {
      price: r2(commodityData.currentPrice),
      fill: r2(commodityData.fillRatio),
      prod: r2(commodityData.production),
      cons: r2(commodityData.consumption),
      net: r2(netFlow),
    },
    rootCauses,
    priceChange,
    selfResolving,
    recentEvents: ((events as { events?: unknown[] })?.events || []).slice(0, 5),
  };
  if (hint) result.hint = hint;
  return result;
}

// ── crosscheck_r2 ──

async function crosscheckR2(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const threshold = (args.threshold as number) || 5;

  logger.tool("crosscheck_r2", `threshold=${threshold}%`);

  const [region, r2Object] = await Promise.all([
    callEconomyDO(env, "/state") as Promise<AdminRegionDetail>,
    getR2Bucket(env, "data").get("market/regions/core-worlds.json"),
  ]);

  if (!r2Object) {
    return { summary: "No R2 snapshot exists. Run seed_data first.", divergences: [] };
  }

  const r2Data = JSON.parse(await r2Object.text()) as {
    tickNumber: number; updatedAt: string;
    planets: Record<string, { commodities: Record<string, { price: number; fillRatio: number }> }>;
  };

  const r2AgeMin = Math.round((Date.now() - new Date(r2Data.updatedAt).getTime()) / 60000);
  const divergences: unknown[] = [];

  for (const planet of region.planets) {
    const r2Planet = r2Data.planets[planet.planetId];
    if (!r2Planet) continue;
    for (const commodity of planet.commodities) {
      const r2c = r2Planet.commodities[commodity.commodityId];
      if (!r2c) continue;
      const pricePct = r2c.price > 0 ? Math.abs(commodity.currentPrice - r2c.price) / r2c.price * 100 : 0;
      const fillPP = Math.abs(commodity.fillRatio - r2c.fillRatio) * 100;
      if (pricePct > threshold || fillPP > threshold) {
        divergences.push({
          planet: planet.name, commodity: commodity.name,
          r2Price: r2(r2c.price), livePrice: r2(commodity.currentPrice), priceDiff: r2(pricePct),
          r2Fill: r2(r2c.fillRatio), liveFill: r2(commodity.fillRatio), fillDiff: r2(fillPP),
        });
      }
    }
  }

  return {
    summary: divergences.length === 0
      ? `R2 snapshot ${r2AgeMin}m old. No divergences above ${threshold}%.`
      : `R2 snapshot ${r2AgeMin}m old. ${divergences.length} divergence(s) above ${threshold}%.`,
    r2AgeMin,
    divergences,
  };
}

// ── query_history — OHLC-style aggregation ──

async function queryHistory(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const planet = (args.planet as string || "").toLowerCase();
  const commodity = (args.commodity as string || "").toLowerCase();
  const hours = Math.min((args.hours as number) || 24, 24);
  const aggregate = (args.aggregate as string) || "hourly";

  if (!planet || !commodity) throw new Error("'planet' and 'commodity' are required");

  logger.tool("query_history", `${commodity}@${planet} ${hours}h agg=${aggregate}`);

  const historyData = await callEconomyDO(env, "/history", {
    query: { planet, commodity, hours },
  });

  const points = (historyData as { points?: PriceHistoryPoint[] })?.points || [];

  if (points.length === 0) {
    return { summary: `No history for ${commodity} on ${planet}.`, periods: [] };
  }

  if (aggregate === "raw") {
    // Return raw but capped at 200 points
    const sampled = points.length > 200
      ? points.filter((_, i) => i % Math.ceil(points.length / 200) === 0)
      : points;
    return {
      summary: `${sampled.length} raw data points over ${hours}h.`,
      points: sampled.map((p) => ({ price: r2(p.price), fill: r2(p.fillRatio), ts: p.timestamp })),
    };
  }

  // Aggregate into periods
  const periodMs = aggregate === "daily" ? 86400000 : 3600000; // 1 day or 1 hour
  const buckets = new Map<number, PriceHistoryPoint[]>();

  for (const p of points) {
    const bucket = Math.floor(p.timestamp / periodMs) * periodMs;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket)!.push(p);
  }

  const periods: unknown[] = [];
  const sortedKeys = [...buckets.keys()].sort();

  for (const key of sortedKeys) {
    const bucket = buckets.get(key)!;
    const prices = bucket.map((p) => p.price);
    const fills = bucket.map((p) => p.fillRatio);

    periods.push({
      period: new Date(key).toISOString(),
      price: {
        open: r2(prices[0]),
        close: r2(prices[prices.length - 1]),
        high: r2(Math.max(...prices)),
        low: r2(Math.min(...prices)),
        avg: r2(prices.reduce((s, p) => s + p, 0) / prices.length),
      },
      fill: {
        open: r2(fills[0]),
        close: r2(fills[fills.length - 1]),
        high: r2(Math.max(...fills)),
        low: r2(Math.min(...fills)),
      },
    });
  }

  const firstPrice = (periods[0] as any)?.price?.open || 0;
  const lastPrice = (periods[periods.length - 1] as any)?.price?.close || 0;
  const change = firstPrice > 0 ? r2(((lastPrice - firstPrice) / firstPrice) * 100) : 0;

  // Contextual hint
  let hint: string | undefined;
  if (aggregate === "daily" && hours < 24) {
    hint = `Only ${hours}h of data bucketed into daily periods — OHLC spread is meaningless at this resolution. Use aggregate: "hourly" for short windows.`;
  } else if (aggregate === "daily" && periods.length === 1) {
    hint = `Only 1 daily bucket. Use aggregate: "hourly" for finer resolution, or increase hours for multi-day comparison.`;
  } else if (points.length < 10) {
    hint = `Only ${points.length} data points available — history may be sparse. Economy may need more ticks to build data.`;
  } else if (Math.abs(change) < 1 && periods.length > 6) {
    const fills = periods.map((p: any) => p.fill?.close || 0);
    const fillChange = Math.abs(fills[fills.length - 1] - fills[0]);
    if (fillChange > 0.15) {
      hint = `Price barely moved (${change}%) despite ${Math.round(fillChange * 100)}pp fill change. Price may be clamped at min or max — check price_ratio via inspect_commodity.`;
    }
  }

  const result: Record<string, unknown> = {
    summary: `${periods.length} ${aggregate} periods. Price ${firstPrice} -> ${lastPrice} (${change > 0 ? "+" : ""}${change}%).`,
    periods,
  };
  if (hint) result.hint = hint;
  return result;
}
