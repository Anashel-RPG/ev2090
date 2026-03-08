/**
 * Hangar type bridge — adapts ShipDef / CommunityShipMeta into the richer
 * HangarShip type needed by the ui-demo-derived card & detail components.
 */

import type { ShipDef, ShipStats } from "@/engine/ShipCatalog";

/* ─── Context ─── */

export type HangarContext = "hangar" | "forge";

/* ─── Hangar ship — UI display type ─── */

export interface HangarShip {
  id: string;
  name: string;
  class: string;
  imageUrl: string;
  status: "Hangar" | "Active";
  cargoSpace: number;
  hardpoints: { turret: number; launcher: number };
  droneBay: number;
  description: string;
  modelId: string;
  creator?: string;
  source: "builtin" | "community";
  /** Original ShipDef reference for engine operations */
  _shipDef: ShipDef;
}

/* ─── Ship metadata from forge catalog API (both built-in and community) ─── */

export interface CommunityShipMeta {
  id: string;
  name: string;
  class: string;
  prompt: string;
  creator: string;
  modelUrl: string;
  thumbnailUrl: string;
  conceptUrl: string;
  heroUrl?: string;
  stats: ShipStats;
  lore: string;
  createdAt: number;
  // Built-in ship extras (optional — community ships don't use these)
  source?: "builtin" | "community";
  texturePath?: string;
  extraTextures?: Record<string, string>;
  modelScale?: number;
  defaultHeadingDeg?: number;
  defaultHardpoints?: Array<{ type: string; localX: number; localY: number; localZ: number; label?: string; thrustAngleDeg?: number }>;
  thrusterPos?: { x: number; y: number; z: number };
  materialConfig?: {
    metalness?: number;
    roughness?: number;
    emissiveIntensity?: number;
    emissiveR?: number;
    emissiveG?: number;
    emissiveB?: number;
  };
}

/* ─── Adapters ─── */

/** Derive hangar display values from a ShipDef */
export function toHangarShip(def: ShipDef, isActive: boolean): HangarShip {
  return {
    id: def.id,
    name: def.name,
    class: def.class,
    imageUrl: def.heroUrl || def.thumbnailUrl || "",
    status: isActive ? "Active" : "Hangar",
    cargoSpace: def.stats.cargo * 3000,
    hardpoints: {
      turret: Math.ceil(def.stats.firepower * 0.8),
      launcher: Math.floor(def.stats.firepower * 0.4),
    },
    droneBay: def.stats.cargo * 15,
    description: def.lore,
    modelId: def.id,
    creator: def.creator,
    source: def.source ?? "builtin",
    _shipDef: def,
  };
}

/** Derive hangar display values from catalog API meta (built-in or community) */
export function communityToHangarShip(meta: CommunityShipMeta, def: ShipDef): HangarShip {
  return {
    id: meta.id,
    name: meta.name,
    class: meta.class,
    imageUrl: meta.heroUrl || meta.conceptUrl || meta.thumbnailUrl,
    status: "Hangar",
    cargoSpace: meta.stats.cargo * 3000,
    hardpoints: {
      turret: Math.ceil(meta.stats.firepower * 0.8),
      launcher: Math.floor(meta.stats.firepower * 0.4),
    },
    droneBay: meta.stats.cargo * 15,
    description: meta.lore,
    modelId: meta.id,
    creator: meta.creator,
    source: meta.source ?? "community",
    _shipDef: def,
  };
}

/* ─── Class color map — covers all game class names ─── */

export const CLASS_COLOR: Record<string, string> = {
  INTERCEPTOR:   "rgba(0,200,255,0.9)",
  FIGHTER:       "rgba(0,200,255,0.9)",
  ASSAULT:       "rgba(210,45,45,0.9)",
  CAPITAL:       "rgba(240,180,41,0.9)",
  RAIDER:        "rgba(240,90,30,0.9)",
  UTILITY:       "rgba(50,170,80,0.9)",
  COURIER:       "rgba(60,130,220,0.9)",
  FRIGATE:       "rgba(0,200,255,0.9)",
  RECON:         "rgba(100,120,200,0.9)",
  PATROL:        "rgba(100,160,140,0.9)",
  EXPLORER:      "rgba(80,160,220,0.9)",
  PROTOTYPE:     "rgba(180,80,220,0.9)",
  EXPERIMENTAL:  "rgba(180,80,220,0.9)",
  CUSTOM:        "rgba(140,140,160,0.9)",
  FREIGHTER:     "rgba(120,140,100,0.9)",
};

/**
 * Hero background gradient tint per ship class.
 * Used as the bottom-fade colour in the ship detail modal.
 * Tuned to complement each class's accent colour — bake permanent
 * values here after running the in-app hero visual tuner.
 */
export const CLASS_HERO_TINT: Record<string, { r: number; g: number; b: number }> = {
  INTERCEPTOR:   { r: 0,  g: 28, b: 52 },  // deep navy-teal
  FIGHTER:       { r: 0,  g: 28, b: 52 },  // deep navy-teal
  ASSAULT:       { r: 55, g: 6,  b: 6  },  // deep blood-crimson
  CAPITAL:       { r: 38, g: 26, b: 0  },  // deep burnished gold
  RAIDER:        { r: 50, g: 18, b: 0  },  // deep ember-orange
  UTILITY:       { r: 0,  g: 38, b: 14 },  // deep forest-green
  COURIER:       { r: 5,  g: 18, b: 55 },  // deep royal-blue
  FRIGATE:       { r: 0,  g: 25, b: 50 },  // deep ocean-blue
  RECON:         { r: 14, g: 8,  b: 45 },  // deep indigo
  PATROL:        { r: 0,  g: 30, b: 28 },  // deep teal
  EXPLORER:      { r: 0,  g: 21, b: 55 },  // deep expedition-navy ← Zenith reference
  PROTOTYPE:     { r: 28, g: 0,  b: 48 },  // deep void-purple
  EXPERIMENTAL:  { r: 28, g: 0,  b: 48 },  // deep void-purple
  CUSTOM:        { r: 10, g: 10, b: 22 },  // neutral deep-slate
  FREIGHTER:     { r: 12, g: 18, b: 8  },  // deep industrial-olive
};

/** Fallback tint when class is not in the map. */
export const DEFAULT_HERO_TINT: { r: number; g: number; b: number } = { r: 4, g: 10, b: 22 };

/** Get all unique class names from the catalog */
export function getUniqueClasses(ships: HangarShip[]): string[] {
  const set = new Set(ships.map((s) => s.class));
  return [...set].sort();
}

/* ─── Forge ship building ─── */

/** Default tuning for MeshyAI community ships. Does NOT apply to built-in low-poly ships. */
export const COMMUNITY_SHIP_DEFAULTS: Pick<ShipDef, "modelScale" | "defaultHeadingDeg" | "thrusterPos" | "materialConfig"> = {
  modelScale: 2.5,
  defaultHeadingDeg: 0,
  thrusterPos: { x: 0, y: -3.76, z: -0.15 },
  materialConfig: {
    metalness: 0.46,
    roughness: 1.0,
    emissiveIntensity: 0.1,
    emissiveR: 18,
    emissiveG: 22,
    emissiveB: 38,
  },
};

/** Per-ship config overrides — hand-tuned in the hardpoint editor, keyed by ship ID. */
export const SHIP_CONFIG_OVERRIDES: Record<string, Partial<Pick<ShipDef, "modelScale" | "defaultHeadingDeg" | "defaultHardpoints" | "thrusterPos" | "materialConfig">>> = {
  // Ship 338d51c3 — single-thruster community ship
  "338d51c3-8280-4662-99bb-4d7cedfb4b53": {
    modelScale: 2.5,
    defaultHeadingDeg: 0,
    defaultHardpoints: [
      { type: "thruster", localX: 0, localY: -1.92, localZ: -0.17, label: "engine" },
    ],
    materialConfig: {
      metalness: 0.46,
      roughness: 1,
      emissiveIntensity: 0.1,
      emissiveR: 18,
      emissiveG: 22,
      emissiveB: 38,
    },
  },
  // Ship f9b997fa — triple-thruster community ship (angled -90°)
  "f9b997fa-9a1f-417a-8a5b-6c8676b2ad2c": {
    modelScale: 2.5,
    defaultHeadingDeg: 0,
    defaultHardpoints: [
      { type: "thruster", localX: -2.38, localY: 0, localZ: -0.45, label: "engine-C", thrustAngleDeg: -90 },
      { type: "thruster", localX: -2.318, localY: 0.785, localZ: 0.401, label: "engine-R", thrustAngleDeg: -90 },
      { type: "thruster", localX: -2.316, localY: -0.768, localZ: 0.395, label: "engine-L", thrustAngleDeg: -90 },
    ],
    materialConfig: {
      metalness: 0.46,
      roughness: 1,
      emissiveIntensity: 0.1,
      emissiveR: 18,
      emissiveG: 22,
      emissiveB: 38,
    },
  },
  // Ship 5272c88f — XVX Cthulhoid, dual-thruster community ship (angled -90°)
  "5272c88f-03bc-4087-9c70-1aeb6f39c20b": {
    modelScale: 2.5,
    defaultHardpoints: [
      { type: "thruster", localX: -2.24, localY: 0.244, localZ: 0, thrustAngleDeg: -90 },
      { type: "thruster", localX: -2.24, localY: -0.25, localZ: 0, thrustAngleDeg: -90 },
    ],
    materialConfig: {
      metalness: 0.46,
      roughness: 1,
      emissiveIntensity: 0.1,
      emissiveR: 18,
      emissiveG: 22,
      emissiveB: 38,
    },
  },
  // Cyclope — dual-thruster community ship (heading 90° for visual orientation)
  "6d9808fc-a412-456c-b000-e98145eb9bb1": {
    modelScale: 2.5,
    defaultHeadingDeg: 90,
    defaultHardpoints: [
      { type: "thruster", localX: -0.79, localY: -1.98, localZ: 0, label: "engine-L" },
      { type: "thruster", localX: 0.79, localY: -1.98, localZ: 0, label: "engine-R" },
    ],
    materialConfig: {
      metalness: 0.02,
      roughness: 0,
      emissiveIntensity: 0.29,
      emissiveR: 0,
      emissiveG: 0,
      emissiveB: 0,
    },
  },
};

const FORGE_KEY_STORAGE = "ev2090_forge_api_key";

/** Admin API key — DEV ONLY. Never bake into production builds.
 *
 * Source priority (dev only):
 * - `VITE_FORGE_API_KEY` in `.env.*`
 * - `localStorage["ev2090_forge_api_key"]` (set via in-app prompt)
 */
export function getForgeApiKey(): string {
  if (!import.meta.env.DEV) return "";

  const fromEnv = import.meta.env.VITE_FORGE_API_KEY?.trim() || "";
  if (fromEnv) return fromEnv;

  try {
    const fromStorage =
      typeof window !== "undefined"
        ? window.localStorage.getItem(FORGE_KEY_STORAGE)?.trim() || ""
        : "";
    return fromStorage;
  } catch {
    return "";
  }
}

export function setForgeApiKey(key: string): void {
  if (!import.meta.env.DEV) return;
  try {
    if (typeof window === "undefined") return;
    const trimmed = key.trim();
    if (!trimmed) {
      window.localStorage.removeItem(FORGE_KEY_STORAGE);
    } else {
      window.localStorage.setItem(FORGE_KEY_STORAGE, trimmed);
    }
  } catch {
    // ignore storage errors
  }
}

export function clearForgeApiKey(): void {
  setForgeApiKey("");
}

/** Build a ShipDef from catalog API meta (built-in or community) */
export function buildShipDef(ship: CommunityShipMeta): ShipDef {
  const isBuiltin = ship.source === "builtin";

  const base: ShipDef = {
    id: ship.id,
    name: ship.name,
    class: ship.class,
    modelPath: ship.modelUrl,
    texturePath: ship.texturePath ?? "",
    stats: ship.stats,
    lore: ship.lore,
    source: ship.source ?? "community",
    thumbnailUrl: ship.thumbnailUrl,
    heroUrl: ship.heroUrl,
    creator: ship.creator,
    prompt: ship.prompt,
  };

  if (isBuiltin) {
    // Built-in ships carry their own config from the API
    if (ship.extraTextures) base.extraTextures = ship.extraTextures;
    if (ship.modelScale != null) base.modelScale = ship.modelScale;
    if (ship.defaultHeadingDeg != null) base.defaultHeadingDeg = ship.defaultHeadingDeg;
    if (ship.defaultHardpoints) base.defaultHardpoints = ship.defaultHardpoints;
    if (ship.thrusterPos) base.thrusterPos = ship.thrusterPos;
    if (ship.materialConfig) base.materialConfig = ship.materialConfig;
  } else {
    // Community ships get default tuning + per-ship overrides
    Object.assign(base, COMMUNITY_SHIP_DEFAULTS, SHIP_CONFIG_OVERRIDES[ship.id]);
  }

  return base;
}
