/** Core game types for Escape Velocity */

export interface Vec2 {
  x: number;
  y: number;
}

export interface ShipState {
  position: Vec2;
  velocity: Vec2;
  rotation: number; // radians, 0 = facing up
  thrust: number; // 0-1
  shields: number; // 0-1
  armor: number; // 0-1
  fuel: number; // 0-1
}

export interface RadarContact {
  id: string;
  position: Vec2;
  type: "planet" | "station" | "ship" | "asteroid";
  name: string;
  hostile: boolean;
}

export interface NavigationInfo {
  systemName: string;
  coordinates: Vec2;
  nearestPlanet: string | null;
  nearestDistance: number | null;
}

export interface TargetData {
  name: string;
  type: string;
  distance: number;
  shields: number;
  armor: number;
}

export type TargetInfo = TargetData | null;

export interface LightConfig {
  ambient: { intensity: number };
  hemisphere: { intensity: number };
  keyLight: { intensity: number; x: number; y: number; z: number };
  fillLight: { intensity: number; x: number; y: number; z: number };
  rimLight: { intensity: number; x: number; y: number; z: number };
  material: { metalness: number; roughness: number; emissiveIntensity: number };
}

export const SHIP_COLORS = ["Blue", "Green", "Orange", "Purple", "Red"] as const;
/** All possible colors including custom textures */
export const ALL_COLORS = [...SHIP_COLORS, "Fire"] as const;
export type ShipColor = (typeof ALL_COLORS)[number];

export interface GameState {
  ship: ShipState;
  navigation: NavigationInfo;
  target: TargetInfo;
  radarContacts: RadarContact[];
  fps: number;
  currentShipId: string;
  currentShipColor: ShipColor;
}

export const INITIAL_GAME_STATE: GameState = {
  ship: {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    thrust: 0,
    shields: 1,
    armor: 1,
    fuel: 0.85,
  },
  navigation: {
    systemName: "Sol",
    coordinates: { x: 0, y: 0 },
    nearestPlanet: "Earth",
    nearestDistance: 42.5,
  },
  target: null,
  radarContacts: [],
  fps: 0,
  currentShipId: "striker",
  currentShipColor: "Blue",
};
