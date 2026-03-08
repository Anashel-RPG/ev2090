/**
 * NPC Trade Route Simulation — Independent Hauler Intelligence
 *
 * Each NPC hauler is an independent economic actor making market-aware decisions.
 * There is no central coordinator — each route evaluates its own go/no-go:
 *
 *   1. Is the destination well-stocked? → SKIP (dest_fill > 0.65)
 *   2. Is the source running low?       → SKIP (source_fill < 0.25)
 *   3. How much to load?                → min(source surplus, dest room, ship) × f(urgency, greed) × jitter(±25%)
 *   4. Random departure jitter           → 15% chance to delay
 *   5. Trip time jitter                  → ±15% variation per trip
 *   6. Cargo jitter                      → ±25% load variation per trip
 *
 * This creates emergent sawtooth price patterns without any anomalies needed:
 *   consumption drains → price rises → NPC delivers → price drops → repeat
 *
 * Route capacity scales with distance: short routes = small couriers,
 * long routes = capital haulers. Multiple independent NPCs on overlapping
 * routes desynchronize naturally, creating organic price variation.
 */

import type {
  CommodityDef,
  CommodityStock,
  NpcTradeEvent,
  NpcTradeRoute,
  PlanetMarket,
} from "../types/economy";
import { calculatePrice } from "./pricing";

// ── NPC Intelligence Tuning Constants ──
// These 9 knobs control the entire NPC economy behavior.

/** Destination fill above this = NPC skips (market well-stocked) */
const DEST_FILL_SKIP = 0.65;

/** Destination fill below this = EMERGENCY dispatch (full cargo, skip jitter/margin) */
const DEST_FILL_EMERGENCY = 0.10;

/** Source fill below this = NPC protects local supply */
const SOURCE_FILL_PROTECT = 0.25;

/** Random skip probability per evaluation (departure desync) */
const DEPARTURE_JITTER = 0.15;

/** Trip time randomness band: base × uniform(1 ± this) */
const TRIP_TIME_JITTER = 0.15;

/** Minimum margin for NPC to consider the trip profitable */
const MIN_MARGIN = 0.05;

/** Minimum viable cargo to justify departure (units) */
const MIN_CARGO = 3;

/** Cargo scaling weights: urgency = how empty dest is, greed = margin */
const URGENCY_WEIGHT = 0.6;
const GREED_WEIGHT = 0.4;

/**
 * Cargo jitter band: final cargo × uniform(1 ± this).
 * Real haulers don't perfectly optimize every load. Sometimes the hold
 * is half-full because cargo inspection took too long, or the dockworkers
 * are on break, or there was a dispute about weight certification.
 */
const CARGO_JITTER = 0.25;

/** Base cargo units for the shortest route (30 min) */
const BASE_CARGO = 15;

// ── Route Generation ──

/**
 * Generate initial trade routes between planets based on production/consumption.
 * A route is created whenever one planet produces what another consumes.
 *
 * Cargo capacity scales with route length (longer = bigger ships):
 *   capacity = BASE_CARGO × sqrt(tripMinutes / 30)
 *
 *   30 min route  → 15 units  (small courier)
 *   60 min route  → 21 units  (medium freighter)
 *   120 min route → 30 units  (capital hauler)
 *
 * This is the "master knob" for oscillation amplitude: short routes with
 * small payloads create frequent small deliveries, long routes with big
 * payloads create dramatic price swings.
 */
export function generateInitialRoutes(
  planets: PlanetMarket[],
  commodities: Map<string, CommodityDef>,
): NpcTradeRoute[] {
  const routes: NpcTradeRoute[] = [];
  let routeIndex = 0;

  for (const source of planets) {
    for (const dest of planets) {
      if (source.planetId === dest.planetId) continue;

      // Find commodities that source produces and dest consumes
      for (const [commodityId, sourceStock] of source.inventory) {
        if (sourceStock.baseProduction <= 0) continue;

        const destStock = dest.inventory.get(commodityId);
        if (!destStock || destStock.baseConsumption <= 0) continue;

        // Random trip duration: 30-120 minutes
        const tripMinutes = 30 + Math.random() * 90;
        const tripDurationMs = tripMinutes * 60_000;

        // Capacity scales with sqrt of trip duration
        // Short routes = small couriers, long routes = capital haulers
        const cargoCapacity = BASE_CARGO * Math.sqrt(tripMinutes / 30);

        routes.push({
          id: `route-${routeIndex++}`,
          commodityId,
          sourcePlanet: source.planetId,
          destPlanet: dest.planetId,
          volumePerTrip: Math.round(cargoCapacity * 10) / 10,
          tripDurationMs,
          lastDeparture: 0,
          enabled: true,
          inTransit: false,
          cargoInTransit: 0,
          effectiveTripMs: 0,
        });
      }
    }
  }

  return routes;
}

// ── Main Simulation Loop ──

/**
 * Simulate NPC trade routes for one tick.
 * Each NPC hauler acts independently — no central coordinator.
 *
 * For in-transit routes: check if trip completed → deliver locked cargo.
 * For idle routes: run NPC decision engine → maybe depart.
 */
export function simulateNpcTrades(
  routes: NpcTradeRoute[],
  planets: Map<string, PlanetMarket>,
  commodities: Map<string, CommodityDef>,
  now: number,
): NpcTradeEvent[] {
  const events: NpcTradeEvent[] = [];

  for (const route of routes) {
    const source = planets.get(route.sourcePlanet);
    const dest = planets.get(route.destPlanet);
    if (!source || !dest) continue;

    const commodity = commodities.get(route.commodityId);
    if (!commodity) continue;

    const sourceStock = source.inventory.get(route.commodityId);
    const destStock = dest.inventory.get(route.commodityId);
    if (!sourceStock || !destStock) continue;

    // ── In-transit: check for delivery ──
    if (route.inTransit) {
      const elapsed = now - route.lastDeparture;
      // Use the jittered trip time that was set at departure
      const tripMs = route.effectiveTripMs || route.tripDurationMs;

      if (elapsed >= tripMs) {
        // Trip completed — deliver the LOCKED cargo (not recalculated)
        const destFillBefore = destStock.fillRatio;
        const sourceFillBefore = sourceStock.fillRatio;

        const deliverQty = Math.min(
          route.cargoInTransit,
          destStock.capacity - destStock.quantity,
        );

        destStock.quantity += deliverQty;
        destStock.fillRatio = destStock.quantity / destStock.capacity;
        route.inTransit = false;
        route.cargoInTransit = 0;
        route.effectiveTripMs = 0;

        const sourcePrice = calculatePrice(commodity, sourceStock);
        const destPrice = calculatePrice(commodity, destStock);

        events.push({
          id: `te-${now}-${route.id}-del`,
          routeId: route.id,
          type: "delivery",
          commodityId: route.commodityId,
          sourcePlanet: route.sourcePlanet,
          destPlanet: route.destPlanet,
          quantity: deliverQty,
          sourcePrice,
          destPrice,
          margin: sourcePrice > 0 ? (destPrice - sourcePrice) / sourcePrice : 0,
          sourceFillBefore,
          destFillBefore,
          sourceFillAfter: sourceStock.fillRatio,
          destFillAfter: destStock.fillRatio,
          timestamp: now,
        });
      }
      continue;
    }

    // ── Route disabled: skip dispatch ──
    if (!route.enabled) continue;

    // ── Docked: NPC evaluates whether to trade ──
    const decision = npcDecision(route, sourceStock, destStock, commodity, now);
    if (!decision.go) continue;

    const takeQty = Math.min(decision.cargo, sourceStock.quantity);
    if (takeQty < MIN_CARGO) continue;

    const sourceFillBefore = sourceStock.fillRatio;
    const destFillBefore = destStock.fillRatio;
    const sourcePrice = calculatePrice(commodity, sourceStock);
    const destPrice = calculatePrice(commodity, destStock);

    // Load cargo and depart
    sourceStock.quantity -= takeQty;
    sourceStock.fillRatio = sourceStock.quantity / sourceStock.capacity;
    route.lastDeparture = now;
    route.inTransit = true;
    route.cargoInTransit = takeQty;
    route.effectiveTripMs = jitteredTripTime(route.tripDurationMs);

    events.push({
      id: `te-${now}-${route.id}-dep`,
      routeId: route.id,
      type: "departure",
      commodityId: route.commodityId,
      sourcePlanet: route.sourcePlanet,
      destPlanet: route.destPlanet,
      quantity: takeQty,
      sourcePrice,
      destPrice,
      margin: sourcePrice > 0 ? (destPrice - sourcePrice) / sourcePrice : 0,
      sourceFillBefore,
      destFillBefore,
      sourceFillAfter: sourceStock.fillRatio,
      destFillAfter: destStock.fillRatio,
      timestamp: now,
    });
  }

  return events;
}

// ── NPC Decision Engine ──

interface NpcDecisionResult {
  go: boolean;
  cargo: number;     // Only meaningful when go=true
  reason?: string;   // Only meaningful when go=false
}

/**
 * The NPC brain: 6 rules that create emergent market dynamics.
 *
 * EMERGENCY: dest_fill < 0.10 → ALWAYS GO, FULL CARGO (skip margin/jitter)
 *   Why: A critically empty market is a guaranteed profit. NPC captains
 *   don't hesitate when a planet is starving — they load up and go.
 *   Only cooldown and source safety can stop them. This prevents markets
 *   from staying permanently halted at 0%.
 *
 * Rule 1: DESTINATION CHECK — skip if dest_fill > 0.65 (well-stocked)
 *   Why: NPC won't fly to a planet that doesn't need goods. This is the
 *   key rule that prevents clockwork behavior — once delivered, NPC waits
 *   for consumption to drain the market before going again.
 *
 * Rule 2: SOURCE SAFETY — skip if source_fill < 0.25 (protect supply)
 *   Why: NPC won't strip a planet bare. Protects producing planets from
 *   being drained by too many haulers.
 *
 * Rule 3: CARGO SCALING — load = capacity × f(urgency, greed)
 *   Why: NPC loads more when destination is desperate (urgency) or when
 *   the margin is juicy (greed). Creates variable delivery sizes.
 *
 * Rule 4: DEPARTURE JITTER — 15% random skip per evaluation
 *   Why: Prevents NPCs from departing in lock-step even when conditions
 *   are identical. Creates natural desynchronization.
 *
 * Rule 5: COOLDOWN — can't re-evaluate until 1.2× trip duration has passed
 *   Why: Simulates turnaround time (docking, refueling, crew rest).
 */
function npcDecision(
  route: NpcTradeRoute,
  sourceStock: CommodityStock,
  destStock: CommodityStock,
  commodity: CommodityDef,
  now: number,
): NpcDecisionResult {
  // Rule 5: Cooldown — turnaround time (variable: 1.0× to 1.5× trip)
  // Not every turnaround is the same. Sometimes the crew is fast, sometimes
  // they're haggling over docking fees or waiting for cargo inspection.
  // Using a seeded random from lastDeparture so it's stable within one cycle.
  const cooldownMult = 1.0 + pseudoRandom(route.lastDeparture) * 0.5;
  const cooldown = route.tripDurationMs * cooldownMult;
  if (now - route.lastDeparture < cooldown) {
    return { go: false, cargo: 0, reason: "cooldown" };
  }

  // EMERGENCY DISPATCH: Planet critically low — NPC bets on guaranteed profit.
  // Skips margin check and jitter. Loads as much as possible. Only respects
  // cooldown and source safety. This prevents markets from staying at 0%.
  if (destStock.fillRatio < DEST_FILL_EMERGENCY) {
    if (sourceStock.fillRatio < SOURCE_FILL_PROTECT) {
      return { go: false, cargo: 0, reason: "source_low" };
    }
    // Even in an emergency, can't take more than source can spare or dest can hold
    const surplus = Math.max(0,
      sourceStock.quantity - sourceStock.capacity * SOURCE_FILL_PROTECT,
    );
    const room = Math.max(0, destStock.capacity - destStock.quantity);
    const emergencyCargo = Math.min(surplus, room, route.volumePerTrip);
    return { go: true, cargo: emergencyCargo };
  }

  // Rule 1: Destination well-stocked — no urgent demand
  if (destStock.fillRatio > DEST_FILL_SKIP) {
    return { go: false, cargo: 0, reason: "dest_stocked" };
  }

  // Rule 2: Source running low — protect local supply
  if (sourceStock.fillRatio < SOURCE_FILL_PROTECT) {
    return { go: false, cargo: 0, reason: "source_low" };
  }

  // Margin check: NPC needs at least minimum profitability
  const sourcePrice = calculatePrice(commodity, sourceStock);
  const destPrice = calculatePrice(commodity, destStock);
  const margin = sourcePrice > 0 ? (destPrice - sourcePrice) / sourcePrice : 0;

  if (margin < MIN_MARGIN) {
    return { go: false, cargo: 0, reason: "low_margin" };
  }

  // Rule 4: Departure jitter — random skip for desynchronization
  if (Math.random() < DEPARTURE_JITTER) {
    return { go: false, cargo: 0, reason: "jitter_skip" };
  }

  // Rule 3: Cargo scaling — what can source spare vs what dest needs
  const cargo = calculateCargo(route, sourceStock, destStock, margin);

  return { go: true, cargo };
}

// ── Cargo Calculation ──

/**
 * Calculate cargo quantity based on what's actually available and needed.
 *
 * A real hauler thinks like this:
 *   1. "How much can the source spare?" — stock above the 25% safety line
 *   2. "How much room does the destination have?" — empty capacity
 *   3. "How much can my ship carry?" — volumePerTrip
 *   → Take the smallest of these three as the ceiling.
 *
 * Then scale by how urgent and profitable the run is:
 *   urgency = 1 − dest_fill    (0 = full, 1 = empty)
 *   greed   = margin / 2       (0 = break-even, 1 = 200%+ spread)
 *   factor  = clamp(urgency × 0.6 + greed × 0.4,  0.15,  1.0)
 *   cargo   = max(MIN_CARGO, ceiling × factor)
 *
 * This means:
 *   - Source at 30% (barely above safety): NPC takes very little — shelves are bare
 *   - Destination at 60% (limited room): NPC won't overshoot
 *   - Desperate destination + fat margin: heavier load within what's available
 *
 * Examples (source_cap=125, dest_cap=125, ship=15):
 *   Source 80%, dest 20%, margin 50%:
 *     surplus=68.8, room=100, ship=15 → ceiling=15
 *     urgency=0.8, greed=0.25 → factor=0.58 → cargo=8.7
 *
 *   Source 30%, dest 20%, margin 50%:
 *     surplus=6.25, room=100, ship=15 → ceiling=6.25
 *     urgency=0.8, greed=0.25 → factor=0.58 → cargo=3.6
 *     (source is tight — NPC loads light)
 *
 *   Source 80%, dest 55%, margin 10%:
 *     surplus=68.8, room=56.3, ship=15 → ceiling=15
 *     urgency=0.45, greed=0.05 → factor=0.29 → cargo=4.4
 *     (dest doesn't need much — light load)
 */
function calculateCargo(
  route: NpcTradeRoute,
  sourceStock: CommodityStock,
  destStock: CommodityStock,
  margin: number,
): number {
  // What can the source spare without going below safety?
  const sourceSurplus = Math.max(0,
    sourceStock.quantity - sourceStock.capacity * SOURCE_FILL_PROTECT,
  );

  // How much room does the destination have?
  const destRoom = Math.max(0, destStock.capacity - destStock.quantity);

  // The ceiling: can't load more than source has, dest needs, or ship holds
  const ceiling = Math.min(sourceSurplus, destRoom, route.volumePerTrip);

  // If there's basically nothing useful to carry, don't bother
  if (ceiling < MIN_CARGO) return 0;

  // Scale by urgency and greed within what's actually available
  const urgency = 1 - destStock.fillRatio;
  const greed = Math.min(1, Math.max(0, margin) / 2);

  const factor = Math.max(0.15, Math.min(1.0,
    urgency * URGENCY_WEIGHT + greed * GREED_WEIGHT,
  ));

  const baseCargo = ceiling * factor;

  // Cargo jitter: ±25%. Real haulers don't perfectly optimize every load.
  // Sometimes the hold is half-full, sometimes they squeeze in extra crates.
  const jitter = 1 + (Math.random() * 2 - 1) * CARGO_JITTER;
  const jittered = baseCargo * jitter;

  // Clamp: at least MIN_CARGO, never exceed ceiling (ship/source/dest limit)
  return Math.max(MIN_CARGO, Math.min(ceiling, jittered));
}

// ── Deterministic Random ──

/**
 * Simple hash-based pseudo-random from a seed value.
 * Returns a value in [0, 1). Deterministic for the same seed —
 * so cooldown doesn't re-roll every tick, only per departure.
 */
function pseudoRandom(seed: number): number {
  let x = Math.sin(seed * 9301 + 49297) * 49297;
  x = x - Math.floor(x);
  return Math.abs(x);
}

// ── Trip Time Jitter ──

/**
 * Apply ±15% jitter to trip duration.
 * Prevents NPCs from arriving in lock-step when multiple routes
 * service the same destination.
 */
function jitteredTripTime(baseMs: number): number {
  const jitter = 1 + (Math.random() * 2 - 1) * TRIP_TIME_JITTER;
  return Math.round(baseMs * jitter);
}
