/**
 * Client-side forecast engine.
 * Replicates the server-side sigmoid pricing + production/consumption
 * to project future state and detect upcoming crises.
 *
 * Pure math — no Three.js or React.
 */
import type {
  AdminPlanetMarketState,
  NpcTradeRoute,
  AdminDisruptionView,
  CommodityDef,
} from "../types";

// ── Sigmoid price curve (exact replica from worker/src/economy/pricing.ts) ──

function calculatePrice(
  _basePrice: number,
  minPrice: number,
  maxPrice: number,
  volatility: number,
  fillRatio: number,
): number {
  const fill = Math.max(0, Math.min(1, fillRatio));
  const k = 8 * volatility;
  const sigmoid = 1 / (1 + Math.exp(k * (fill - 0.5)));
  return Math.round((minPrice + (maxPrice - minPrice) * sigmoid) * 100) / 100;
}

// ── Types ──

export interface ForecastCommodityState {
  commodityId: string;
  fillRatio: number;
  projectedPrice: number;
  quantity: number;
  capacity: number;
  crisis: "shortage" | "overflow" | null;
}

export interface ForecastPoint {
  tickOffset: number;
  timestamp: number;
  planets: Map<string, Map<string, ForecastCommodityState>>;
}

export interface CrisisPoint {
  planetId: string;
  commodityId: string;
  type: "shortage" | "overflow";
  ticksUntil: number;
  hoursUntil: number;
}

export interface ForecastResult {
  timeline: ForecastPoint[];
  crisisPoints: CrisisPoint[];
  /** "planetId:commodityId" keys whose fill ratio changes by >2% during forecast */
  affectedCommodities: Set<string>;
}

// ── Internal simulation state ──

interface SimStock {
  commodityId: string;
  quantity: number;
  capacity: number;
  production: number;
  consumption: number;
  fillRatio: number;
}

interface SimPlanet {
  planetId: string;
  stocks: Map<string, SimStock>;
}

export function runForecast(
  planets: AdminPlanetMarketState[],
  routes: NpcTradeRoute[],
  disruptions: AdminDisruptionView[],
  commodityDefs: CommodityDef[],
  forecastHours: number,
): ForecastResult {
  const now = Date.now();
  const tickIntervalMs = 60_000; // 1 tick = 1 min
  const totalTicks = Math.round(forecastHours * 60);
  const sampleInterval = 10; // sample every 10 ticks

  // Build commodity def lookup
  const comMap = new Map<string, CommodityDef>();
  for (const c of commodityDefs) comMap.set(c.id, c);

  // Clone initial state
  const simPlanets = new Map<string, SimPlanet>();
  for (const planet of planets) {
    const stocks = new Map<string, SimStock>();
    for (const com of planet.commodities) {
      stocks.set(com.commodityId, {
        commodityId: com.commodityId,
        quantity: com.quantity,
        capacity: com.capacity,
        production: com.production,
        consumption: com.consumption,
        fillRatio: com.fillRatio,
      });
    }
    simPlanets.set(planet.planetId, { planetId: planet.planetId, stocks });
  }

  // Capture initial fills for affected-commodity detection
  const initialFills = new Map<string, number>();
  for (const [planetId, simPlanet] of simPlanets) {
    for (const [comId, stock] of simPlanet.stocks) {
      initialFills.set(`${planetId}:${comId}`, stock.fillRatio);
    }
  }

  const timeline: ForecastPoint[] = [];
  const crisisPoints: CrisisPoint[] = [];
  const crisisSeen = new Set<string>();

  for (let tick = 1; tick <= totalTicks; tick++) {
    const tickTime = now + tick * tickIntervalMs;

    // ── 1. Apply production/consumption with disruption modifiers ──
    for (const [, simPlanet] of simPlanets) {
      for (const [comId, stock] of simPlanet.stocks) {
        let prodMult = 1;
        let consMult = 1;

        // Check disruptions still active at this projected time
        for (const d of disruptions) {
          if (d.planetId !== simPlanet.planetId) continue;
          if (d.commodityId && d.commodityId !== comId) continue;
          if (tickTime > d.expiresAt) continue; // expired

          if (d.type === "production_halt") prodMult = 0;
          else if (d.type === "production_boost") prodMult = d.multiplier ?? 2;
          else if (d.type === "demand_surge") consMult = d.multiplier ?? 2;
        }

        stock.quantity = Math.min(
          stock.capacity,
          stock.quantity + stock.production * prodMult,
        );
        stock.quantity = Math.max(
          0,
          stock.quantity - stock.consumption * consMult,
        );
        stock.fillRatio = stock.capacity > 0 ? stock.quantity / stock.capacity : 0;
      }
    }

    // ── 2. Simplified NPC trade route simulation ──
    for (const route of routes) {
      if (!route.enabled) continue;

      // Check if route would fire at this tick (cooldown based)
      const cooldownMs = route.tripDurationMs * 1.5;
      const ticksSinceLastFire = Math.floor(
        (tickTime - route.lastDeparture) / cooldownMs,
      );
      const shouldFire =
        ticksSinceLastFire > 0 &&
        Math.floor((tickTime - tickIntervalMs - route.lastDeparture) / cooldownMs) <
          ticksSinceLastFire;

      if (!shouldFire) continue;

      const srcPlanet = simPlanets.get(route.sourcePlanet);
      const dstPlanet = simPlanets.get(route.destPlanet);
      if (!srcPlanet || !dstPlanet) continue;

      const srcStock = srcPlanet.stocks.get(route.commodityId);
      const dstStock = dstPlanet.stocks.get(route.commodityId);
      if (!srcStock || !dstStock) continue;

      // Check margin threshold (15%)
      const comDef = comMap.get(route.commodityId);
      if (!comDef) continue;

      const srcPrice = calculatePrice(
        comDef.basePrice,
        comDef.minPrice,
        comDef.maxPrice,
        comDef.volatility,
        srcStock.fillRatio,
      );
      const dstPrice = calculatePrice(
        comDef.basePrice,
        comDef.minPrice,
        comDef.maxPrice,
        comDef.volatility,
        dstStock.fillRatio,
      );
      const margin = srcPrice > 0 ? (dstPrice - srcPrice) / srcPrice : 0;
      if (margin < 0.15) continue;

      // Check source supply
      if (srcStock.fillRatio < 0.3) continue;

      // Execute trade
      const volume = Math.min(route.volumePerTrip, srcStock.quantity);
      srcStock.quantity -= volume;
      srcStock.fillRatio =
        srcStock.capacity > 0 ? srcStock.quantity / srcStock.capacity : 0;

      // Delivery happens after trip duration (simplified: instant for forecast)
      dstStock.quantity = Math.min(
        dstStock.capacity,
        dstStock.quantity + volume,
      );
      dstStock.fillRatio =
        dstStock.capacity > 0 ? dstStock.quantity / dstStock.capacity : 0;
    }

    // ── 3. Detect crises ──
    for (const [planetId, simPlanet] of simPlanets) {
      for (const [comId, stock] of simPlanet.stocks) {
        const key = `${planetId}:${comId}`;
        if (crisisSeen.has(key)) continue;

        if (stock.fillRatio < 0.05) {
          crisisPoints.push({
            planetId,
            commodityId: comId,
            type: "shortage",
            ticksUntil: tick,
            hoursUntil: Math.round((tick / 60) * 10) / 10,
          });
          crisisSeen.add(key);
        } else if (stock.fillRatio > 0.95) {
          crisisPoints.push({
            planetId,
            commodityId: comId,
            type: "overflow",
            ticksUntil: tick,
            hoursUntil: Math.round((tick / 60) * 10) / 10,
          });
          crisisSeen.add(key);
        }
      }
    }

    // ── 4. Sample timeline ──
    if (tick % sampleInterval === 0 || tick === totalTicks) {
      const planetMap = new Map<string, Map<string, ForecastCommodityState>>();
      for (const [planetId, simPlanet] of simPlanets) {
        const comMap2 = new Map<string, ForecastCommodityState>();
        for (const [comId, stock] of simPlanet.stocks) {
          const comDef = comMap.get(comId);
          const price = comDef
            ? calculatePrice(
                comDef.basePrice,
                comDef.minPrice,
                comDef.maxPrice,
                comDef.volatility,
                stock.fillRatio,
              )
            : 0;
          comMap2.set(comId, {
            commodityId: comId,
            fillRatio: stock.fillRatio,
            projectedPrice: price,
            quantity: stock.quantity,
            capacity: stock.capacity,
            crisis:
              stock.fillRatio < 0.05
                ? "shortage"
                : stock.fillRatio > 0.95
                  ? "overflow"
                  : null,
          });
        }
        planetMap.set(planetId, comMap2);
      }
      timeline.push({
        tickOffset: tick,
        timestamp: tickTime,
        planets: planetMap,
      });
    }
  }

  // Compute affected commodities (fill delta > 2%)
  const affectedCommodities = new Set<string>();
  for (const [planetId, simPlanet] of simPlanets) {
    for (const [comId, stock] of simPlanet.stocks) {
      const key = `${planetId}:${comId}`;
      const initial = initialFills.get(key) ?? 0;
      if (Math.abs(stock.fillRatio - initial) > 0.02) {
        affectedCommodities.add(key);
      }
    }
  }

  return { timeline, crisisPoints, affectedCommodities };
}
