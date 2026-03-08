/**
 * Disruption & Event Tools
 *
 * trigger_disruption: Action → { ok, message }
 * cancel_disruption:  Action → { ok, message }
 * list_disruptions:   Compact structured data (no narrative duplication)
 * get_event_log:      Pass-through with summary
 */

import type { Env, AdminRegionDetail } from "../types";
import { Logger } from "../logger";
import { callEconomyDO } from "./api-client";

export async function handleDisruptions(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "trigger_disruption":
      return triggerDisruption(args, env, logger);
    case "list_disruptions":
      return listDisruptions(args, env, logger);
    case "cancel_disruption":
      return cancelDisruption(args, env, logger);
    case "get_event_log":
      return getEventLog(args, env, logger);
    default:
      throw new Error(`Unknown disruptions tool: ${toolName}`);
  }
}

async function triggerDisruption(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const type = args.type as string;
  const planet = (args.planet as string || "").toLowerCase();
  const commodity = (args.commodity as string || "").toLowerCase();
  const multiplier = (args.multiplier as number) || 2.0;
  const durationHours = (args.durationHours as number) || 2;

  if (!type || !planet || !commodity) throw new Error("'type', 'planet', and 'commodity' are required");

  const validTypes = ["production_halt", "production_boost", "demand_surge"];
  if (!validTypes.includes(type)) throw new Error(`Invalid type. Must be one of: ${validTypes.join(", ")}`);

  logger.tool("trigger_disruption", `${type} ${commodity}@${planet} x${multiplier} for ${durationHours}h`);

  await callEconomyDO(env, "/disrupt", {
    method: "POST",
    body: { type, planetId: planet, commodityId: commodity, multiplier, durationMs: durationHours * 3600000 },
  });

  const impact = type === "production_halt"
    ? `Production of ${commodity} on ${planet} halted for ${durationHours}h. Price will rise.`
    : type === "production_boost"
    ? `Production of ${commodity} on ${planet} boosted ${multiplier}x for ${durationHours}h. Price will drop.`
    : `Consumption of ${commodity} on ${planet} surged ${multiplier}x for ${durationHours}h. Stock will drain.`;

  return { ok: true, message: impact };
}

async function listDisruptions(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const planetFilter = args.planet as string | undefined;

  logger.tool("list_disruptions", `planet=${planetFilter || "all"}`);

  const region = (await callEconomyDO(env, "/state")) as AdminRegionDetail;

  let disruptions = region.disruptions;
  if (planetFilter) {
    disruptions = disruptions.filter((d) => d.planetId === planetFilter.toLowerCase());
  }

  const summary = disruptions.length === 0
    ? "No active disruptions."
    : `${disruptions.length} active disruption(s).`;

  return {
    summary,
    disruptions: disruptions.map((d) => ({
      id: d.id,
      type: d.type,
      planet: d.planetId,
      commodity: d.commodityId || "all",
      multiplier: d.multiplier,
      remainingMin: Math.round(d.remainingMs / 60000),
    })),
  };
}

async function cancelDisruption(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const disruptionId = args.disruptionId as string;
  if (!disruptionId) throw new Error("'disruptionId' is required");

  logger.tool("cancel_disruption", disruptionId);

  await callEconomyDO(env, `/disruption/${disruptionId}`, { method: "DELETE" });

  return { ok: true, message: `Disruption ${disruptionId} cancelled. Market will normalize.` };
}

async function getEventLog(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const planet = args.planet as string | undefined;
  const commodity = args.commodity as string | undefined;
  const hours = (args.hours as number) || 24;
  const limit = Math.min((args.limit as number) || 50, 200);

  logger.tool("get_event_log", `planet=${planet || "all"} commodity=${commodity || "all"} hours=${hours}`);

  const result = await callEconomyDO(env, "/trade-events", {
    query: { planet: planet?.toLowerCase(), commodity: commodity?.toLowerCase(), hours },
  });

  const events = (result as { events: unknown[] })?.events || [];
  const sliced = events.slice(0, limit);

  return {
    summary: `${sliced.length} trade events in the last ${hours}h.`,
    events: sliced,
  };
}
