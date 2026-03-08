/**
 * Market disruption generation and application.
 */

import type {
  CommodityStock,
  MarketDisruption,
  PlanetMarket,
} from "../types/economy";

/**
 * Generate a random disruption affecting a random planet/commodity.
 */
export function generateRandomDisruption(
  planets: PlanetMarket[],
  now: number,
): MarketDisruption | null {
  if (planets.length === 0) return null;

  const planet = planets[Math.floor(Math.random() * planets.length)];
  const commodityIds = Array.from(planet.inventory.keys());
  if (commodityIds.length === 0) return null;

  const commodityId =
    commodityIds[Math.floor(Math.random() * commodityIds.length)];
  const id = `disrupt-${now}-${Math.random().toString(36).slice(2, 8)}`;

  const types = [
    "production_halt",
    "production_boost",
    "demand_surge",
  ] as const;
  const type = types[Math.floor(Math.random() * types.length)];

  // Duration: 1-4 hours
  const durationMs = (1 + Math.random() * 3) * 3_600_000;

  switch (type) {
    case "production_halt":
      return {
        type: "production_halt",
        id,
        planetId: planet.planetId,
        commodityId,
        startedAt: now,
        expiresAt: now + durationMs,
      };
    case "production_boost":
      return {
        type: "production_boost",
        id,
        planetId: planet.planetId,
        commodityId,
        multiplier: 1.5 + Math.random() * 1.5, // 1.5x - 3x
        startedAt: now,
        expiresAt: now + durationMs,
      };
    case "demand_surge":
      return {
        type: "demand_surge",
        id,
        planetId: planet.planetId,
        commodityId,
        multiplier: 1.5 + Math.random() * 2, // 1.5x - 3.5x
        startedAt: now,
        expiresAt: now + durationMs,
      };
  }
}

/**
 * Apply active disruptions to modify production/consumption for one tick.
 * Returns the effective production and consumption multipliers.
 */
export function getDisruptionModifiers(
  disruptions: MarketDisruption[],
  planetId: string,
  commodityId: string,
): { productionMult: number; consumptionMult: number } {
  let productionMult = 1;
  let consumptionMult = 1;

  for (const d of disruptions) {
    if (d.planetId !== planetId) continue;
    if ("commodityId" in d && d.commodityId !== commodityId) continue;

    switch (d.type) {
      case "production_halt":
        productionMult = 0;
        break;
      case "production_boost":
        productionMult *= d.multiplier;
        break;
      case "demand_surge":
        consumptionMult *= d.multiplier;
        break;
    }
  }

  return { productionMult, consumptionMult };
}

/** Layer 1 tick-to-tick jitter: ±20% on production and consumption.
 *  Not a disruption — just reality. Factories don't consume at exactly
 *  the same rate every minute. Some ticks the furnace runs hot, some
 *  ticks a shift changes, some ticks a conveyor belt hiccups.
 *  This breaks the robotic metronome on single-route markets. */
const RATE_JITTER = 0.20;

/** Random multiplier in [1 - jitter, 1 + jitter] */
function rateJitter(): number {
  return 1 + (Math.random() * 2 - 1) * RATE_JITTER;
}

/**
 * Apply NPC economy with disruption modifiers and Layer 1 rate jitter.
 */
export function applyDisruptedEconomy(
  stock: CommodityStock,
  disruptions: MarketDisruption[],
  planetId: string,
  dt: number,
): void {
  const { productionMult, consumptionMult } = getDisruptionModifiers(
    disruptions,
    planetId,
    stock.commodityId,
  );

  // Production (with disruption modifier + tick jitter)
  if (stock.baseProduction > 0) {
    stock.quantity = Math.min(
      stock.capacity,
      stock.quantity + stock.baseProduction * productionMult * rateJitter() * dt,
    );
  }

  // Consumption (with disruption modifier + tick jitter)
  if (stock.baseConsumption > 0) {
    stock.quantity = Math.max(
      0,
      stock.quantity - stock.baseConsumption * consumptionMult * rateJitter() * dt,
    );
  }

  // NaN guard: if any upstream value was NaN, clamp to safe defaults
  if (Number.isNaN(stock.quantity) || !Number.isFinite(stock.quantity)) {
    stock.quantity = 0;
  }
  stock.fillRatio = stock.capacity > 0 ? stock.quantity / stock.capacity : 0;
  if (Number.isNaN(stock.fillRatio) || !Number.isFinite(stock.fillRatio)) {
    stock.fillRatio = 0;
  }
}
