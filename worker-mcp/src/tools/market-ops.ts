/**
 * Market Operations Tools — All return { ok, message }
 *
 * set_stock_level, set_production_rate, set_capacity, rebalance_consumption
 * (get_market_prices RETIRED — use query_economy)
 */

import type { Env } from "../types";
import { Logger } from "../logger";
import { callEconomyDO } from "./api-client";

export async function handleMarketOps(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "set_stock_level":
      return setStockLevel(args, env, logger);
    case "set_production_rate":
      return setProductionRate(args, env, logger);
    case "set_capacity":
      return setCapacity(args, env, logger);
    case "rebalance_consumption":
      return rebalanceConsumption(env, logger);
    default:
      throw new Error(`Unknown market-ops tool: ${toolName}`);
  }
}

async function setStockLevel(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const planet = (args.planet as string || "").toLowerCase();
  const commodity = (args.commodity as string || "").toLowerCase();
  const quantity = args.quantity as number;

  if (!planet || !commodity || quantity === undefined) {
    throw new Error("'planet', 'commodity', and 'quantity' are all required");
  }

  logger.tool("set_stock_level", `${commodity}@${planet} -> ${quantity}`);

  const result = await callEconomyDO(env, "/set-stock", {
    method: "POST",
    body: { planetId: planet, commodityId: commodity, quantity },
  }) as Record<string, unknown>;

  const before = result.before as number | undefined;
  const price = result.price as number | undefined;

  let message = `Stock for ${commodity} on ${planet} set to ${quantity}.`;
  if (before !== undefined) message = `Stock for ${commodity} on ${planet}: ${Math.round(before)} -> ${quantity}.`;
  if (price !== undefined) message += ` Price now ${Math.round(price * 100) / 100}cr.`;

  return { ok: true, message };
}

async function setProductionRate(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const planet = (args.planet as string || "").toLowerCase();
  const commodity = (args.commodity as string || "").toLowerCase();
  const production = args.production as number | undefined;
  const consumption = args.consumption as number | undefined;

  if (!planet || !commodity) throw new Error("'planet' and 'commodity' are required");
  if (production === undefined && consumption === undefined) {
    throw new Error("At least one of 'production' or 'consumption' must be provided");
  }

  logger.tool("set_production_rate", `${commodity}@${planet} prod=${production} cons=${consumption}`);

  await callEconomyDO(env, "/set-rates", {
    method: "POST",
    body: { planetId: planet, commodityId: commodity, production, consumption },
  });

  const changes: string[] = [];
  if (production !== undefined) changes.push(`production=${production}`);
  if (consumption !== undefined) changes.push(`consumption=${consumption}`);

  return { ok: true, message: `Rates for ${commodity} on ${planet} updated: ${changes.join(", ")}.` };
}

async function setCapacity(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const planet = (args.planet as string || "").toLowerCase();
  const commodity = (args.commodity as string || "").toLowerCase();
  const capacity = args.capacity as number;

  if (!planet || !commodity || !capacity) throw new Error("'planet', 'commodity', and 'capacity' are all required");

  logger.tool("set_capacity", `${commodity}@${planet} capacity=${capacity}`);

  await callEconomyDO(env, "/set-capacity", {
    method: "POST",
    body: { planetId: planet, commodityId: commodity, capacity },
  });

  return { ok: true, message: `Capacity for ${commodity} on ${planet} set to ${capacity}.` };
}

async function rebalanceConsumption(env: Env, logger: Logger): Promise<unknown> {
  logger.tool("rebalance_consumption", "Applying tiered consumption rates");

  const result = await callEconomyDO(env, "/rebalance-consumption", { method: "POST" }) as Record<string, unknown>;
  const updated = result.updated as number | undefined;

  return {
    ok: true,
    message: `Consumption rates rebalanced.${updated ? ` ${updated} rates adjusted.` : ""} Tech/luxury zeroed, basic goods 0.3-0.5/tick.`,
  };
}
