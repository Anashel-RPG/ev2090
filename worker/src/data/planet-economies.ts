/**
 * Planet economy configurations for EV 2090.
 * Maps each planet to its economy type, production, and consumption.
 *
 * Derived from station lore in frontend/src/data/stations.ts:
 * - Nexara: medical research + interstellar trade hub
 * - Velkar: ore processing + frontier refinery (mining)
 * - Zephyra: deep space observatory (research)
 * - Arctis: automated relay (small industrial)
 */

import type { PlanetEconomyConfig } from "../types/economy";

/**
 * Economy redesign goals:
 *   - Every commodity has at least one producer AND one consumer
 *   - Every planet has robust inbound and outbound trade routes
 *   - Bidirectional flows between all planet pairs create natural price oscillation
 *
 * Expected routes (~31 total after generateInitialRoutes):
 *   Nexara → Velkar: grain, protein-packs, spice                    (3)
 *   Nexara → Arctis: grain, protein-packs, spice                    (3)
 *   Nexara → Zephyra: luxury-food, wine, jewelry, art               (4)
 *   Velkar → Nexara: iron                                            (1)
 *   Velkar → Zephyra: iron, rare-earths, helium3, crystals          (4)
 *   Velkar → Arctis: iron, titanium, rare-earths, helium3           (4)
 *   Zephyra → Nexara: microchips, quantum-cores, ai-modules         (3)
 *   Zephyra → Velkar: microchips, sensors                           (2)
 *   Zephyra → Arctis: ai-modules, sensors                           (2)
 *   Arctis → Nexara: steel, fuel-cells, polymers                    (3)
 *   Arctis → Velkar: fuel-cells, coolant, steel                     (3)
 *   Arctis → Zephyra: fuel-cells, coolant                           (2)
 *                                                           Total = ~34
 */
export const PLANET_ECONOMIES: PlanetEconomyConfig[] = [
  {
    planetId: "nexara",
    name: "Nexara",
    economyType: "trade-hub",
    // Agri-orbital domes + cultural exports. The hub itself imports raw materials
    // and advanced tech; it re-exports food and luxury goods across the region.
    produces: ["grain", "protein-packs", "luxury-food", "wine", "spice", "jewelry", "art"],
    consumes: ["iron", "microchips", "steel", "fuel-cells", "polymers", "quantum-cores", "ai-modules"],
    tradeModifier: 0.85, // 15% cheaper to buy — trade hub bonus
  },
  {
    planetId: "velkar",
    name: "Velkar",
    economyType: "mining",
    // Deep-core extraction operation. Exports raw minerals to industry and
    // research. Imports food to feed the workforce and tech for mining rigs.
    produces: ["iron", "titanium", "rare-earths", "crystals", "helium3"],
    consumes: ["grain", "protein-packs", "spice", "fuel-cells", "coolant", "microchips", "steel", "sensors"],
    tradeModifier: 1.0,
  },
  {
    planetId: "zephyra",
    name: "Zephyra",
    economyType: "research",
    // Deep-space observatory and R&D complex. Produces cutting-edge technology;
    // consumes raw minerals for fabrication labs and luxury goods for the
    // high-paid research staff.
    produces: ["microchips", "quantum-cores", "ai-modules", "sensors"],
    consumes: ["iron", "rare-earths", "helium3", "crystals", "luxury-food", "wine", "jewelry", "art", "fuel-cells"],
    tradeModifier: 1.0,
  },
  {
    planetId: "arctis",
    name: "Arctis",
    economyType: "industrial",
    // Automated heavy-manufacturing hub. Converts raw minerals into refined
    // industrial goods. Consumes minerals and food to sustain the factory
    // population, and imports AI modules for production automation.
    produces: ["steel", "polymers", "fuel-cells", "coolant"],
    consumes: ["iron", "titanium", "rare-earths", "helium3", "grain", "protein-packs", "ai-modules", "sensors"],
    tradeModifier: 1.0,
  },
];

export const PLANET_ECONOMY_MAP = new Map(
  PLANET_ECONOMIES.map((p) => [p.planetId, p]),
);

/** Region definition — Phase 1 has a single region */
export const REGIONS = [
  {
    regionId: "core-worlds",
    name: "Core Worlds",
    planets: PLANET_ECONOMIES.map((p) => p.planetId),
  },
];
