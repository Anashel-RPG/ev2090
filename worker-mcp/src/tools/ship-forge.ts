/**
 * Category 8: Ship Forge Tools
 *
 * list_ships, inspect_ship, delete_ship
 */

import type { Env } from "../types";
import { Logger } from "../logger";
import { callForgeDO } from "./api-client";

export async function handleShipForge(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  logger: Logger
): Promise<unknown> {
  switch (toolName) {
    case "list_ships":
      return listShips(args, env, logger);
    case "inspect_ship":
      return inspectShip(args, env, logger);
    case "delete_ship":
      return deleteShip(args, env, logger);
    default:
      throw new Error(`Unknown ship-forge tool: ${toolName}`);
  }
}

async function listShips(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const limit = Math.min((args.limit as number) || 20, 100);

  logger.tool("list_ships", `limit=${limit}`);

  const result = await callForgeDO(env, "/catalog");

  const ships = (result as { ships: unknown[] })?.ships || (result as unknown[]);
  const list = Array.isArray(ships) ? ships : [];

  return {
    ships: list.slice(0, limit),
  };
}

async function inspectShip(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const shipId = args.shipId as string;
  if (!shipId) throw new Error("'shipId' is required");

  logger.tool("inspect_ship", shipId);

  // The forge catalog contains all ships — find the one we want
  const result = await callForgeDO(env, "/catalog");
  const ships = (result as { ships: unknown[] })?.ships || (result as unknown[]);
  const list = Array.isArray(ships) ? ships : [];

  const ship = list.find((s: any) => s.id === shipId);
  if (!ship) throw new Error(`Ship not found: ${shipId}`);

  return ship;
}

async function deleteShip(args: Record<string, unknown>, env: Env, logger: Logger): Promise<unknown> {
  const shipId = args.shipId as string;
  if (!shipId) throw new Error("'shipId' is required");

  logger.tool("delete_ship", shipId);

  await callForgeDO(env, `/ship/${shipId}`, { method: "DELETE" });

  // Best-effort R2 asset cleanup
  try {
    const bucket = env.SHIP_MODELS;
    const listed = await bucket.list({ prefix: `ships/${shipId}/` });
    for (const obj of listed.objects) {
      await bucket.delete(obj.key);
    }
  } catch { /* R2 cleanup is best-effort */ }

  return { ok: true, message: `Ship ${shipId} and its R2 assets deleted.` };
}
