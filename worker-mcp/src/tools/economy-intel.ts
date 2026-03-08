/**
 * Economy Intelligence Tools — Analytical Query Architecture
 *
 * query_economy:     Pivot/filter/aggregate across all planets x commodities
 * inspect_commodity: Narrative-first deep dive into one commodity at one planet
 * find_arbitrage:    Ranked trade opportunities with margin analysis
 */

import type { Env, AdminRegionDetail, AdminCommodityState, HealthStatus } from "../types";
import { Logger } from "../logger";
import { callEconomyDO } from "./api-client";

// ── Health classification (reused across tools) ──

function classifyHealth(commodity: AdminCommodityState, disruptions: { commodityId?: string; type: string }[]): HealthStatus {
  const hasDisruption = disruptions.some(
    (d) => d.commodityId === commodity.commodityId || !d.commodityId
  );
  if (commodity.quantity === 0 || commodity.fillRatio < 0.005) return "halted";
  if (commodity.fillRatio < 0.15 || (commodity.fillRatio < 0.20 && hasDisruption)) return "critical";
  if (commodity.fillRatio < 0.30 || commodity.fillRatio > 0.85) return "strained";
  return "healthy";
}

const HEALTH_ORDER: Record<HealthStatus, number> = { halted: 0, critical: 1, strained: 2, healthy: 3 };

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Handlers ──

export async function handleEconomyIntel(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "query_economy":
      return queryEconomy(args, env, logger);
    case "inspect_commodity":
      return inspectCommodity(args, env, logger);
    case "find_arbitrage":
      return findArbitrage(args, env, logger);
    default:
      throw new Error(`Unknown economy-intel tool: ${toolName}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// query_economy — The flagship analytical tool
// ══════════════════════════════════════════════════════════════════════════════

interface FlatRow {
  planet: string;
  planetId: string;
  commodity: string;
  commodityId: string;
  category: string;
  price: number;
  fill: number;
  prod: number;
  cons: number;
  net: number;
  price_ratio: number;
  change_24h: number;
  health: HealthStatus;
}

async function queryEconomy(
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  // Parse params
  const scopePlanet = (args.planet as string)?.toLowerCase();
  const scopeCommodity = (args.commodity as string)?.toLowerCase();
  const scopeCategory = args.category as string | undefined;
  const scopeHealth = args.health as HealthStatus | undefined;
  const groupBy = args.groupBy as "planet" | "commodity" | "category" | undefined;
  const aggregate = (args.aggregate as string) || "detail";
  const sortField = (args.sort as string) || (scopeHealth ? "-price_ratio" : "-health");
  const limit = Math.min(Math.max(1, (args.limit as number) || 10), 100);

  logger.tool("query_economy", `scope=${scopePlanet || "all"}/${scopeCommodity || "all"} groupBy=${groupBy || "none"} agg=${aggregate}`);

  const region = (await callEconomyDO(env, "/state")) as AdminRegionDetail;

  // Step 1: Flatten all planet x commodity into rows
  const allRows: FlatRow[] = [];
  for (const planet of region.planets) {
    if (scopePlanet && planet.planetId !== scopePlanet) continue;

    const disruptions = region.disruptions.filter((d) => d.planetId === planet.planetId);

    for (const c of planet.commodities) {
      if (scopeCommodity && c.commodityId !== scopeCommodity) continue;
      if (scopeCategory && c.category !== scopeCategory) continue;

      const health = classifyHealth(c, disruptions);
      if (scopeHealth && health !== scopeHealth) continue;

      allRows.push({
        planet: planet.name,
        planetId: planet.planetId,
        commodity: c.name,
        commodityId: c.commodityId,
        category: c.category,
        price: r2(c.currentPrice),
        fill: r2(c.fillRatio),
        prod: r2(c.production),
        cons: r2(c.consumption),
        net: r2(c.production - c.consumption),
        price_ratio: r2(c.currentPrice / c.basePrice),
        change_24h: r2(c.priceChange24h),
        health,
      });
    }
  }

  // Step 2: If aggregate=summary with groupBy, return aggregated view
  if (groupBy && aggregate === "summary") {
    return buildSummaryResponse(allRows, groupBy, sortField, limit, allRows);
  }

  // Step 3: Sort
  const desc = sortField.startsWith("-");
  const field = desc ? sortField.slice(1) : sortField;
  allRows.sort((a, b) => {
    let av: number, bv: number;
    if (field === "health") {
      av = HEALTH_ORDER[a.health];
      bv = HEALTH_ORDER[b.health];
    } else {
      av = (a as any)[field] ?? 0;
      bv = (b as any)[field] ?? 0;
    }
    return desc ? av - bv : bv - av;
  });

  // Step 4: Limit and project — only include fields that carry signal
  const rows = allRows.slice(0, limit).map((r) => {
    const out: Record<string, unknown> = {};
    if (!scopePlanet) out.planet = r.planet;
    if (!scopeCommodity) out.commodity = r.commodity;
    if (!scopeCategory && !scopeCommodity) out.category = r.category;
    out.price = r.price;
    out.fill = r.fill;
    out.prod = r.prod;
    out.cons = r.cons;
    out.net = r.net;
    out.health = r.health;
    if (r.price_ratio > 1.5 || r.price_ratio < 0.5) out.price_ratio = r.price_ratio;
    if (Math.abs(r.change_24h) > 5) out.change_24h = r.change_24h;
    return out;
  });

  // Step 5: Generate summary
  const summary = buildDetailSummary(allRows, rows.length, scopePlanet, scopeCommodity, scopeCategory, scopeHealth);

  // Step 6: Contextual hint
  const hint = buildQueryHint(allRows, rows.length, aggregate, groupBy, scopePlanet, scopeCommodity);

  const result: Record<string, unknown> = { summary, rows };
  if (hint) result.hint = hint;
  return result;
}

function buildDetailSummary(
  allRows: FlatRow[],
  showing: number,
  planet?: string,
  commodity?: string,
  category?: string,
  health?: string,
): string {
  const total = allRows.length;
  const parts: string[] = [];

  const halted = allRows.filter((r) => r.health === "halted").length;
  const critical = allRows.filter((r) => r.health === "critical").length;
  const strained = allRows.filter((r) => r.health === "strained").length;

  // Context
  if (commodity) {
    parts.push(`${allRows[0]?.commodity || commodity} across ${total} planet(s).`);
  } else if (planet) {
    parts.push(`${allRows[0]?.planet || planet}: ${total} commodities.`);
  } else if (category) {
    parts.push(`${category}: ${total} entries across all planets.`);
  } else {
    parts.push(`System: ${total} commodity-planet pairs.`);
  }

  // Health status
  if (halted > 0 || critical > 0) {
    const alerts: string[] = [];
    if (halted > 0) alerts.push(`${halted} halted`);
    if (critical > 0) alerts.push(`${critical} critical`);
    if (strained > 0) alerts.push(`${strained} strained`);
    parts.push(alerts.join(", ") + ".");
  } else if (health === undefined) {
    parts.push("All healthy.");
  }

  // Avg fill
  if (allRows.length > 0) {
    const avgFill = allRows.reduce((s, r) => s + r.fill, 0) / allRows.length;
    parts.push(`Avg fill ${Math.round(avgFill * 100)}%.`);
  }

  if (showing < total) {
    parts.push(`Showing ${showing}/${total}.`);
  }

  return parts.join(" ");
}

function buildQueryHint(
  allRows: FlatRow[],
  showing: number,
  aggregate: string,
  groupBy?: string,
  scopePlanet?: string,
  scopeCommodity?: string,
): string | null {
  const halted = allRows.filter((r) => r.health === "halted");
  const critical = allRows.filter((r) => r.health === "critical");
  const sick = [...halted, ...critical];

  // Truncated results hide crises
  if (showing < allRows.length && sick.length > 0) {
    const unseen = sick.filter((_, i) => i >= showing);
    if (unseen.length > 0) {
      return `${unseen.length} critical/halted commodity(ies) not shown. Increase limit or filter by health: "critical" to see them.`;
    }
  }

  // Summary aggregate masks individual crises
  if (aggregate === "summary" && groupBy && sick.length > 0) {
    const avgFill = allRows.reduce((s, r) => s + r.fill, 0) / allRows.length;
    const minFill = Math.min(...allRows.map((r) => r.fill));
    if (avgFill > 0.3 && minFill < 0.05) {
      return `Average fill (${Math.round(avgFill * 100)}%) masks ${sick.length} commodity(ies) at near-zero stock. Drill down with health: "critical" for detail.`;
    }
  }

  // Cross-planet comparison: explain supply chain
  if (scopeCommodity && !scopePlanet && allRows.length > 1) {
    const producers = allRows.filter((r) => r.net > 1);
    const consumers = allRows.filter((r) => r.net < -1);
    if (producers.length > 0 && consumers.length > 0) {
      return `${producers.map((r) => r.planet).join(", ")} produce${producers.length === 1 ? "s" : ""} surplus; ${consumers.map((r) => r.planet).join(", ")} consume${consumers.length === 1 ? "s" : ""} it. Use query_routes to check if trade lanes exist between them.`;
    }
  }

  // Planet scan: flag if consumption dominates across the board
  if (scopePlanet && !scopeCommodity) {
    const drainingCount = allRows.filter((r) => r.net < -0.5).length;
    if (drainingCount > allRows.length * 0.6) {
      return `${drainingCount}/${allRows.length} commodities have negative net flow on this planet. Check if trade routes supply the deficit — use query_routes with planet filter.`;
    }
  }

  return null;
}

function buildSummaryResponse(
  allRows: FlatRow[],
  groupBy: "planet" | "commodity" | "category",
  sortField: string,
  limit: number,
  unfilteredRows: FlatRow[],
): { summary: string; rows: unknown[]; hint?: string } {
  // Group rows
  const groups = new Map<string, FlatRow[]>();
  for (const row of allRows) {
    const key = groupBy === "planet" ? row.planet
      : groupBy === "commodity" ? row.commodity
      : row.category;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Aggregate each group
  const aggRows: Record<string, unknown>[] = [];
  for (const [key, rows] of groups) {
    const fills = rows.map((r) => r.fill);
    const prices = rows.map((r) => r.price);

    aggRows.push({
      [groupBy]: key,
      count: rows.length,
      avg_fill: r2(fills.reduce((s, f) => s + f, 0) / fills.length),
      min_fill: r2(Math.min(...fills)),
      max_fill: r2(Math.max(...fills)),
      avg_price: r2(prices.reduce((s, p) => s + p, 0) / prices.length),
      halted: rows.filter((r) => r.health === "halted").length,
      critical: rows.filter((r) => r.health === "critical").length,
      strained: rows.filter((r) => r.health === "strained").length,
      healthy: rows.filter((r) => r.health === "healthy").length,
    });
  }

  // Sort
  const desc = sortField.startsWith("-");
  const field = desc ? sortField.slice(1) : sortField;
  aggRows.sort((a, b) => {
    const av = (a[field] as number) ?? 0;
    const bv = (b[field] as number) ?? 0;
    return desc ? bv - av : av - bv;
  });

  const healthyGroups = aggRows.filter((r) => (r.critical as number) === 0 && (r.halted as number) === 0).length;
  const summary = `${healthyGroups}/${aggRows.length} ${groupBy}(s) healthy. ${allRows.length} total entries.`;

  // Contextual hint for summary mode
  const hint = buildQueryHint(unfilteredRows, aggRows.length, "summary", groupBy);
  const result: { summary: string; rows: unknown[]; hint?: string } = { summary, rows: aggRows.slice(0, limit) };
  if (hint) result.hint = hint;
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// inspect_commodity — Narrative-first deep dive
// ══════════════════════════════════════════════════════════════════════════════

async function inspectCommodity(
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  const commodityId = (args.commodity as string || "").toLowerCase();
  const planetId = (args.planet as string || "").toLowerCase();

  if (!commodityId || !planetId) {
    throw new Error("Both 'commodity' and 'planet' are required");
  }

  logger.tool("inspect_commodity", `${commodityId} @ ${planetId}`);

  const region = (await callEconomyDO(env, "/state")) as AdminRegionDetail;

  const planet = region.planets.find((p) => p.planetId === planetId);
  if (!planet) throw new Error(`Planet not found: ${planetId}`);

  const commodity = planet.commodities.find((c) => c.commodityId === commodityId);
  if (!commodity) throw new Error(`Commodity not found: ${commodityId} on ${planetId}`);

  const disruptions = region.disruptions.filter(
    (d) => d.planetId === planetId && (!d.commodityId || d.commodityId === commodityId)
  );
  const health = classifyHealth(commodity, disruptions);
  const net = r2(commodity.production - commodity.consumption);

  // Routes
  const inbound = region.routes.filter(
    (r) => r.commodityId === commodityId && r.destPlanet === planetId
  );
  const outbound = region.routes.filter(
    (r) => r.commodityId === commodityId && r.sourcePlanet === planetId
  );

  // Build narrative summary
  const parts: string[] = [];
  parts.push(`${commodity.name} on ${planet.name}: ${health.toUpperCase()} at ${Math.round(commodity.fillRatio * 100)}% fill, ${r2(commodity.currentPrice)}cr.`);

  if (commodity.production > 0 || commodity.consumption > 0) {
    parts.push(`+${r2(commodity.production)} prod, -${r2(commodity.consumption)} cons (net ${net > 0 ? "+" : ""}${net}/tick).`);
  }

  if (inbound.length > 0) {
    parts.push(`${inbound.length} inbound route(s) from ${inbound.map((r) => r.sourcePlanet).join(", ")}.`);
  }
  if (outbound.length > 0) {
    parts.push(`${outbound.length} outbound route(s).`);
  }

  if (disruptions.length > 0) {
    parts.push(`Disruption: ${disruptions.map((d) => `${d.type} (${Math.round(d.remainingMs / 60000)}m left)`).join(", ")}.`);
  }

  // Best arbitrage opportunity
  const otherPrices = region.planets
    .filter((p) => p.planetId !== planetId)
    .map((p) => {
      const c = p.commodities.find((c) => c.commodityId === commodityId);
      return c ? { planet: p.name, price: c.currentPrice } : null;
    })
    .filter(Boolean) as { planet: string; price: number }[];

  if (otherPrices.length > 0) {
    const best = otherPrices.sort((a, b) => b.price - a.price)[0];
    const margin = r2(((best.price - commodity.currentPrice) / commodity.currentPrice) * 100);
    if (margin > 20) {
      parts.push(`Best arb: sell to ${best.planet} at ${r2(best.price)}cr (${margin}% margin).`);
    }
  }

  // Contextual hint
  let hint: string | undefined;
  if ((health === "critical" || health === "halted") && inbound.length === 0 && commodity.production === 0) {
    hint = "Zero supply — no production and no inbound routes. Create a route from a producing planet or set a production rate.";
  } else if (health === "healthy" && net < -1 && commodity.fillRatio > 0.5) {
    const ticksUntilCritical = Math.round((commodity.fillRatio - 0.15) * commodity.capacity / Math.abs(net));
    hint = `Draining at ${Math.abs(net)}/tick despite healthy fill. Will reach critical in ~${ticksUntilCritical} ticks without intervention.`;
  } else if (disruptions.length > 0 && disruptions[0].type === "production_halt") {
    const remaining = Math.round(disruptions[0].remainingMs / 60000);
    hint = `Production halted for ${remaining}m more. Use forecast_economy to see post-disruption trajectory.`;
  } else if (outbound.length > 0 && inbound.length === 0 && net < 0) {
    hint = `Exporting with no imports and negative net flow. Stock will drain — consider pausing outbound routes or adding inbound supply.`;
  }

  const result: Record<string, unknown> = {
    summary: parts.join(" "),
    state: {
      price: r2(commodity.currentPrice),
      fill: r2(commodity.fillRatio),
      prod: r2(commodity.production),
      cons: r2(commodity.consumption),
      net,
      health,
      price_ratio: r2(commodity.currentPrice / commodity.basePrice),
    },
    routes: { inbound: inbound.length, outbound: outbound.length },
    disruptions: disruptions.map((d) => ({
      type: d.type,
      remainingMin: Math.round(d.remainingMs / 60000),
      multiplier: d.multiplier,
    })),
  };
  if (hint) result.hint = hint;
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// find_arbitrage — Compact ranked opportunities
// ══════════════════════════════════════════════════════════════════════════════

async function findArbitrage(
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  const minMargin = (args.minMargin as number) || 10;
  const filterCommodity = args.commodity as string | undefined;
  const limit = Math.min((args.limit as number) || 20, 100);

  logger.tool("find_arbitrage", `min=${minMargin}%`);

  const region = (await callEconomyDO(env, "/state")) as AdminRegionDetail;

  const opportunities: unknown[] = [];
  const allCids = [...new Set(region.planets.flatMap((p) => p.commodities.map((c) => c.commodityId)))];

  for (const cid of allCids) {
    if (filterCommodity && cid !== filterCommodity.toLowerCase()) continue;

    const entries = region.planets
      .map((p) => {
        const c = p.commodities.find((c) => c.commodityId === cid);
        return c ? { planet: p, commodity: c } : null;
      })
      .filter(Boolean) as { planet: { name: string; planetId: string }; commodity: AdminCommodityState }[];

    if (entries.length < 2) continue;

    entries.sort((a, b) => a.commodity.currentPrice - b.commodity.currentPrice);
    const cheapest = entries[0];
    const dearest = entries[entries.length - 1];

    const margin = r2(((dearest.commodity.currentPrice - cheapest.commodity.currentPrice) / cheapest.commodity.currentPrice) * 100);
    if (margin < minMargin) continue;

    const npcRoutes = region.routes.filter(
      (r) => r.commodityId === cid && r.sourcePlanet === cheapest.planet.planetId && r.destPlanet === dearest.planet.planetId
    ).length;

    opportunities.push({
      commodity: cheapest.commodity.name,
      buy: cheapest.planet.name,
      buyPrice: r2(cheapest.commodity.currentPrice),
      sell: dearest.planet.name,
      sellPrice: r2(dearest.commodity.currentPrice),
      margin,
      profit: r2(dearest.commodity.currentPrice - cheapest.commodity.currentPrice),
      npcRoutes,
    });
  }

  opportunities.sort((a: any, b: any) => b.margin - a.margin);
  const result = opportunities.slice(0, limit);

  const top = result[0] as any;
  const summary = `${result.length} opportunities above ${minMargin}% margin.${top ? ` Top: ${top.commodity} ${top.buy}->${top.sell} at ${top.margin}%.` : ""}`;

  // Contextual hints
  let hint: string | undefined;
  const uncovered = result.filter((o: any) => o.npcRoutes === 0);
  if (uncovered.length > 0 && uncovered.length <= 3) {
    hint = `${uncovered.map((o: any) => o.commodity).join(", ")} ha${uncovered.length === 1 ? "s" : "ve"} no NPC routes — player-only opportunity. Margin may persist longer.`;
  } else if (uncovered.length > 3) {
    hint = `${uncovered.length} opportunities have no NPC competition. These are player-only — margins will persist until routes are created.`;
  }
  if (!hint) {
    // Check if buy-side is critically low
    const lowStock = result.filter((o: any) => {
      const buyPlanet = region.planets.find((p) => p.name === o.buy);
      const c = buyPlanet?.commodities.find((c) => c.name === o.commodity);
      return c && c.fillRatio < 0.15;
    });
    if (lowStock.length > 0) {
      hint = `Warning: ${lowStock.map((o: any) => `${o.commodity} on ${o.buy}`).join(", ")} below 15% fill. Buying will further drain stock — margins may collapse.`;
    }
  }

  const out: Record<string, unknown> = { summary, opportunities: result };
  if (hint) out.hint = hint;
  return out;
}
