/**
 * Analyze economy data to detect current problems.
 * Pure data — no Three.js or React.
 */
import type {
  AdminRegionDetail,
  EconomyDiagnostics,
} from "../types";

export interface HaltedProblem {
  planetId: string;
  commodityId: string;
  remainingMs: number;
}

export interface ShortageProblem {
  planetId: string;
  commodityId: string;
  fillRatio: number;
  critical: boolean;
}

export interface OversupplyProblem {
  planetId: string;
  commodityId: string;
  fillRatio: number;
}

export interface OrphanProblem {
  planetId: string;
  commodityId: string;
  production: number;
}

export interface DeadRouteProblem {
  routeId: string;
  commodityId: string;
  sourcePlanet: string;
  destPlanet: string;
}

export interface ProblemSet {
  haltedProduction: HaltedProblem[];
  supplyShortages: ShortageProblem[];
  oversupply: OversupplyProblem[];
  orphanCommodities: OrphanProblem[];
  deadRoutes: DeadRouteProblem[];
  tickAnomalies: string[];
  totalCount: number;
}

export function detectProblems(
  detail: AdminRegionDetail,
  diagnostics?: EconomyDiagnostics,
): ProblemSet {
  const problems: ProblemSet = {
    haltedProduction: [],
    supplyShortages: [],
    oversupply: [],
    orphanCommodities: [],
    deadRoutes: [],
    tickAnomalies: [],
    totalCount: 0,
  };

  const now = Date.now();

  // ── Halted production (from disruptions) ──
  for (const d of detail.disruptions) {
    if (d.type === "production_halt") {
      problems.haltedProduction.push({
        planetId: d.planetId,
        commodityId: d.commodityId ?? "unknown",
        remainingMs: d.remainingMs,
      });
    }
  }

  // ── Supply shortages & oversupply ──
  for (const planet of detail.planets) {
    for (const com of planet.commodities) {
      if (com.fillRatio < 0.15) {
        problems.supplyShortages.push({
          planetId: planet.planetId,
          commodityId: com.commodityId,
          fillRatio: com.fillRatio,
          critical: com.fillRatio < 0.05,
        });
      }
      if (com.fillRatio > 0.9) {
        problems.oversupply.push({
          planetId: planet.planetId,
          commodityId: com.commodityId,
          fillRatio: com.fillRatio,
        });
      }
    }
  }

  // ── Orphan commodities (produced but no outbound route) ──
  for (const planet of detail.planets) {
    for (const com of planet.commodities) {
      if (com.production > 0) {
        const hasRoute = detail.routes.some(
          (r) =>
            r.sourcePlanet === planet.planetId &&
            r.commodityId === com.commodityId,
        );
        if (!hasRoute) {
          problems.orphanCommodities.push({
            planetId: planet.planetId,
            commodityId: com.commodityId,
            production: com.production,
          });
        }
      }
    }
  }

  // ── Dead routes ──
  for (const route of detail.routes) {
    const isDead =
      !route.inTransit &&
      (now - route.lastDeparture > 7_200_000 || route.lastDeparture === 0);
    if (isDead) {
      problems.deadRoutes.push({
        routeId: route.id,
        commodityId: route.commodityId,
        sourcePlanet: route.sourcePlanet,
        destPlanet: route.destPlanet,
      });
    }
  }

  // ── Tick anomalies ──
  if (diagnostics) {
    problems.tickAnomalies = [...diagnostics.anomalies];
  }

  problems.totalCount =
    problems.haltedProduction.length +
    problems.supplyShortages.length +
    problems.oversupply.length +
    problems.orphanCommodities.length +
    problems.deadRoutes.length +
    problems.tickAnomalies.length;

  return problems;
}
