/**
 * Pure pricing functions for EV 2090 economy.
 * No side effects — all state mutation happens in the DO.
 */

import type {
  CommodityDef,
  CommodityStock,
  PlanetMarket,
} from "../types/economy";

/**
 * Sigmoid price curve: fill ratio → price.
 *
 * fill = 0.0 (empty)  → price = maxPrice (high demand, no supply)
 * fill = 0.5 (half)   → price = basePrice (equilibrium)
 * fill = 1.0 (full)   → price = minPrice (oversupply)
 */
export function calculatePrice(
  commodity: CommodityDef,
  stock: CommodityStock,
): number {
  const fill = Math.max(0, Math.min(1, stock.fillRatio));
  const k = 8 * commodity.volatility;
  const sigmoid = 1 / (1 + Math.exp(k * (fill - 0.5)));
  const price =
    commodity.minPrice +
    (commodity.maxPrice - commodity.minPrice) * sigmoid;
  return Math.round(price * 100) / 100;
}

/**
 * Ornstein-Uhlenbeck mean reversion.
 * Drifts fill ratio back toward 0.5 (equilibrium) with noise.
 *
 * dx = theta * (mu - x) * dt + sigma * sqrt(dt) * N(0,1)
 */
export function applyMeanReversion(
  stock: CommodityStock,
  commodity: CommodityDef,
  dt: number,
): void {
  const theta = commodity.decayRate;
  const sigma = commodity.volatility * 0.005;
  const target = 0.5;

  const drift = theta * (target - stock.fillRatio) * dt;
  const noise = sigma * Math.sqrt(dt) * gaussianRandom();

  stock.quantity = Math.max(
    0,
    Math.min(
      stock.capacity,
      stock.quantity + (drift + noise) * stock.capacity,
    ),
  );
  stock.fillRatio = stock.quantity / stock.capacity;
}

/**
 * Apply NPC production and consumption for one tick.
 */
export function applyNpcEconomy(
  market: PlanetMarket,
  dt: number,
): void {
  for (const [, stock] of market.inventory) {
    // Production
    if (stock.baseProduction > 0) {
      stock.quantity = Math.min(
        stock.capacity,
        stock.quantity + stock.baseProduction * dt,
      );
    }
    // Consumption
    if (stock.baseConsumption > 0) {
      stock.quantity = Math.max(
        0,
        stock.quantity - stock.baseConsumption * dt,
      );
    }
    stock.fillRatio = stock.quantity / stock.capacity;
  }
}

/**
 * External solar system exports — passive drain when inventory overflows.
 * When fill > 80%, external trade convoys haul away surplus toward ~55%.
 * Drain rate scales with how far above 80% the stock is.
 */
export function applyExternalExports(
  market: PlanetMarket,
  dt: number,
): void {
  const EXPORT_THRESHOLD = 0.80;
  const TARGET_FILL = 0.55;
  const DRAIN_RATE = 0.05; // 5% of excess per tick

  for (const [, stock] of market.inventory) {
    if (stock.fillRatio > EXPORT_THRESHOLD) {
      const excess = stock.fillRatio - EXPORT_THRESHOLD;
      const drainAmount = excess * stock.capacity * DRAIN_RATE * dt;
      const targetQty = stock.capacity * TARGET_FILL;
      stock.quantity = Math.max(targetQty, stock.quantity - drainAmount);
      stock.fillRatio = stock.quantity / stock.capacity;
    }
  }
}

/**
 * Box-Muller transform for Gaussian random numbers.
 */
export function gaussianRandom(): number {
  let u1 = Math.random();
  let u2 = Math.random();
  // Avoid log(0)
  while (u1 === 0) u1 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
