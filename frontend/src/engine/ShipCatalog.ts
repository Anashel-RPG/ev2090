/**
 * Ship catalog — all available player ships from the Quaternius pack.
 * Each ship has a GLTF model, a default Blue texture, and EV-style stats.
 */

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
  /** Custom textures beyond the standard 5 colors (e.g. AI-generated skins) */
  extraTextures?: Record<string, string>;
}

export const SHIP_CATALOG: ShipDef[] = [
  {
    id: "striker",
    name: "Striker",
    class: "INTERCEPTOR",
    modelPath: "/models/striker/Striker.gltf",
    texturePath: "/models/striker/Striker_Blue.png",
    stats: { speed: 9, armor: 3, cargo: 2, firepower: 6 },
  },
  {
    id: "bob",
    name: "Bob",
    class: "UTILITY",
    modelPath: "/models/bob/Bob.gltf",
    texturePath: "/models/bob/Bob_Blue.png",
    stats: { speed: 5, armor: 5, cargo: 8, firepower: 2 },
  },
  {
    id: "challenger",
    name: "Challenger",
    class: "ASSAULT",
    modelPath: "/models/challenger/Challenger.gltf",
    texturePath: "/models/challenger/Challenger_Blue.png",
    stats: { speed: 6, armor: 7, cargo: 4, firepower: 8 },
    extraTextures: {
      Fire: "/models/challenger/Challenger_Fire.jpg",
    },
  },
  {
    id: "dispatcher",
    name: "Dispatcher",
    class: "COURIER",
    modelPath: "/models/dispatcher/Dispatcher.gltf",
    texturePath: "/models/dispatcher/Dispatcher_Blue.png",
    stats: { speed: 8, armor: 2, cargo: 6, firepower: 3 },
  },
  {
    id: "executioner",
    name: "Executioner",
    class: "FRIGATE",
    modelPath: "/models/executioner/Executioner.gltf",
    texturePath: "/models/executioner/Executioner_Blue.png",
    stats: { speed: 4, armor: 8, cargo: 5, firepower: 9 },
  },
  {
    id: "imperial",
    name: "Imperial",
    class: "CAPITAL",
    modelPath: "/models/imperial/Imperial.gltf",
    texturePath: "/models/imperial/Imperial_Blue.png",
    stats: { speed: 3, armor: 10, cargo: 9, firepower: 7 },
  },
  {
    id: "insurgent",
    name: "Insurgent",
    class: "RAIDER",
    modelPath: "/models/insurgent/Insurgent.gltf",
    texturePath: "/models/insurgent/Insurgent_Blue.png",
    stats: { speed: 7, armor: 4, cargo: 3, firepower: 7 },
  },
  {
    id: "omen",
    name: "Omen",
    class: "RECON",
    modelPath: "/models/omen/Omen.gltf",
    texturePath: "/models/omen/Omen_Blue.png",
    stats: { speed: 8, armor: 3, cargo: 2, firepower: 5 },
  },
  {
    id: "pancake",
    name: "Pancake",
    class: "PATROL",
    modelPath: "/models/pancake/Pancake.gltf",
    texturePath: "/models/pancake/Pancake_Blue.png",
    stats: { speed: 6, armor: 6, cargo: 5, firepower: 4 },
  },
  {
    id: "spitfire",
    name: "Spitfire",
    class: "FIGHTER",
    modelPath: "/models/spitfire/Spitfire.gltf",
    texturePath: "/models/spitfire/Spitfire_Blue.png",
    stats: { speed: 10, armor: 2, cargo: 1, firepower: 6 },
  },
  {
    id: "zenith",
    name: "Zenith",
    class: "EXPLORER",
    modelPath: "/models/zenith/Zenith.gltf",
    texturePath: "/models/zenith/Zenith_Blue.png",
    stats: { speed: 7, armor: 5, cargo: 7, firepower: 3 },
  },
];

export function getShipDef(id: string): ShipDef | undefined {
  return SHIP_CATALOG.find((s) => s.id === id);
}
