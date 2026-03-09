/** Core game types for Escape Velocity */

export interface Vec2 {
  x: number;
  y: number;
}

export interface ShipState {
  position: Vec2;
  velocity: Vec2;
  rotation: number; // radians, mesh rotation (0 = facing up)
  heading: number; // radians, physics forward direction (rotation + thrustForwardAngle)
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

export interface DockableInfo {
  planetName: string;
  planetId: string;
}

/** @deprecated — replaced by QuestDialogueLine + QuestCommsState */
export interface QuestMessage {
  id: string;
  sender: string;
  text: string;
  type: "emergency" | "ship" | "system";
  timestamp: number;
}

export interface QuestChoice {
  id: string;
  text: string;
  effect: "progress" | "dismiss" | "flavor";
}

export interface QuestDialogueLine {
  id: string;
  sender: string;
  text: string;
  type: "emergency" | "ship" | "system" | "player";
  timestamp: number;
}

export interface QuestCommsState {
  phase: "IDLE" | "SIGNAL_DETECTED" | "APPROACHING" | "ARRIVED" | "RESCUED" | "FADING" | "COMPLETE";
  hasIncomingTransmission: boolean;
  signalStrength: number;
  distanceToTarget: number;
  transcript: QuestDialogueLine[];
  signalWeak: boolean;
  targetName: string;
  objective: string;
  rescuable: boolean;
  controlsLocked: boolean;
}

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

export type ScreenStateId =
  | "gameplay"
  | "planet_docking"
  | "mission_dialogue"
  | "cinematic";

export interface GameState {
  ship: ShipState;
  navigation: NavigationInfo;
  target: TargetInfo;
  radarContacts: RadarContact[];
  fps: number;
  currentShipId: string;
  currentShipColor: ShipColor;
  dockable: DockableInfo | null;
  docked: boolean;
  questComms: QuestCommsState | null;
  questRescueCta: { screenX: number; screenY: number } | null;
  screenState: ScreenStateId;
  /** Letterbox bar height (0 = none). Pushed from hero camera during dock transitions. */
  heroLetterbox: number;
  /** True once the current ship's 3D model (GLTF/GLB) has finished loading */
  shipModelLoaded: boolean;
  /** True when FPV cockpit camera is active */
  fpv: boolean;
  /** FPV transition progress (0 = top-down, 1 = fully FPV). Drives smooth UI transitions. */
  fpvTransition: number;
  /** True when bridge interior camera is active (Phase 2 of COMM mode) */
  bridgeActive: boolean;
  /** Bridge transition progress (0 = FPV behind-ship, 1 = inside bridge) */
  bridgeTransition: number;
  /** NPC name in comm view (null = not in comm view). Drives "Exit Comm View" UI. */
  commViewTarget: string | null;
}

// ─── Hero Shot & Authoring Types ───

export interface HeroSubject {
  type: "ship" | "planet";
  id: string;
}

export interface HeroShotConfig {
  zoom: number;              // ortho zoom factor (same as gameplay zoom)
  panX: number;              // world-space camera X offset from subject
  panY: number;              // world-space camera Y offset from subject
  bloomStrength: number;     // 0-5
  bloomRadius: number;       // 0-2
  bloomThreshold: number;    // 0-1.5
  vignetteIntensity: number; // 0-2
  vignetteSoftness: number;  // 0-1
  letterbox: number;         // 0-1, cinematic black bars (0 = none, 1 = full)
  brightness: number;        // 0.5-2.0
  contrast: number;          // 0.5-2.0
  exposure: number;          // 0.1-3.0
}

// ─── Ship Hardpoint Types ───

export type HardpointType = "thruster" | "weapon" | "bridge" | "hull" | "shield";

export interface Hardpoint {
  id: string;
  type: HardpointType;
  localX: number;
  localY: number;
  localZ: number;
  label?: string;
  /** Thrust flame direction in degrees (thruster-only). 0 = -Y (default behind). */
  thrustAngleDeg?: number;
}

export interface ShipHardpoints {
  shipId: string;
  points: Hardpoint[];
}

// ─── Mission Engine Types ───

export interface MissionDialogueLine {
  sender: string;
  text: string;
  type: "emergency" | "ship" | "system" | "player";
  delay: number;
}

export interface MissionExitCondition {
  trigger: "timer" | "proximity" | "action" | "animation-complete";
  delay?: number;
  range?: number;
  action?: string;
}

export interface MissionPhaseDef {
  id: string;
  objective: string;
  dialogue?: MissionDialogueLine[];
  timedMessages?: { sender: string; text: string; type: MissionDialogueLine["type"]; at: number }[];
  spawnNpcAt?: number;
  incomingTransmission?: boolean;
  rescuable?: boolean;
  lockControls?: boolean;
  animation?: string;
  animationParams?: Record<string, number>;
  npcFadeOut?: boolean;
  lingerDuration?: number;
  exit: MissionExitCondition;
}

export interface MissionNpcDef {
  id: string;
  name: string;
  shipId: string;
  color: string;
  spawnMethod: "random-near-planet";
  spawnDistance: number;
}

export interface MissionDef {
  id: string;
  name: string;
  description: string;
  storageKey: string;
  npc: MissionNpcDef;
  phases: MissionPhaseDef[];
  rewards?: { credits?: number; reputation?: number };
}

export const INITIAL_GAME_STATE: GameState = {
  ship: {
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    heading: 0,
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
  currentShipId: "54a5dd76-3810-4df3-a6e0-4cd222470e78",
  currentShipColor: "Blue",
  dockable: null,
  docked: false,
  questComms: null,
  questRescueCta: null,
  screenState: "gameplay",
  heroLetterbox: 0,
  shipModelLoaded: false,
  fpv: false,
  fpvTransition: 0,
  bridgeActive: false,
  bridgeTransition: 0,
  commViewTarget: null,
};
