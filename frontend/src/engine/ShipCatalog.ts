/**
 * Ship catalog — all available player ships from the Quaternius pack.
 * Each ship has a GLTF model, a default Blue texture, and EV-style stats.
 * Built-in ship assets are served from R2 CDN via the worker.
 */

import { ASSET_BASE } from "@/config/urls";

/** CDN base for built-in ship assets served from R2 */
export const SHIP_CDN_BASE = `${ASSET_BASE}/ships`;

export interface ShipStats {
  speed: number; // 1-10
  armor: number; // 1-10
  cargo: number; // 1-10
  firepower: number; // 1-10
}

export interface ShipDef {
  id: string;
  name: string;
  class: string;
  modelPath: string;
  texturePath: string;
  stats: ShipStats;
  lore: string;
  /** Custom textures beyond the standard 5 colors (e.g. AI-generated skins) */
  extraTextures?: Record<string, string>;
  /** Per-ship model scale in hardpoint editor (default 0.4) */
  modelScale?: number;
  /** Per-ship default heading in degrees (default 0) */
  defaultHeadingDeg?: number;
  /** Per-ship default hardpoints (thruster position, etc.) */
  defaultHardpoints?: { type: string; localX: number; localY: number; localZ: number; label?: string; thrustAngleDeg?: number }[];
  /** Visual thruster position in gameplay mesh space (−Y = behind). Overrides default (0, −1.6, 0). */
  thrusterPos?: { x: number; y: number; z: number };
  /** Per-ship material overrides (community ships with custom tuning) */
  materialConfig?: {
    metalness?: number;
    roughness?: number;
    emissiveIntensity?: number;
    emissiveR?: number; // 0-255
    emissiveG?: number;
    emissiveB?: number;
  };
  /** "builtin" for hardcoded ships, "community" for AI-generated */
  source?: "builtin" | "community";
  /** CDN thumbnail URL (community ships) */
  thumbnailUrl?: string;
  /** Hero banner URL */
  heroUrl?: string;
  /** Creator nickname (community ships) */
  creator?: string;
  /** Generation prompt (community ships) */
  prompt?: string;
}

export const SHIP_CATALOG: ShipDef[] = [
  {
    id: "striker",
    name: "Striker",
    class: "INTERCEPTOR",
    modelPath: `${SHIP_CDN_BASE}/striker/Striker.gltf`,
    texturePath: `${SHIP_CDN_BASE}/striker/Striker_Blue.png`,
    stats: { speed: 9, armor: 3, cargo: 2, firepower: 6 },
    lore: "Built for lightning strikes — in and out before they blink.",
    modelScale: 0.4,
    defaultHeadingDeg: 0,
    defaultHardpoints: [
      { type: "thruster", localX: 0.01, localY: -1.3, localZ: 0.07, label: "engine" },
    ],
  },
  {
    id: "bob",
    name: "Bob",
    class: "UTILITY",
    modelPath: `${SHIP_CDN_BASE}/bob/Bob.gltf`,
    texturePath: `${SHIP_CDN_BASE}/bob/Bob_Blue.png`,
    stats: { speed: 5, armor: 5, cargo: 8, firepower: 2 },
    lore: "She's not pretty, but she'll haul anything anywhere.",
  },
  {
    id: "challenger",
    name: "Challenger",
    class: "ASSAULT",
    modelPath: `${SHIP_CDN_BASE}/challenger/Challenger.gltf`,
    texturePath: `${SHIP_CDN_BASE}/challenger/Challenger_Blue.png`,
    stats: { speed: 6, armor: 7, cargo: 4, firepower: 8 },
    lore: "Heavy armor, heavier guns. Built for the front line.",
    extraTextures: {
      Fire: `${SHIP_CDN_BASE}/challenger/Challenger_Fire.jpg`,
    },
  },
  {
    id: "dispatcher",
    name: "Dispatcher",
    class: "COURIER",
    modelPath: `${SHIP_CDN_BASE}/dispatcher/Dispatcher.gltf`,
    texturePath: `${SHIP_CDN_BASE}/dispatcher/Dispatcher_Blue.png`,
    stats: { speed: 8, armor: 2, cargo: 6, firepower: 3 },
    lore: "Fastest courier in the sector. No questions asked.",
  },
  {
    id: "executioner",
    name: "Executioner",
    class: "FRIGATE",
    modelPath: `${SHIP_CDN_BASE}/executioner/Executioner.gltf`,
    texturePath: `${SHIP_CDN_BASE}/executioner/Executioner_Blue.png`,
    stats: { speed: 4, armor: 8, cargo: 5, firepower: 9 },
    lore: "A warship that ends arguments. Permanently.",
  },
  {
    id: "imperial",
    name: "Imperial",
    class: "CAPITAL",
    modelPath: `${SHIP_CDN_BASE}/imperial/Imperial.gltf`,
    texturePath: `${SHIP_CDN_BASE}/imperial/Imperial_Blue.png`,
    stats: { speed: 3, armor: 10, cargo: 9, firepower: 7 },
    lore: "Command-class flagship. Fear forged in durasteel.",
  },
  {
    id: "insurgent",
    name: "Insurgent",
    class: "RAIDER",
    modelPath: `${SHIP_CDN_BASE}/insurgent/Insurgent.gltf`,
    texturePath: `${SHIP_CDN_BASE}/insurgent/Insurgent_Blue.png`,
    stats: { speed: 7, armor: 4, cargo: 3, firepower: 7 },
    lore: "Hit hard, vanish fast. Rebel engineering at its finest.",
  },
  {
    id: "omen",
    name: "Omen",
    class: "RECON",
    modelPath: `${SHIP_CDN_BASE}/omen/Omen.gltf`,
    texturePath: `${SHIP_CDN_BASE}/omen/Omen_Blue.png`,
    stats: { speed: 8, armor: 3, cargo: 2, firepower: 5 },
    lore: "Eyes in the void. You won't see it coming.",
  },
  {
    id: "pancake",
    name: "Pancake",
    class: "PATROL",
    modelPath: `${SHIP_CDN_BASE}/pancake/Pancake.gltf`,
    texturePath: `${SHIP_CDN_BASE}/pancake/Pancake_Blue.png`,
    stats: { speed: 6, armor: 6, cargo: 5, firepower: 4 },
    lore: "Low profile, long range. Sector watch standard-issue.",
  },
  {
    id: "spitfire",
    name: "Spitfire",
    class: "FIGHTER",
    modelPath: `${SHIP_CDN_BASE}/spitfire/Spitfire.gltf`,
    texturePath: `${SHIP_CDN_BASE}/spitfire/Spitfire_Blue.png`,
    stats: { speed: 10, armor: 2, cargo: 1, firepower: 6 },
    lore: "Raw speed, zero compromise. Fly or die.",
  },
  {
    id: "zenith",
    name: "Zenith",
    class: "EXPLORER",
    modelPath: `${SHIP_CDN_BASE}/zenith/Zenith.gltf`,
    texturePath: `${SHIP_CDN_BASE}/zenith/Zenith_Blue.png`,
    stats: { speed: 7, armor: 5, cargo: 7, firepower: 3 },
    lore: "Deep-range surveyor built to map the unmapped.",
  },
];

/** Mutable registry for AI-generated community ships */
const COMMUNITY_SHIPS: ShipDef[] = [];

const COMMUNITY_STORAGE_KEY = "ev-community-ships";

/** Persist all community ship configs to localStorage */
function persistCommunityShips(): void {
  try {
    localStorage.setItem(COMMUNITY_STORAGE_KEY, JSON.stringify(COMMUNITY_SHIPS));
  } catch { /* storage full or blocked */ }
}

/** Restore community ships from localStorage on startup.
 *  Call once at module load — ships are available before Engine constructs. */
function restoreCommunityShips(): void {
  try {
    const raw = localStorage.getItem(COMMUNITY_STORAGE_KEY);
    if (!raw) return;
    const defs = JSON.parse(raw) as ShipDef[];
    for (const def of defs) {
      if (!COMMUNITY_SHIPS.some(s => s.id === def.id)) {
        COMMUNITY_SHIPS.push(def);
      }
    }
  } catch { /* corrupt — start fresh */ }
}

// Auto-restore on module load so ships are in catalog before Engine starts
restoreCommunityShips();

/** The default community ship — pre-registered so it's available without a network fetch. */
export const DEFAULT_SHIP_ID = "54a5dd76-3810-4df3-a6e0-4cd222470e78";

// Pre-register the default community ship if it wasn't restored from localStorage
if (!COMMUNITY_SHIPS.some(s => s.id === DEFAULT_SHIP_ID)) {
  COMMUNITY_SHIPS.push({
    id: DEFAULT_SHIP_ID,
    name: "CSV Rusty Hauler",
    class: "COURIER",
    modelPath: `${ASSET_BASE}/forge/${DEFAULT_SHIP_ID}/model.glb`,
    texturePath: "",
    stats: { speed: 6, armor: 7, cargo: 9, firepower: 5 },
    lore: "Budget bulk freighter. Hull shows micrometeor scars, paint flaked to primer. Reliable, if unglamorous.",
    source: "community",
    thumbnailUrl: `${ASSET_BASE}/forge/${DEFAULT_SHIP_ID}/thumb.jpg`,
    heroUrl: `${ASSET_BASE}/forge/${DEFAULT_SHIP_ID}/hero.jpg`,
    creator: "Anashel",
    prompt: "A low budget cargo ship. Rectangle, no detail, limited information, clearly used. Single seat.",
    modelScale: 1.12,
    defaultHardpoints: [
      { type: "thruster", localX: -1.01, localY: -0.02, localZ: 0.01, label: "engine", thrustAngleDeg: -90 },
    ],
    materialConfig: {
      metalness: 0.69,
      roughness: 1,
      emissiveIntensity: 0.13,
      emissiveR: 18,
      emissiveG: 22,
      emissiveB: 38,
    },
  });
}

/** Register a community ship (called from React layer via GameCanvasHandle) */
export function registerCommunityShip(def: ShipDef): void {
  const existing = COMMUNITY_SHIPS.findIndex(s => s.id === def.id);
  if (existing >= 0) {
    // Update existing entry with fresh data from API (model URL, stats, etc.)
    // but preserve user-edited fields (defaultHardpoints, modelScale) if present
    const old = COMMUNITY_SHIPS[existing]!;
    COMMUNITY_SHIPS[existing] = {
      ...def,
      // Keep user-edited hardpoints if the incoming def doesn't have them
      defaultHardpoints: def.defaultHardpoints ?? old.defaultHardpoints,
      modelScale: def.modelScale ?? old.modelScale,
    };
  } else {
    COMMUNITY_SHIPS.push(def);
  }
  persistCommunityShips();
}

/** Replace all community ships (bulk load from catalog API) */
export function setCommunityShips(defs: ShipDef[]): void {
  COMMUNITY_SHIPS.length = 0;
  COMMUNITY_SHIPS.push(...defs);
  persistCommunityShips();
}

/** Update a ship's config in the catalog (e.g. after hardpoint edits).
 *  Persists to localStorage so changes survive reload. */
export function updateShipConfig(shipId: string, updates: Partial<Pick<ShipDef, "defaultHardpoints" | "modelScale" | "materialConfig">>): void {
  const def = COMMUNITY_SHIPS.find(s => s.id === shipId)
    ?? SHIP_CATALOG.find(s => s.id === shipId);
  if (!def) return;
  if (updates.defaultHardpoints !== undefined) def.defaultHardpoints = updates.defaultHardpoints;
  if (updates.modelScale !== undefined) def.modelScale = updates.modelScale;
  if (updates.materialConfig !== undefined) def.materialConfig = updates.materialConfig;
  // Only persist community ships (built-in catalog is static)
  if (COMMUNITY_SHIPS.includes(def)) {
    persistCommunityShips();
  }
}

/** Get all ships (built-in + community) */
export function getAllShips(): ShipDef[] {
  return [...SHIP_CATALOG, ...COMMUNITY_SHIPS];
}

/** Get community ships only */
export function getCommunityShips(): ShipDef[] {
  return [...COMMUNITY_SHIPS];
}

export function getShipDef(id: string): ShipDef | undefined {
  return SHIP_CATALOG.find((s) => s.id === id)
    ?? COMMUNITY_SHIPS.find((s) => s.id === id);
}

/** Build texture path for a ship color — handles CDN URLs, extra textures, and fallback */
export function getShipTexturePath(shipId: string, shipName: string, color: string): string {
  const def = getShipDef(shipId);
  if (def?.extraTextures?.[color]) return def.extraTextures[color];
  return `${SHIP_CDN_BASE}/${shipId}/${shipName}_${color}.png`;
}
