import * as THREE from "three";
import { Ship } from "./entities/Ship";
import { Planet } from "./entities/Planet";
import { Starfield } from "./systems/Starfield";
import { NebulaBg } from "./systems/NebulaBg";
import { InputManager } from "./systems/InputManager";
import { CameraController, type DebugView } from "./systems/CameraController";
import { ModelCache } from "./systems/ModelCache";
import { SoundManager } from "./systems/SoundManager";
import { SHIP_CATALOG, getShipDef, getShipTexturePath, updateShipConfig } from "./ShipCatalog";
import { generatePlanetTexture } from "./systems/PlanetTextureGen";
import { LightingSetup } from "./systems/LightingSetup";
import { NpcManager } from "./systems/NpcManager";
import { NpcShip } from "./entities/NpcShip";
import { DebugBeam } from "./systems/DebugBeam";
import { OrbitControls } from "./systems/OrbitControls";
import { MissionEngine } from "./systems/MissionEngine";
import solaceDistress from "@/data/missions/solace-distress.json";
import type { MissionDef } from "@/types/game";
import { PostProcessing } from "./systems/PostProcessing";
import { HeroCamera } from "./systems/HeroCamera";
import { HardpointEditor } from "./systems/HardpointEditor";
import { HERO_PRESETS, DEFAULT_PLANET_PRESET, DEFAULT_SHIP_PRESET } from "@/data/heroPresets";
import { CDN_BASE, ASSET_BASE } from "@/config/urls";
import type { GameState, RadarContact, LightConfig, ShipColor, DockableInfo, Hardpoint, HardpointType, HeroSubject, HeroShotConfig } from "@/types/game";

/**
 * Core game engine — orchestrates the Three.js scene, game loop, and all subsystems.
 *
 * Architecture:
 *   Renderer + Scene + Camera form the rendering backbone.
 *   Subsystems are instantiated in the constructor and updated each frame.
 *   React never touches the engine directly — communication flows through
 *   the `subscribe()` callback (engine → React) and public methods (React → engine).
 *
 * Subsystems (initialized in constructor order):
 *   LightingSetup   — ambient, hemisphere, key/fill/rim lights
 *   CameraController — perspective follow-cam, debug views, zoom, FPV
 *   InputManager     — keyboard + touch input
 *   Starfield        — parallax star background
 *   NebulaBg         — nebula background layer
 *   NpcManager       — NPC ship spawning, traffic simulation, scanner cone
 *   MissionEngine    — JSON-driven quest state machine (early scaffolding)
 *   DebugBeam        — scanner beam visualization (dev tool)
 *   OrbitControls    — free camera orbit (dev tool)
 *   PostProcessing   — bloom, vignette, color correction via EffectComposer
 *   HeroCamera       — cinematic camera for docking + authoring (dev tool)
 *   HardpointEditor  — ship annotation/hardpoint placement (dev tool)
 *
 * Game loop (`loop()`):
 *   1. Player input → ship update (skipped when docked/editor active)
 *   2. Planet rotation
 *   3. NPC traffic + scanner detection
 *   4. Mission/quest update
 *   5. Debug beam
 *   6. Sound
 *   7. Camera follow + hero camera effects
 *   8. Render (always via EffectComposer)
 *   9. Push GameState to React every 3rd frame (~20fps)
 */

// ─── Sound URLs ───

const SFX_THRUSTER = `${CDN_BASE}/sound/thurster.mp3`;
const SFX_PING = `${CDN_BASE}/sound/ping.mp3`;
const SFX_MAYDAY = `${CDN_BASE}/sound/mayday.mp3`;

// ─── Color Correction Defaults ───
// Tuned for the EffectComposer pipeline — compensates for the slight contrast
// loss that EffectComposer introduces vs direct renderer.render().
const DEFAULT_BRIGHTNESS = 1.34;
const DEFAULT_CONTRAST = 0.98;
const DEFAULT_EXPOSURE = 1.16;

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraController: CameraController;
  private input: InputManager;
  private starfield: Starfield;
  private nebulaBg: NebulaBg;
  private ship: Ship;
  private planets: Planet[] = [];

  // Extracted subsystems
  private lighting: LightingSetup;
  private npcManager: NpcManager;
  private debugBeam: DebugBeam;
  private orbitControls: OrbitControls;
  private missionEngine: MissionEngine;
  private postProcessing: PostProcessing;
  private heroCamera: HeroCamera;
  private hardpointEditor: HardpointEditor;
  private animationId: number | null = null;
  private lastTime = 0;
  private frameCount = 0;
  private fpsTime = 0;
  private currentFps = 0;
  currentShipId = "striker";
  currentShipColor: ShipColor = "Blue";
  /** Cached hardpoint editor state so re-entering restores last edits.
   *  Persisted to localStorage under "ev-hardpoints" for cross-session survival. */
  private lastHardpointEdits: Map<string, { hardpoints: Hardpoint[]; scale: number; headingRad: number }> = new Map();

  // Sound state
  private thrusterPlaying = false;
  private maydaySoundPlayed = false;

  // Hero mode: saved ship heading for restore on exit
  private savedShipRotation: number | null = null;

  // Saved gameplay color correction — restored on hero exit
  private savedColorCorrection = {
    brightness: DEFAULT_BRIGHTNESS,
    contrast: DEFAULT_CONTRAST,
    exposure: DEFAULT_EXPOSURE,
  };

  // Ship orientation animation — runs in parallel with heroCamera transitions
  // Used for both enter (gameplay → preset) and exit (preset → gameplay)
  private shipOrientAnim: {
    fromHeading: number;
    fromTilt: number;
    fromRoll: number;
    fromScale: number;
    toHeading: number;
    toTilt: number;
    toRoll: number;
    toScale: number;
    elapsed: number;
    duration: number;
  } | null = null;

  // Dock state
  private isDocked = false;

  // FPV ship banking — visual roll based on turn rate
  private prevHeading = 0;
  private smoothTurnRate = 0;

  // ─── FPV Post-Processing Config ───
  // Target post-processing values for FPV mode (lerped during transition).
  // Tunable via the FPV config panel; baked into the transition curve.
  private fpvPostConfig = {
    vignetteIntensity: 0.45,
    vignetteSoftness: 0.11,
    bloomStrength: 0.11,
    bloomRadius: 0.81,
    bloomThreshold: 0,
    brightness: 1.51,
    contrast: 1.06,
    exposure: 1.59,
    // FPV light overrides — lerped during transition (intensity + position)
    ambientIntensity: 0,
    hemisphereIntensity: 0.5,
    keyLightIntensity: 6.9,
    fillLightIntensity: 0,
    rimLightIntensity: 2.5,
    keyLightX: 71, keyLightY: 60, keyLightZ: 66,
    fillLightX: -5, fillLightY: -20, fillLightZ: 60,
    rimLightX: 27, rimLightY: 21, rimLightZ: 0,
    // FPV-only edge light — off in gameplay, fades in during FPV transition
    fpvLightIntensity: 4,
    fpvLightX: -40, fpvLightY: -30, fpvLightZ: -20,
  };
  // Gameplay post-processing baseline (top-view defaults)
  private gameplayPostConfig = {
    vignetteIntensity: 0,
    vignetteSoftness: 0,
    bloomStrength: 0.41,
    bloomRadius: 1.62,
    bloomThreshold: 0.69,
    brightness: DEFAULT_BRIGHTNESS,
    contrast: DEFAULT_CONTRAST,
    exposure: DEFAULT_EXPOSURE,
  };
  // Gameplay light baseline — captured from initial lighting values
  private gameplayLightConfig = {
    ambientIntensity: 0,
    hemisphereIntensity: 0.5,
    keyLightIntensity: 6.9,
    fillLightIntensity: 0,
    rimLightIntensity: 2.5,
    keyLightX: 71, keyLightY: 60, keyLightZ: 66,
    fillLightX: -5, fillLightY: -20, fillLightZ: 60,
    rimLightX: 27, rimLightY: 21, rimLightZ: 0,
    // FPV edge light — off in gameplay (0), so the lerp brings it from 0 to fpvPostConfig target
    fpvLightIntensity: 0,
    fpvLightX: -40, fpvLightY: -30, fpvLightZ: -20,
  };

  // ─── Comm Mode State ───
  // Theatrical FPV entry: player approaches a clicked NPC, both ships face each other.
  private commState: {
    npcId: string;
    npcName: string;
    phase: "approaching" | "settled" | "exiting";
    startPos: { x: number; y: number };
    targetPos: { x: number; y: number };
    startRot: number;
    targetRot: number;
    npcStartRot: number;
    npcTargetRot: number;
    approachT: number; // 0→1 during approach choreography
  } | null = null;
  private commLetterbox = 0; // 0-1, drives cinematic bars

  // ─── Bridge Interior Post-FX Config ───
  // Lerped from fpvPostConfig → bridgePostConfig during bridgeTransition.
  // Bridge has baked lighting, but we keep scene lights ON for the space
  // visible through windows. Only slightly adjust atmosphere.
  private bridgePostConfig = {
    vignetteIntensity: 0.55,
    vignetteSoftness: 0.08,
    bloomStrength: 0.15,
    bloomRadius: 0.9,
    bloomThreshold: 0.1,
    brightness: 1.51,
    contrast: 1.06,
    exposure: 1.59,
    // Keep scene lights similar to FPV — space is visible through windows
    ambientIntensity: 0,
    hemisphereIntensity: 0.5,
    keyLightIntensity: 6.9,
    fillLightIntensity: 0,
    rimLightIntensity: 2.5,
    keyLightX: 71, keyLightY: 60, keyLightZ: 66,
    fillLightX: -5, fillLightY: -20, fillLightZ: 60,
    rimLightX: 27, rimLightY: 21, rimLightZ: 0,
    // FPV edge light can stay (backlights ships through windows)
    fpvLightIntensity: 4,
    fpvLightX: -40, fpvLightY: -30, fpvLightZ: -20,
  };
  // Previous bridgeTransition value for hull flash trigger detection
  private prevBridgeTransition = 0;
  // Hull flash state
  private hullFlashActive = false;

  // Sidebar pixel width — used to center ship in playable area via camera offset
  private sidebarWidthPx = 0;

  private canvas: HTMLCanvasElement;

  private onStateUpdate: ((state: GameState) => void) | null = null;
  private container: HTMLElement;

  // ─── Hardpoint Persistence Helpers ───

  private static readonly HARDPOINT_STORAGE_KEY = "ev-hardpoints";

  /** Save all hardpoint edits to localStorage */
  private persistHardpointEdits() {
    try {
      const obj: Record<string, { hardpoints: Hardpoint[]; scale: number; headingRad: number }> = {};
      this.lastHardpointEdits.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(Engine.HARDPOINT_STORAGE_KEY, JSON.stringify(obj));
    } catch { /* storage full or blocked — silently fail */ }
  }

  /** Restore hardpoint edits from localStorage into the in-memory cache (DEV preview only) */
  private restoreHardpointEdits() {
    if (!import.meta.env.DEV) return; // localStorage edits are dev-only; production uses SHIP_CONFIG_OVERRIDES
    try {
      const raw = localStorage.getItem(Engine.HARDPOINT_STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<string, { hardpoints: Hardpoint[]; scale: number; headingRad: number }>;
      for (const [k, v] of Object.entries(obj)) {
        this.lastHardpointEdits.set(k, v);
      }
    } catch { /* corrupt or unavailable — start fresh */ }
  }

  /**
   * Create the engine, initialize all subsystems, and start the game loop.
   * @param canvas  The <canvas> element to render into
   * @param container  The parent container (used for sizing)
   */
  constructor(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.container = container;
    this.canvas = canvas;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // ─── Renderer ───
    // Create WebGL2 context first to avoid FLIP_Y 3D texture warning
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
    }) as WebGL2RenderingContext;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x05050a);
    // Tone mapping — matches ShipShowcase/ShipDetailRenderer for consistent look.
    // Without this, baked textures render flat/dark (NoToneMapping is the default).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    // Shadow maps (no lights cast shadows by default — bridge editor opts in)
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Scene
    this.scene = new THREE.Scene();

    // ─── Lighting ───
    this.lighting = new LightingSetup(this.scene);

    // ─── Camera ───
    this.cameraController = new CameraController(width, height);

    // ─── Input ───
    this.input = new InputManager();
    this.starfield = new Starfield(this.scene);

    // ─── Background ───
    this.nebulaBg = new NebulaBg();
    this.scene.add(this.nebulaBg.group);

    // ─── Player Ship ───
    this.ship = new Ship();
    this.ship.setTilt((-22 * Math.PI) / 180);
    this.scene.add(this.ship.mesh);

    // Wire up lighting to ship and nebula
    this.lighting.setShip(this.ship);
    this.lighting.setNebulaBg(this.nebulaBg);

    // ─── NPC Traffic ───
    this.npcManager = new NpcManager(this.scene);

    // ─── Mission Engine (JSON-driven quest state machine) ───
    this.missionEngine = new MissionEngine(this.scene);
    this.missionEngine.loadMission(solaceDistress as MissionDef);

    // ─── Dev Tools ───
    this.debugBeam = new DebugBeam(this.scene);
    this.orbitControls = new OrbitControls(this.canvas, this.cameraController);
    this.orbitControls.attach();

    // ─── Post-Processing ───
    // Always on so there is NEVER a rendering-pipeline switch (EffectComposer
    // vs direct renderer). Individual passes (bloom, vignette) auto-disable
    // when their values are zero, keeping GPU cost near-zero during gameplay.
    this.postProcessing = new PostProcessing(this.renderer, this.scene, this.cameraController.getActiveCamera());
    this.postProcessing.setBloomStrength(0);
    this.postProcessing.setBloomRadius(0);
    this.postProcessing.setBloomThreshold(1.0);
    this.postProcessing.setVignetteIntensity(0);
    // Color correction defaults (see named constants at top of file)
    this.postProcessing.setBrightness(DEFAULT_BRIGHTNESS);
    this.postProcessing.setContrast(DEFAULT_CONTRAST);
    this.postProcessing.setExposure(DEFAULT_EXPOSURE);
    this.postProcessing.enabled = true;

    // ─── Authoring Tools ───
    this.heroCamera = new HeroCamera();
    this.hardpointEditor = new HardpointEditor(this.scene, canvas);

    // ─── Solar System: multiple planets ───

    const planetConfigs = [
      {
        name: "Nexara",
        position: { x: 25, y: 15 },
        radius: 6,
        texturePath: `${ASSET_BASE}/textures/planet-earth.jpg`,
        rotationSpeed: 0.08,
        atmosphereColor: 0x3399bb,
      },
      {
        name: "Velkar",
        position: { x: -55, y: -40 },
        radius: 4,
        canvasTexture: generatePlanetTexture("mars"),
        rotationSpeed: 0.06,
        atmosphereColor: 0xff6633,
      },
      {
        name: "Zephyra",
        position: { x: 95, y: -65 },
        radius: 9,
        canvasTexture: generatePlanetTexture("neptune"),
        rotationSpeed: 0.03,
        atmosphereColor: 0x44aaff,
      },
      {
        name: "Arctis",
        position: { x: 40, y: 32 },
        radius: 2,
        canvasTexture: generatePlanetTexture("luna"),
        rotationSpeed: 0.04,
        atmosphereColor: 0x666666,
      },
    ];

    for (const cfg of planetConfigs) {
      const planet = new Planet(cfg);
      this.planets.push(planet);
      this.scene.add(planet.mesh);
    }

    // Share planet data with NPCs for avoidance steering
    NpcShip.allPlanets = this.planets.map((p) => ({
      position: p.position,
      radius: p.radius,
    }));

    // ─── FPV edge light isolation ───
    // Register planet + ship meshes with PostProcessing so the FPV edge light
    // only illuminates ships (two-pass rendering). Ship meshes use a callback
    // because NPC ships spawn/despawn dynamically.
    this.postProcessing.setFpvLightExclusions(
      this.lighting.getFpvLight(),
      () => [this.ship.mesh, ...this.npcManager.getNpcs().map((n) => n.mesh)],
      this.planets.map((p) => p.mesh),
    );

    // Pre-load all ship GLTF models so spawns are instant (no frame stutter)
    ModelCache.preloadModels([
      ...SHIP_CATALOG.map((s) => s.modelPath),
      `${ASSET_BASE}/bridge/bridge.glb`, // Bridge interior for COMM mode
    ]);

    // Pre-load sound effects
    SoundManager.preload(SFX_PING);
    SoundManager.preload(SFX_THRUSTER);

    // ─── Event Listeners ───
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("keydown", this.handleDebugKeys); // B = toggle beam
    this.canvas.addEventListener("click", this.handleCanvasClick); // click NPC → comm view
    this.canvas.addEventListener("mousemove", this.handleCanvasMouseMove); // hover cursor

    // Expose engine on window for console inspection (window.__engine)
    (window as unknown as Record<string, unknown>).__engine = this;

    // Restore any saved hardpoint edits from localStorage
    this.restoreHardpointEdits();

    // ─── Start Game Loop ───
    this.lastTime = performance.now();
    this.fpsTime = this.lastTime;
    this.loop(this.lastTime);
  }

  /** Subscribe to game state updates (called ~60fps) */
  subscribe(callback: (state: GameState) => void) {
    this.onStateUpdate = callback;
  }

  /** Player clicked the rescue CTA — trigger rescue sequence */
  triggerQuestRescue() {
    this.missionEngine.triggerRescue();
    // Zero velocity when rescue starts
    this.ship.state.velocity = { x: 0, y: 0 };
    this.ship.state.thrust = 0;
  }

  /** Start the quest timer — called once intro screen is dismissed */
  startQuest() {
    this.missionEngine.start();
  }

  // ─── Dock / Undock API ───

  /** Dock at the nearest planet — freeze ship */
  dock() {
    this.isDocked = true;
    this.ship.state.velocity = { x: 0, y: 0 };
    this.ship.state.thrust = 0;
    // Exit FPV if active — docking uses hero camera
    if (this.cameraController.isFpvActive()) {
      this.cameraController.toggleFpv();
    }
  }

  /** Undock — unfreeze ship with a gentle drift outward */
  undock() {
    this.isDocked = false;

    // Small outward nudge from nearest planet
    let nearest: Planet | null = null;
    let nearestDist = Infinity;
    for (const planet of this.planets) {
      const dist = planet.distanceTo(this.ship.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = planet;
      }
    }
    if (nearest) {
      const dx = this.ship.position.x - nearest.position.x;
      const dy = this.ship.position.y - nearest.position.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      this.ship.state.velocity = { x: (dx / len) * 3, y: (dy / len) * 3 };
    }
  }

  /** Repair shields and armor to full */
  repairShip() {
    this.ship.state.shields = 1;
    this.ship.state.armor = 1;
  }

  /** Refuel to full */
  refuelShip() {
    this.ship.state.fuel = 1;
  }

  // ─── Ship Management API ───

  /** Switch to a different ship model (preserves position/velocity) */
  changeShip(shipId: string) {
    const shipDef = getShipDef(shipId);
    if (!shipDef || shipId === this.currentShipId) return;

    const hasEmbeddedTextures = shipDef.source === "community" || !shipDef.texturePath;

    // Ships with embedded textures have no color variants — reset to Blue label
    if (hasEmbeddedTextures) {
      this.currentShipColor = "Blue";
    } else {
      // If current color is a custom texture not available on the new ship, fall back to Blue
      const isCustomColor = !["Blue", "Green", "Orange", "Purple", "Red"].includes(this.currentShipColor);
      if (isCustomColor && !shipDef.extraTextures?.[this.currentShipColor]) {
        this.currentShipColor = "Blue";
      }
    }

    const savedState = { ...this.ship.state };
    this.scene.remove(this.ship.mesh);
    this.ship.dispose();

    // Ships with embedded PBR textures (community or GLB with baked materials) — no separate texture path
    const texturePath = hasEmbeddedTextures ? undefined : this.getTexturePath(shipId, shipDef.name, this.currentShipColor);

    // ─── Thruster source: catalog defaults (source of truth) > localStorage (dev cache) > heading fallback ───
    // SHIP_CONFIG_OVERRIDES baked into the game code is the source of truth.
    // localStorage edits are a DEV-ONLY cache for previewing changes before committing to code.
    let thrusterPositions: { x: number; y: number; z: number; thrustAngleDeg?: number }[] | undefined;
    let modelScale = shipDef.modelScale;
    let needsHeadingThruster = false;

    // 1. Primary: catalog defaultHardpoints (from SHIP_CONFIG_OVERRIDES — deployed to all users)
    const thrusterHps = shipDef.defaultHardpoints?.filter((h) => h.type === "thruster");
    if (thrusterHps && thrusterHps.length > 0) {
      thrusterPositions = thrusterHps.map((h) => ({
        x: h.localX, y: h.localY, z: h.localZ,
        thrustAngleDeg: (h as { thrustAngleDeg?: number }).thrustAngleDeg,
      }));
    }

    // 2. Fallback (DEV only): localStorage hardpoint edits for ships not yet in SHIP_CONFIG_OVERRIDES
    if (!thrusterPositions && import.meta.env.DEV) {
      const savedEdits = this.lastHardpointEdits.get(shipId);
      const savedThrusterHps = savedEdits?.hardpoints.filter(h => h.type === "thruster");
      if (savedThrusterHps && savedThrusterHps.length > 0) {
        thrusterPositions = savedThrusterHps.map(h => ({
          x: h.localX, y: h.localY, z: h.localZ,
          thrustAngleDeg: h.thrustAngleDeg,
        }));
        if (savedEdits!.scale != null) modelScale = savedEdits!.scale;
      }
    }

    // 3. Final fallback: heading-compensated thruster for community ships with no explicit config
    if (!thrusterPositions) {
      needsHeadingThruster = !shipDef.thrusterPos && !!shipDef.defaultHeadingDeg;
      if (needsHeadingThruster) {
        thrusterPositions = [{ x: 0, y: -1.6, z: 0, thrustAngleDeg: shipDef.defaultHeadingDeg }];
      }
    }

    this.ship = new Ship({
      modelPath: shipDef.modelPath,
      texturePath,
      modelScale,
      modelHeadingDeg: shipDef.defaultHeadingDeg,
      thrusterPos: shipDef.thrusterPos,
      thrusterPositions,
      materialConfig: shipDef.materialConfig,
    });

    this.ship.state = { ...savedState, shields: 1, armor: 1, heading: 0 };
    this.ship.setTilt((-22 * Math.PI) / 180);

    this.scene.add(this.ship.mesh);
    this.currentShipId = shipId;

    // Update lighting reference to new ship
    this.lighting.setShip(this.ship);

  }

  /** Change ship color texture */
  changeShipColor(color: ShipColor) {
    if (color === this.currentShipColor) return;
    const shipDef = getShipDef(this.currentShipId);
    if (!shipDef) return;

    // Ships with embedded textures have no color variants
    if (shipDef.source === "community" || !shipDef.texturePath) return;

    const texturePath = this.getTexturePath(this.currentShipId, shipDef.name, color);
    this.ship.changeTexture(texturePath);
    this.currentShipColor = color;
  }

  /** Build texture path — handles custom textures (e.g. Challenger Fire) */
  private getTexturePath(shipId: string, shipName: string, color: ShipColor): string {
    return getShipTexturePath(shipId, shipName, color);
  }

  // ─── Light Debug API ───

  /** Get current light configuration for debug panel */
  getLightConfig(): LightConfig {
    return this.lighting.getLightConfig();
  }

  /** Update a single light property in real time */
  updateLight(lightName: string, property: string, value: number) {
    // Color correction + post-processing — routed to PostProcessing, not LightingSetup.
    // All changes are synced to gameplayPostConfig so they persist through FPV transitions.
    if (lightName === "colorCorrection") {
      if (property === "brightness") { this.postProcessing.setBrightness(value); this.gameplayPostConfig.brightness = value; }
      if (property === "contrast") { this.postProcessing.setContrast(value); this.gameplayPostConfig.contrast = value; }
      if (property === "exposure") { this.postProcessing.setExposure(value); this.gameplayPostConfig.exposure = value; }
      if (property === "bloomStrength") { this.postProcessing.setBloomStrength(value); this.gameplayPostConfig.bloomStrength = value; }
      if (property === "bloomRadius") { this.postProcessing.setBloomRadius(value); this.gameplayPostConfig.bloomRadius = value; }
      if (property === "bloomThreshold") { this.postProcessing.setBloomThreshold(value); this.gameplayPostConfig.bloomThreshold = value; }
      if (property === "vignetteIntensity") { this.postProcessing.setVignetteIntensity(value); this.gameplayPostConfig.vignetteIntensity = value; }
      if (property === "vignetteSoftness") { this.postProcessing.setVignetteSoftness(value); this.gameplayPostConfig.vignetteSoftness = value; }
      return;
    }
    this.lighting.updateLight(lightName, property, value);

    // Sync light changes to gameplay baseline so they persist through FPV
    if (property === "intensity") {
      const map: Record<string, keyof typeof this.gameplayLightConfig> = {
        ambient: "ambientIntensity",
        hemisphere: "hemisphereIntensity",
        keyLight: "keyLightIntensity",
        fillLight: "fillLightIntensity",
        rimLight: "rimLightIntensity",
        fpvLight: "fpvLightIntensity",
      };
      const key = map[lightName];
      if (key) this.gameplayLightConfig[key] = value;
    }
    // Sync light position changes to gameplay baseline
    if (property === "x" || property === "y" || property === "z") {
      const posKey = `${lightName}${property.toUpperCase()}` as keyof typeof this.gameplayLightConfig;
      if (posKey in this.gameplayLightConfig) {
        (this.gameplayLightConfig as Record<string, number>)[posKey] = value;
      }
    }
  }

  /** Update ship material properties in real time */
  updateShipMaterial(property: string, value: number) {
    this.lighting.updateShipMaterial(property, value);
  }

  // ─── Debug Inspection API ───

  /** Switch between debug camera views */
  setDebugView(view: DebugView) {
    if (view === "orbit") {
      // Lock orbit onto nearest NPC (e.g. a test ship), or player if none exist
      const npcs = this.npcManager.getNpcs();
      let nearest: { id: string; x: number; y: number } | null = null;
      let nearestDist = Infinity;
      for (const npc of npcs) {
        const dx = npc.position.x - this.ship.position.x;
        const dy = npc.position.y - this.ship.position.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = { id: npc.id, x: npc.position.x, y: npc.position.y };
        }
      }
      if (nearest) {
        this.orbitControls.setTargetId(nearest.id);
        this.cameraController.setOrbitCenter(nearest.x, nearest.y);
      } else {
        this.orbitControls.setTargetId(null);
        this.cameraController.setOrbitCenter(this.ship.position.x, this.ship.position.y);
      }
    } else {
      this.orbitControls.setTargetId(null);
    }
    this.cameraController.setDebugView(view);
    // Update cursor for orbit mode
    this.canvas.style.cursor = view === "orbit" ? "grab" : "";
  }

  getDebugView(): DebugView {
    return this.cameraController.getDebugView();
  }

  /** Toggle the visible scan beam line */
  setBeamVisible(visible: boolean) {
    this.debugBeam.setVisible(visible);
  }

  isBeamVisible(): boolean {
    return this.debugBeam.isVisible();
  }

  // ─── Camera Zoom & Offset API ───

  setZoom(factor: number) {
    this.cameraController.setZoom(factor);
  }

  getZoom(): number {
    return this.cameraController.getZoom();
  }

  setCameraOffset(x: number, y: number) {
    this.cameraController.setManualOffset(x, y);
  }

  getCameraOffset(): { x: number; y: number } {
    return this.cameraController.getManualOffset();
  }

  getShipCatalog() {
    return SHIP_CATALOG;
  }

  /** Get current background opacities for config panel */
  getBackgroundConfig() {
    return {
      imageOpacity: this.nebulaBg.getImageOpacity(),
      nebulaOpacity: this.nebulaBg.getNebulaOpacity(),
    };
  }

  // ─── Game Loop ───

  /** Main game loop — called every frame via requestAnimationFrame */
  private loop = (time: number) => {
    this.animationId = requestAnimationFrame(this.loop);

    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;

    this.frameCount++;
    if (time - this.fpsTime >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.fpsTime = time;
    }

    // Skip player input when docked, quest locked, authoring tools active, or comm mode
    const questLocked = this.missionEngine.isControlsLocked();
    const editorActive = this.hardpointEditor.isActive() || this.heroCamera.isActive();
    if (!this.isDocked && !questLocked && !editorActive && !this.commState) {
      this.ship.update(dt, this.input.state);

      // FPV planet collision — direction-aware blocking.
      // Only cancels velocity heading TOWARD the planet; tangential movement is free.
      // Hard boundary prevents "digging in" — snaps to safe distance when too close.
      const currentFpvT = this.cameraController.getFpvTransition();
      if (currentFpvT > 0) {
        for (const planet of this.planets) {
          const dx = this.ship.state.position.x - planet.position.x;
          const dy = this.ship.state.position.y - planet.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const hardRadius = planet.radius * 1.3; // can't cross this boundary
          const softRadius = planet.radius * 2.0; // start decelerating here

          if (dist < softRadius && dist > 0) {
            // Unit vector from planet → ship
            const nx = dx / dist;
            const ny = dy / dist;

            // Velocity component toward the planet (negative = approaching)
            const velDot = this.ship.state.velocity.x * nx + this.ship.state.velocity.y * ny;

            if (velDot < 0) {
              // Only remove the toward-planet component; tangential speed is untouched
              const decelFactor = Math.max(0, (dist - hardRadius) / (softRadius - hardRadius));
              const cancelAmount = velDot * (1 - decelFactor);
              this.ship.state.velocity.x -= nx * cancelAmount;
              this.ship.state.velocity.y -= ny * cancelAmount;
            }

            // Hard boundary: snap to safe distance (no digging)
            if (dist < hardRadius) {
              this.ship.state.position.x = planet.position.x + nx * hardRadius;
              this.ship.state.position.y = planet.position.y + ny * hardRadius;
              // Zero out any remaining toward-planet velocity
              const velDot2 = this.ship.state.velocity.x * nx + this.ship.state.velocity.y * ny;
              if (velDot2 < 0) {
                this.ship.state.velocity.x -= nx * velDot2;
                this.ship.state.velocity.y -= ny * velDot2;
              }
            }
          }
        }
      }
    }

    for (const planet of this.planets) {
      planet.update(dt);
    }

    // NPC update (scanner detection, spawning, removal)
    // Pass FPV transition so scanner/shield are suppressed in cockpit view
    const fpvTForScan = this.cameraController.getFpvTransition();
    const { fwdX, fwdY, px, py } = this.npcManager.update(dt, this.ship, this.planets, fpvTForScan);

    // Quest update — play mayday SFX exactly once on new incoming transmission
    const hadIncoming = this.missionEngine.getCommsState()?.hasIncomingTransmission ?? false;
    this.missionEngine.update(dt, this.ship, this.planets);
    const hasIncoming = this.missionEngine.getCommsState()?.hasIncomingTransmission ?? false;
    if (!hadIncoming && hasIncoming && !this.maydaySoundPlayed) {
      SoundManager.playOnce(SFX_MAYDAY, 0.5);
      this.maydaySoundPlayed = true;
    }

    // Debug beam visualization
    this.debugBeam.update(px, py, fwdX, fwdY, this.npcManager.getNpcs());

    // Sound: thruster loop
    this.updateThrusterSound();

    this.cameraController.setTarget(
      this.ship.position.x,
      this.ship.position.y,
    );
    this.cameraController.setShipHeading(this.ship.getHeading());

    // Keep orbit center tracking the locked-on NPC (or player fallback)
    if (this.cameraController.getDebugView() === "orbit") {
      const orbitTargetId = this.orbitControls.getTargetId();
      if (orbitTargetId) {
        const npcs = this.npcManager.getNpcs();
        const target = npcs.find((n) => n.id === orbitTargetId);
        if (target) {
          this.cameraController.setOrbitCenter(target.position.x, target.position.y);
        }
      } else {
        this.cameraController.setOrbitCenter(this.ship.position.x, this.ship.position.y);
      }
    }

    // Comm mode choreography: approach animation, rotation, letterbox
    this.updateCommChoreography(dt);

    this.cameraController.update(dt);

    // FPV transition feedback — crossfade starfield, nebula, tilt, and post-processing
    const fpvT = this.cameraController.getFpvTransition();
    this.starfield.setFpvTransition(fpvT);
    this.nebulaBg.setFpvFade(1 - fpvT);

    // Ship tilt: smooth removal during FPV (ships look tilted in cockpit view).
    // Skip when hero mode or hardpoint editor is active — both control ship transform directly.
    // syncMesh at the end of this block would overwrite the editor's position/rotation.
    if (!this.heroCamera.isActive() && !this.shipOrientAnim && !this.hardpointEditor.isActive()) {
      const baseTilt = (-22 * Math.PI) / 180;
      const fpvTilt = baseTilt * (1 - fpvT);
      this.ship.setTilt(fpvTilt);
      // All NPCs share a static tilt override — no per-NPC iteration needed
      NpcShip.tiltOverride = fpvTilt;

      // FPV ship banking — subtle roll proportional to turn rate.
      // Only applied when fully in FPV (fpvT >= 0.95) to avoid compound rotation
      // with the tilt lerp (Euler XYZ causes multi-axis artifacts during transition).
      const heading = this.ship.getHeading();
      let headingDelta = heading - this.prevHeading;
      // Normalize to [-PI, PI] (handle wrap-around)
      if (headingDelta > Math.PI) headingDelta -= 2 * Math.PI;
      if (headingDelta < -Math.PI) headingDelta += 2 * Math.PI;
      this.prevHeading = heading;

      const turnRate = dt > 0 ? headingDelta / dt : 0;
      // Very smooth turn rate tracking (lower factor = less bouncing)
      this.smoothTurnRate += (turnRate - this.smoothTurnRate) * 0.02;

      // Subtle banking: ~5° max, only when fully in FPV.
      // No comm view gate — FPV IS comm, identical code path always.
      const maxBank = 0.08; // ~5 degrees
      const bankScale = 0.04; // low sensitivity
      const bankAngle = (fpvT >= 0.95)
        ? Math.max(-maxBank, Math.min(maxBank, -this.smoothTurnRate * bankScale))
        : 0;
      this.ship.setRoll(bankAngle * fpvT);
      // Subtle camera counter-roll for turning feel
      this.cameraController.setCameraRoll(bankAngle * 0.3);

      this.ship.syncMesh();
    }

    // FPV planet Z offset: visually shift planets up/down during FPV transition.
    // Uses the eased transition value so it's smooth and imperceptible.
    // Also smoothly adjust planet sphere tilt so rotation looks like spinning
    // (not rolling) when viewed from FPV/comm perspective.
    const planetZOffset = this.cameraController.getFpvPlanetZOffset();
    for (const planet of this.planets) {
      planet.mesh.position.z = planetZOffset;
      planet.setFpvTransition(fpvT);
    }

    // FPV NPC Z offset: visually shift NPC ships up/down during FPV transition.
    // This controls NPC altitude relative to the player ship (Scene Z replacement).
    const npcZOffset = this.cameraController.getFpvNpcZOffset();
    for (const npc of this.npcManager.getNpcs()) {
      npc.mesh.position.z = 10 + npcZOffset; // 10 = base ship Z plane
    }

    // FPV post-processing + lighting: lerp between gameplay and FPV target values.
    // Uses cubic ease-in-out so ALL values ramp smoothly (no linear pop on first/last frame).
    // Hero camera overrides post-processing entirely, so skip during hero mode.
    if (fpvT > 0 && !this.heroCamera.isActive()) {
      const e = fpvT < 0.5 ? 4 * fpvT * fpvT * fpvT : 1 - (-2 * fpvT + 2) ** 3 / 2;
      const g = this.gameplayPostConfig;
      const f = this.fpvPostConfig;
      this.postProcessing.setVignetteIntensity(g.vignetteIntensity + (f.vignetteIntensity - g.vignetteIntensity) * e);
      this.postProcessing.setVignetteSoftness(g.vignetteSoftness + (f.vignetteSoftness - g.vignetteSoftness) * e);
      this.postProcessing.setBloomStrength(g.bloomStrength + (f.bloomStrength - g.bloomStrength) * e);
      this.postProcessing.setBloomRadius(g.bloomRadius + (f.bloomRadius - g.bloomRadius) * e);
      this.postProcessing.setBloomThreshold(g.bloomThreshold + (f.bloomThreshold - g.bloomThreshold) * e);
      this.postProcessing.setBrightness(g.brightness + (f.brightness - g.brightness) * e);
      this.postProcessing.setContrast(g.contrast + (f.contrast - g.contrast) * e);
      this.postProcessing.setExposure(g.exposure + (f.exposure - g.exposure) * e);

      // FPV light lerp — crossfade lighting intensity + position
      const gl = this.gameplayLightConfig;
      const fl = this.fpvPostConfig;
      this.lighting.updateLight("ambient", "intensity", gl.ambientIntensity + (fl.ambientIntensity - gl.ambientIntensity) * e);
      this.lighting.updateLight("hemisphere", "intensity", gl.hemisphereIntensity + (fl.hemisphereIntensity - gl.hemisphereIntensity) * e);
      this.lighting.updateLight("keyLight", "intensity", gl.keyLightIntensity + (fl.keyLightIntensity - gl.keyLightIntensity) * e);
      this.lighting.updateLight("fillLight", "intensity", gl.fillLightIntensity + (fl.fillLightIntensity - gl.fillLightIntensity) * e);
      this.lighting.updateLight("rimLight", "intensity", gl.rimLightIntensity + (fl.rimLightIntensity - gl.rimLightIntensity) * e);
      // Light positions
      this.lighting.updateLight("keyLight", "x", gl.keyLightX + (fl.keyLightX - gl.keyLightX) * e);
      this.lighting.updateLight("keyLight", "y", gl.keyLightY + (fl.keyLightY - gl.keyLightY) * e);
      this.lighting.updateLight("keyLight", "z", gl.keyLightZ + (fl.keyLightZ - gl.keyLightZ) * e);
      this.lighting.updateLight("fillLight", "x", gl.fillLightX + (fl.fillLightX - gl.fillLightX) * e);
      this.lighting.updateLight("fillLight", "y", gl.fillLightY + (fl.fillLightY - gl.fillLightY) * e);
      this.lighting.updateLight("fillLight", "z", gl.fillLightZ + (fl.fillLightZ - gl.fillLightZ) * e);
      this.lighting.updateLight("rimLight", "x", gl.rimLightX + (fl.rimLightX - gl.rimLightX) * e);
      this.lighting.updateLight("rimLight", "y", gl.rimLightY + (fl.rimLightY - gl.rimLightY) * e);
      this.lighting.updateLight("rimLight", "z", gl.rimLightZ + (fl.rimLightZ - gl.rimLightZ) * e);
      // FPV edge light — fades from 0 (gameplay) to target during FPV
      this.lighting.updateLight("fpvLight", "intensity", gl.fpvLightIntensity + (fl.fpvLightIntensity - gl.fpvLightIntensity) * e);
      this.lighting.updateLight("fpvLight", "x", gl.fpvLightX + (fl.fpvLightX - gl.fpvLightX) * e);
      this.lighting.updateLight("fpvLight", "y", gl.fpvLightY + (fl.fpvLightY - gl.fpvLightY) * e);
      this.lighting.updateLight("fpvLight", "z", gl.fpvLightZ + (fl.fpvLightZ - gl.fpvLightZ) * e);
    } else if (fpvT === 0 && !this.heroCamera.isActive()) {
      // Restore gameplay post-processing (in case we just exited FPV)
      const g = this.gameplayPostConfig;
      this.postProcessing.setVignetteIntensity(g.vignetteIntensity);
      this.postProcessing.setVignetteSoftness(g.vignetteSoftness);
      this.postProcessing.setBloomStrength(g.bloomStrength);
      this.postProcessing.setBloomRadius(g.bloomRadius);
      this.postProcessing.setBloomThreshold(g.bloomThreshold);
      this.postProcessing.setBrightness(g.brightness);
      this.postProcessing.setContrast(g.contrast);
      this.postProcessing.setExposure(g.exposure);

      // Restore gameplay lighting (intensity + position)
      const gl = this.gameplayLightConfig;
      this.lighting.updateLight("ambient", "intensity", gl.ambientIntensity);
      this.lighting.updateLight("hemisphere", "intensity", gl.hemisphereIntensity);
      this.lighting.updateLight("keyLight", "intensity", gl.keyLightIntensity);
      this.lighting.updateLight("fillLight", "intensity", gl.fillLightIntensity);
      this.lighting.updateLight("rimLight", "intensity", gl.rimLightIntensity);
      this.lighting.updateLight("keyLight", "x", gl.keyLightX);
      this.lighting.updateLight("keyLight", "y", gl.keyLightY);
      this.lighting.updateLight("keyLight", "z", gl.keyLightZ);
      this.lighting.updateLight("fillLight", "x", gl.fillLightX);
      this.lighting.updateLight("fillLight", "y", gl.fillLightY);
      this.lighting.updateLight("fillLight", "z", gl.fillLightZ);
      this.lighting.updateLight("rimLight", "x", gl.rimLightX);
      this.lighting.updateLight("rimLight", "y", gl.rimLightY);
      this.lighting.updateLight("rimLight", "z", gl.rimLightZ);
      // FPV edge light — off in gameplay
      this.lighting.updateLight("fpvLight", "intensity", gl.fpvLightIntensity);
      this.lighting.updateLight("fpvLight", "x", gl.fpvLightX);
      this.lighting.updateLight("fpvLight", "y", gl.fpvLightY);
      this.lighting.updateLight("fpvLight", "z", gl.fpvLightZ);
    }

    // ── Bridge interior transition ──
    // Lerps post-FX from FPV → bridge config during bridgeTransition.
    // Also manages bridge visibility and hull flash.
    const bridgeT = this.cameraController.getBridgeTransition();
    if (bridgeT > 0 && !this.heroCamera.isActive()) {
      const be = bridgeT < 0.5 ? 4 * bridgeT * bridgeT * bridgeT : 1 - (-2 * bridgeT + 2) ** 3 / 2;
      const f = this.fpvPostConfig;
      const b = this.bridgePostConfig;
      // Post-FX: lerp from FPV values to bridge values
      this.postProcessing.setVignetteIntensity(f.vignetteIntensity + (b.vignetteIntensity - f.vignetteIntensity) * be);
      this.postProcessing.setVignetteSoftness(f.vignetteSoftness + (b.vignetteSoftness - f.vignetteSoftness) * be);
      this.postProcessing.setBloomStrength(f.bloomStrength + (b.bloomStrength - f.bloomStrength) * be);
      this.postProcessing.setBloomRadius(f.bloomRadius + (b.bloomRadius - f.bloomRadius) * be);
      this.postProcessing.setBloomThreshold(f.bloomThreshold + (b.bloomThreshold - f.bloomThreshold) * be);
      if (!this.hullFlashActive) {
        this.postProcessing.setBrightness(f.brightness + (b.brightness - f.brightness) * be);
        this.postProcessing.setContrast(f.contrast + (b.contrast - f.contrast) * be);
        this.postProcessing.setExposure(f.exposure + (b.exposure - f.exposure) * be);
      }
      // Lighting: lerp from FPV to bridge (scene lights dim down for baked interior)
      this.lighting.updateLight("ambient", "intensity", f.ambientIntensity + (b.ambientIntensity - f.ambientIntensity) * be);
      this.lighting.updateLight("hemisphere", "intensity", f.hemisphereIntensity + (b.hemisphereIntensity - f.hemisphereIntensity) * be);
      this.lighting.updateLight("keyLight", "intensity", f.keyLightIntensity + (b.keyLightIntensity - f.keyLightIntensity) * be);
      this.lighting.updateLight("fillLight", "intensity", f.fillLightIntensity + (b.fillLightIntensity - f.fillLightIntensity) * be);
      this.lighting.updateLight("rimLight", "intensity", f.rimLightIntensity + (b.rimLightIntensity - f.rimLightIntensity) * be);
      this.lighting.updateLight("fpvLight", "intensity", f.fpvLightIntensity + (b.fpvLightIntensity - f.fpvLightIntensity) * be);
    }

    // Hull flash: 200ms exposure spike when camera passes through hull (~35% bridge transition)
    if (this.prevBridgeTransition < 0.35 && bridgeT >= 0.35 && !this.hullFlashActive) {
      this.triggerHullFlash();
    }
    // Track for entering (forward direction only)
    if (this.prevBridgeTransition > 0.65 && bridgeT <= 0.65 && !this.hullFlashActive) {
      // Also flash when exiting bridge (reverse transition)
      this.triggerHullFlash();
    }
    this.prevBridgeTransition = bridgeT;

    // Hero camera — controls the perspective camera directly (zoom, pan, effects).
    // No camera switch — same projection always. Zero visual change on activation.
    if (this.heroCamera.isActive()) {
      this.updateHeroSubjectPosition();
      this.heroCamera.update(dt);

      const fx = this.heroCamera.getEffects();
      this.postProcessing.setBloomStrength(fx.bloomStrength);
      this.postProcessing.setBloomRadius(fx.bloomRadius);
      this.postProcessing.setBloomThreshold(fx.bloomThreshold);
      this.postProcessing.setVignetteIntensity(fx.vignetteIntensity);
      this.postProcessing.setVignetteSoftness(fx.vignetteSoftness);
      this.postProcessing.setBrightness(fx.brightness);
      this.postProcessing.setContrast(fx.contrast);
      this.postProcessing.setExposure(fx.exposure);
    }

    // Ship orientation animation — animate heading/tilt/roll/scale for enter or exit
    if (this.shipOrientAnim) {
      const a = this.shipOrientAnim;
      a.elapsed += dt;
      const rawT = Math.min(1, a.elapsed / a.duration);
      const t = this.easeInOutCubic(rawT);

      this.ship.state.rotation = a.fromHeading + (a.toHeading - a.fromHeading) * t;
      this.ship.setTilt(a.fromTilt + (a.toTilt - a.fromTilt) * t);
      this.ship.setRoll(a.fromRoll + (a.toRoll - a.fromRoll) * t);
      this.ship.setHeroScale(a.fromScale + (a.toScale - a.fromScale) * t);
      this.ship.syncMesh();

      if (rawT >= 1) {
        this.shipOrientAnim = null;
      }
    }

    // Hardpoint editor camera update
    if (this.hardpointEditor.isActive()) {
      this.hardpointEditor.update();
    }

    // Determine which camera to use for rendering.
    // Hero mode uses the same ortho camera (no switch). Hardpoint editor has its own.
    const activeCamera = this.hardpointEditor.isActive()
      ? this.hardpointEditor.getCamera()
      : this.cameraController.getActiveCamera();

    this.starfield.update(
      activeCamera.position.x,
      activeCamera.position.y,
      activeCamera.position.z,
    );

    // Keep nebula centered on camera. Z-tracking maintains constant distance
    // so perspective doesn't change apparent background size.
    this.nebulaBg.update(
      activeCamera.position.x,
      activeCamera.position.y,
      activeCamera.position.z,
    );

    // Always render through EffectComposer (individual passes auto-disable when
    // their values are zero, so gameplay cost is just one extra texture copy).
    this.postProcessing.setCamera(activeCamera);
    this.postProcessing.render();

    if (this.frameCount % 3 === 0 && this.onStateUpdate) {
      this.onStateUpdate(this.getGameState());
    }
  };

  /** Build the current GameState snapshot for React consumption */
  private getGameState(): GameState {
    const radarContacts: RadarContact[] = [
      ...this.planets.map((p) => ({
        id: p.name,
        position: p.position,
        type: "planet" as const,
        name: p.name,
        hostile: false,
      })),
      ...this.npcManager.getRadarContacts(),
    ];

    // Include quest NPC on radar
    const questContact = this.missionEngine.getRadarContact();
    if (questContact) {
      radarContacts.push(questContact);
    }

    let nearestPlanet: string | null = null;
    let nearestPlanetId: string | null = null;
    let nearestDistance: number | null = null;
    for (const planet of this.planets) {
      const dist = planet.distanceTo(this.ship.position);
      if (nearestDistance === null || dist < nearestDistance) {
        nearestDistance = dist;
        nearestPlanet = planet.name;
        nearestPlanetId = planet.name;
      }
    }

    // Dockable: player close enough (< radius * 2.5) and slow (speed < 3)
    let dockable: DockableInfo | null = null;
    if (!this.isDocked && nearestPlanet && nearestDistance !== null) {
      const nearPlanet = this.planets.find((p) => p.name === nearestPlanet);
      if (nearPlanet) {
        const speed = Math.sqrt(
          this.ship.state.velocity.x ** 2 + this.ship.state.velocity.y ** 2,
        );
        if (nearestDistance < nearPlanet.radius * 2.5 && speed < 3) {
          dockable = { planetName: nearestPlanet, planetId: nearestPlanetId! };
        }
      }
    }

    return {
      ship: { ...this.ship.state },
      navigation: {
        systemName: "Sol",
        coordinates: {
          x: Math.round(this.ship.position.x),
          y: Math.round(this.ship.position.y),
        },
        nearestPlanet,
        nearestDistance:
          nearestDistance !== null
            ? Math.round(nearestDistance * 10) / 10
            : null,
      },
      target: null,
      radarContacts,
      fps: this.currentFps,
      currentShipId: this.currentShipId,
      currentShipColor: this.currentShipColor,
      dockable,
      docked: this.isDocked,
      questComms: this.missionEngine.getCommsState(),
      questRescueCta: this.getQuestRescueCta(),
      screenState: this.isDocked ? "planet_docking" : "gameplay",
      heroLetterbox: this.heroCamera.isActive()
        ? this.heroCamera.getEffects().letterbox
        : this.commLetterbox,
      shipModelLoaded: this.ship.modelLoaded,
      fpv: this.cameraController.isFpvActive(),
      fpvTransition: this.cameraController.getFpvTransition(),
      bridgeActive: this.cameraController.isBridgeActive(),
      bridgeTransition: this.cameraController.getBridgeTransition(),
      commViewTarget: this.commState?.npcName ?? null,
    };
  }

  // ─── Quest CTA screen projection ───

  private getQuestRescueCta(): { screenX: number; screenY: number } | null {
    const npcPos = this.missionEngine.getNpcPosition();
    if (!npcPos) return null;
    // Return screen position whenever the quest NPC exists (SIGNAL_DETECTED+)
    const comms = this.missionEngine.getCommsState();
    if (!comms || comms.phase === "IDLE" || comms.phase === "COMPLETE") return null;

    const camera = this.cameraController.getActiveCamera();
    const vec = new THREE.Vector3(npcPos.x, npcPos.y, 0);
    vec.project(camera);

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const screenX = ((vec.x + 1) / 2) * width;
    const screenY = ((-vec.y + 1) / 2) * height;

    return { screenX, screenY };
  }

  // ─── Sound ───

  private updateThrusterSound() {
    const thrusting = this.ship.state.thrust > 0;
    if (thrusting && !this.thrusterPlaying) {
      SoundManager.startLoop(SFX_THRUSTER, 0.25);
      this.thrusterPlaying = true;
    } else if (!thrusting && this.thrusterPlaying) {
      SoundManager.stopLoop(SFX_THRUSTER);
      this.thrusterPlaying = false;
    }
  }

  // ─── NPC public API (delegated) ───

  /** Spawn a frozen NPC near the player for testing scan outline settings */
  spawnTestShip() {
    this.npcManager.spawnTestShip(this.ship);
  }

  /** Spawn 4 test ships in a ring around the player */
  spawnTestRing() {
    this.npcManager.spawnTestRing(this.ship);
  }

  /** Remove all test ships (IDs starting with "test-") */
  clearTestShips() {
    this.npcManager.clearTestShips();
  }

  // ─── Jump Back to Nearest Planet ───

  /** Teleport the player ship to just outside the nearest planet */
  jumpToNearestPlanet() {
    let nearest: Planet | null = null;
    let nearestDist = Infinity;

    for (const planet of this.planets) {
      const dist = planet.distanceTo(this.ship.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = planet;
      }
    }

    if (nearest) {
      // Teleport to just outside the planet
      this.ship.state.position = {
        x: nearest.position.x + nearest.radius + 5,
        y: nearest.position.y,
      };
      this.ship.state.velocity = { x: 0, y: 0 };
    }
  }

  /** Callback fired when D/L triggers a dock — set by React to run handleDock */
  private onDockRequest: (() => void) | null = null;

  /** Register a callback for keyboard-triggered docking (D/L keys) */
  setDockRequestCallback(cb: () => void) {
    this.onDockRequest = cb;
  }

  /** Toggle FPV cockpit camera */
  toggleFpv() {
    // Don't toggle while docked or in authoring tools
    if (this.isDocked || this.heroCamera.isActive() || this.hardpointEditor.isActive()) return;
    // If in comm mode, exit it instead of just toggling FPV
    if (this.commState) {
      this.exitCommMode();
      return;
    }
    this.cameraController.toggleFpv();
  }

  isFpvActive(): boolean {
    return this.cameraController.isFpvActive();
  }

  // ─── FPV Post-Processing Config API (for React config panel) ───

  getFpvPostConfig() {
    return {
      ...this.fpvPostConfig,
      ...this.cameraController.getFpvCameraConfig(),
      fpvBankX: this.ship.bankAxisX,
      fpvBankY: this.ship.bankAxisY,
      fpvBankZ: this.ship.bankAxisZ,
    };
  }

  setFpvPostParam(key: string, value: number) {
    if (key in this.fpvPostConfig) {
      (this.fpvPostConfig as Record<string, number>)[key] = value;
    } else if (key === "fpvBankX") {
      this.ship.bankAxisX = value;
    } else if (key === "fpvBankY") {
      this.ship.bankAxisY = value;
    } else if (key === "fpvBankZ") {
      this.ship.bankAxisZ = value;
    } else {
      // Route to CameraController for camera-specific params
      this.cameraController.setFpvCameraParam(key, value);
    }
  }

  // ─── Bridge Config API (for React config panel) ───

  getBridgeCameraConfig() {
    return {
      ...this.cameraController.getBridgeCameraConfig(),
    };
  }

  setBridgeCameraParam(key: string, value: number) {
    if (key === "bridgeSpeed") {
      this.cameraController.setBridgeCameraParam(key, value);
    }
  }

  getBridgePostConfig() {
    return { ...this.bridgePostConfig };
  }

  setBridgePostParam(key: string, value: number) {
    if (key in this.bridgePostConfig) {
      (this.bridgePostConfig as Record<string, number>)[key] = value;
    }
  }

  isBridgeActive(): boolean {
    return this.cameraController.isBridgeActive();
  }

  getBridgeTransition(): number {
    return this.cameraController.getBridgeTransition();
  }

  /**
   * Hull flash: 200ms exposure spike that masks the camera passing through the ship hull.
   * Uses the existing PostProcessing exposure uniform — no new passes needed.
   */
  private triggerHullFlash() {
    if (this.hullFlashActive) return;
    this.hullFlashActive = true;

    const baseExposure = this.postProcessing.getExposure();
    const peak = 8.0;

    // Phase 1: instant spike
    this.postProcessing.setExposure(peak);

    // Phase 2: fade at 80ms
    setTimeout(() => {
      this.postProcessing.setExposure(baseExposure + (peak - baseExposure) * 0.3);
    }, 80);

    // Phase 3: restore at 200ms
    setTimeout(() => {
      this.postProcessing.setExposure(baseExposure);
      this.hullFlashActive = false;
    }, 200);
  }

  // ─── Comm Mode API ───

  /** Normalize an angle to [-PI, PI] */
  private static normalizeAngle(a: number): number {
    let r = a % (2 * Math.PI);
    if (r > Math.PI) r -= 2 * Math.PI;
    if (r < -Math.PI) r += 2 * Math.PI;
    return r;
  }

  /** Lerp between two angles via shortest arc */
  private static lerpAngle(from: number, to: number, t: number): number {
    let delta = Engine.normalizeAngle(to - from);
    return from + delta * t;
  }

  /** Cubic ease-in-out */
  private static easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }

  /**
   * Enter comm mode: theatrical FPV entry by clicking an NPC.
   * Freezes the NPC, calculates approach path with lateral offset,
   * and starts the choreographed transition.
   */
  enterCommMode(npcId: string) {
    const npc = this.npcManager.getNpc(npcId);
    if (!npc) return;

    // Freeze the NPC (stop its state machine so it doesn't leave)
    this.npcManager.freezeNpc(npcId);

    // ── Calculate approach position ──
    const dx = npc.position.x - this.ship.position.x;
    const dy = npc.position.y - this.ship.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const approachDist = 8; // stop this far from NPC

    // Unit vector from player toward NPC
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 1;

    // Apply ~12° lateral offset so NPC isn't dead-center in FPV (theatrical framing).
    // Randomly pick left or right for variety.
    const offsetAngle = (Math.random() > 0.5 ? 1 : -1) * 12 * (Math.PI / 180);
    const cosA = Math.cos(offsetAngle);
    const sinA = Math.sin(offsetAngle);
    const offNx = nx * cosA - ny * sinA;
    const offNy = nx * sinA + ny * cosA;

    const targetX = npc.position.x - offNx * approachDist;
    const targetY = npc.position.y - offNy * approachDist;

    // Target heading: player faces the NPC (with the offset built in).
    // Heading convention: 0 = +Y, atan2(-dx, dy).
    const desiredHeading = Math.atan2(-(npc.position.x - targetX), npc.position.y - targetY);
    // To achieve this heading, set rotation = desiredHeading - thrustOffset
    const targetRot = desiredHeading - this.ship.getThrustForwardAngle();

    // NPC target rotation: face the player's approach position
    const npcTargetRot = Math.atan2(-(targetX - npc.position.x), targetY - npc.position.y);

    // Kill player velocity immediately
    this.ship.state.velocity = { x: 0, y: 0 };

    this.commState = {
      npcId,
      npcName: npc.name,
      phase: "approaching",
      startPos: { x: this.ship.state.position.x, y: this.ship.state.position.y },
      targetPos: { x: targetX, y: targetY },
      startRot: this.ship.state.rotation,
      targetRot,
      npcStartRot: npc.getDirection(),
      npcTargetRot,
      approachT: 0,
    };

    // Enter FPV + Bridge
    if (!this.cameraController.isFpvActive()) {
      this.cameraController.toggleFpv();
    }
    // Activate bridge transition (chains after FPV reaches 1.0)
    this.cameraController.setBridgeActive(true);
  }

  /**
   * Exit comm mode: unfreeze NPC, exit bridge then FPV, ease out letterbox.
   */
  exitCommMode() {
    if (!this.commState) return;

    // Unfreeze the NPC
    this.npcManager.unfreezeNpc(this.commState.npcId);

    // Exit bridge first (it will reverse bridgeTransition 1→0)
    this.cameraController.setBridgeActive(false);

    // Exit FPV (CameraController won't start FPV exit until bridge is fully out)
    if (this.cameraController.isFpvActive()) {
      this.cameraController.toggleFpv();
    }

    // Hide bridge when transition completes (handled in loop via bridgeTransition check)

    // Transition to exiting phase (letterbox eases out in updateCommChoreography)
    this.commState.phase = "exiting";
  }

  /**
   * Per-frame comm mode choreography: approach animation, rotation lerp, letterbox.
   */
  private updateCommChoreography(dt: number) {
    if (!this.commState) return;

    const npc = this.npcManager.getNpc(this.commState.npcId);
    if (!npc) {
      // NPC was cleaned up — force exit
      this.commLetterbox = 0;
      this.commState = null;
      if (this.cameraController.isFpvActive()) {
        this.cameraController.toggleFpv();
      }
      return;
    }

    const { phase } = this.commState;

    if (phase === "approaching") {
      // Advance choreography timer (~2s total)
      this.commState.approachT = Math.min(1, this.commState.approachT + dt * 0.5);
      const t = Engine.easeInOutCubic(this.commState.approachT);

      // Lerp player position toward approach target
      const { startPos, targetPos, startRot, targetRot, npcStartRot, npcTargetRot } = this.commState;
      this.ship.state.position.x = startPos.x + (targetPos.x - startPos.x) * t;
      this.ship.state.position.y = startPos.y + (targetPos.y - startPos.y) * t;
      this.ship.state.velocity = { x: 0, y: 0 };

      // Lerp rotations (shortest arc)
      this.ship.state.rotation = Engine.lerpAngle(startRot, targetRot, t);
      npc.setDirection(Engine.lerpAngle(npcStartRot, npcTargetRot, t));

      // Sync ship mesh so camera follows the interpolated position/rotation
      this.ship.syncMesh();

      // Letterbox eases in (0.5 = ~6vh bars, subtle but cinematic)
      this.commLetterbox = t * 0.5;

      if (this.commState.approachT >= 1) {
        this.commState.phase = "settled";
      }
    }

    if (phase === "exiting") {
      // Ease letterbox back to 0
      this.commLetterbox = Math.max(0, this.commLetterbox - dt * 0.8);
      if (this.commLetterbox <= 0) {
        this.commState = null;
      }
    }
  }

  /**
   * Canvas click handler: convert screen click to world coordinates,
   * find the nearest NPC, and enter comm mode.
   */
  private handleCanvasClick = (_e: MouseEvent) => {
    // Comm mode via canvas click is disabled
  };

  /** Convert a screen mouse event to world XY at the ship plane (z=10). */
  private screenToWorld(e: MouseEvent): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const camera = this.cameraController.getActiveCamera();
    const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
    vec.unproject(camera);

    const camPos = camera.position;
    const dir = vec.sub(camPos).normalize();
    const t = (10 - camPos.z) / dir.z;
    if (t < 0) return null;
    return { x: camPos.x + dir.x * t, y: camPos.y + dir.y * t };
  }

  /**
   * Mouse move handler: show pointer cursor when hovering over a clickable NPC.
   */
  private handleCanvasMouseMove = (e: MouseEvent) => {
    // Only show hover cursor in top-down mode (same guards as click)
    if (this.commState || this.isDocked) {
      this.canvas.style.cursor = "";
      return;
    }
    if (this.heroCamera.isActive() || this.hardpointEditor.isActive()) {
      this.canvas.style.cursor = "";
      return;
    }
    if (this.cameraController.isFpvActive()) {
      this.canvas.style.cursor = "";
      return;
    }

    const world = this.screenToWorld(e);
    if (!world) {
      this.canvas.style.cursor = "";
      return;
    }

    const npc = this.npcManager.findNearestNpc(world.x, world.y, 4);
    this.canvas.style.cursor = npc ? "pointer" : "";
  };

  private handleDebugKeys = (e: KeyboardEvent) => {
    // Don't capture keys when typing in input fields
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.code === "KeyB") {
      this.setBeamVisible(!this.debugBeam.isVisible());
    }

    // Escape = exit comm mode
    if (e.code === "Escape" && this.commState) {
      this.exitCommMode();
    }

    // L = dock/land at nearest planet (if dockable)
    // (D is reserved for rotateRight)
    if (e.code === "KeyL") {
      if (!this.isDocked && this.onDockRequest) {
        this.onDockRequest();
      }
    }
  };

  /**
   * Notify the engine of the permanent sidebar width (pixels).
   * Shifts the camera right so the ship stays centered in the playable area.
   * Call once after mount and whenever the breakpoint changes.
   */
  setSidebarWidthPx(px: number) {
    this.sidebarWidthPx = px;
    this.applyShiftOffset();
  }

  private applyShiftOffset() {
    // viewSize is the vertical world extent visible at the reference plane (40 units).
    // 1 pixel vertically = viewSize / containerHeight world units.
    // We shift right by half the sidebar width so the ship centers in the playable area.
    const worldOffset =
      (this.sidebarWidthPx / 2) *
      (this.cameraController.viewSize / this.container.clientHeight);
    this.cameraController.setSidebarOffset(worldOffset);
  }

  // ─── Hero Shot API ───

  /**
   * Enter hero mode for a subject — with smart toggle/switch behavior:
   *   • Not active → activate (captures gameplay camera as start frame)
   *   • Same subject → exit (toggle off)
   *   • Different subject → exit then enter new subject
   */
  enterHeroMode(subject: HeroSubject) {
    if (this.heroCamera.isAnimating()) return;

    const currentSubject = this.heroCamera.getSubject();

    // Toggle: same subject → exit
    if (
      this.heroCamera.isActive() &&
      currentSubject &&
      currentSubject.type === subject.type &&
      currentSubject.id === subject.id
    ) {
      this.exitHeroMode();
      return;
    }

    // Switch: different subject → exit first
    if (this.heroCamera.isActive()) {
      this.exitHeroMode();
    }

    // Activate
    const pos = this.resolveSubjectPosition(subject);
    if (!pos) return;

    const cam = this.cameraController.camera;
    this.savedShipRotation = this.ship.state.rotation;

    // Save current color correction for restore on exit
    this.savedColorCorrection = {
      brightness: this.postProcessing.getBrightness(),
      contrast: this.postProcessing.getContrast(),
      exposure: this.postProcessing.getExposure(),
    };

    this.heroCamera.activate(
      subject,
      pos,
      cam,
      this.cameraController.viewSize,
      this.cameraController.getZoom(),
      cam.position.clone(),
      this.savedColorCorrection,
      {
        bloomStrength: this.gameplayPostConfig.bloomStrength,
        bloomRadius: this.gameplayPostConfig.bloomRadius,
        bloomThreshold: this.gameplayPostConfig.bloomThreshold,
        vignetteIntensity: this.gameplayPostConfig.vignetteIntensity,
        vignetteSoftness: this.gameplayPostConfig.vignetteSoftness,
      },
    );

    // Attach mouse + keyboard controls (skip keyboard when docked — no panning)
    this.heroCamera.setShipRotateCallback((delta) => {
      this.ship.state.rotation += delta;
      this.ship.syncMesh();
    });
    this.heroCamera.attachCanvas(this.canvas);
    if (!this.isDocked) {
      this.heroCamera.attachKeyboard();
    }

    // Auto-animate to preset
    if (subject.type === "ship") {
      // Ship preset — camera + effects + orientation animate together
      const sp = DEFAULT_SHIP_PRESET;
      this.heroCamera.setComposed(sp);
      this.heroCamera.previewToComposed(2.0);

      // Parallel ship orientation animation (heading/tilt/roll/scale)
      this.shipOrientAnim = {
        fromHeading: this.ship.state.rotation,
        fromTilt: this.ship.getTilt(),
        fromRoll: this.ship.getRoll(),
        fromScale: this.ship.getHeroScale(),
        toHeading: sp.shipHeading,
        toTilt: sp.shipTilt,
        toRoll: sp.shipRoll,
        toScale: sp.shipScale,
        elapsed: 0,
        duration: 2.0,
      };
    } else {
      // Planet preset — per-planet override or universal default
      const preset = HERO_PRESETS[subject.id] ?? DEFAULT_PLANET_PRESET;
      this.heroCamera.setComposed(preset);
      this.heroCamera.previewToComposed(2.0);
    }
  }

  /** Exit hero mode immediately — restore ship state, zero effects */
  exitHeroMode() {
    this.heroCamera.detachCanvas();
    this.shipOrientAnim = null;

    if (this.savedShipRotation !== null) {
      this.ship.state.rotation = this.savedShipRotation;
      this.ship.syncMesh();
      this.savedShipRotation = null;
    }

    // Restore ship tilt + roll + scale to gameplay defaults
    this.ship.setTilt((-22 * Math.PI) / 180);
    this.ship.setRoll(0);
    this.ship.setHeroScale(1);
    this.ship.syncMesh();

    // Sync CameraController's tracked position to where the camera is right now.
    // This prevents a snap when CameraController takes over — especially during
    // undock, where the ship has moved during the 1.5s hero exit animation.
    const camPos = this.cameraController.camera.position;
    this.cameraController.setTrackedPosition(camPos.x, camPos.y);

    this.heroCamera.deactivate();

    // Restore bloom/vignette to gameplay baseline (not zero — avoids 1-frame pop)
    this.postProcessing.setBloomStrength(this.gameplayPostConfig.bloomStrength);
    this.postProcessing.setBloomRadius(this.gameplayPostConfig.bloomRadius);
    this.postProcessing.setBloomThreshold(this.gameplayPostConfig.bloomThreshold);
    this.postProcessing.setVignetteIntensity(this.gameplayPostConfig.vignetteIntensity);
    this.postProcessing.setVignetteSoftness(this.gameplayPostConfig.vignetteSoftness);

    // Restore color correction to gameplay defaults
    this.postProcessing.setBrightness(this.gameplayPostConfig.brightness);
    this.postProcessing.setContrast(this.gameplayPostConfig.contrast);
    this.postProcessing.setExposure(this.gameplayPostConfig.exposure);
  }

  /**
   * Animated exit — smoothly animate back to gameplay camera, then deactivate.
   * Ship heading/tilt/roll/scale animate in parallel so nothing snaps.
   */
  exitHeroModeAnimated(duration = 1.5) {
    if (!this.heroCamera.isActive()) return;
    if (this.heroCamera.isAnimating()) return;

    this.heroCamera.detachCanvas();

    // Bake in the sidebar shift that will be applied after exit.
    // During hero mode, sidebar width is zeroed (editorActive = true in Game.tsx).
    // When we exit, the sidebar reappears and shifts the camera right.
    // Pre-adjust the gameplay animation target so it lands at the correct spot.
    // Skip when docked — the gameplayParams already captured the sidebar offset
    // from the camera position at activate() time; adding it again double-counts.
    if (this.sidebarWidthPx > 0 && !this.isDocked) {
      const worldOffset =
        (this.sidebarWidthPx / 2) *
        (this.cameraController.viewSize / this.container.clientHeight);
      this.heroCamera.adjustGameplayTarget(worldOffset, 0);
    }

    // Start parallel ship orientation animation
    const targetHeading = this.savedShipRotation ?? this.ship.state.rotation;
    this.shipOrientAnim = {
      fromHeading: this.ship.state.rotation,
      fromTilt: this.ship.getTilt(),
      fromRoll: this.ship.getRoll(),
      fromScale: this.ship.getHeroScale(),
      toHeading: targetHeading,
      toTilt: (-22 * Math.PI) / 180,
      toRoll: 0,
      toScale: 1,
      elapsed: 0,
      duration,
    };

    this.heroCamera.previewToGameplay(duration, () => {
      this.exitHeroMode();
    });
  }

  isInHeroMode(): boolean {
    return this.heroCamera.isActive();
  }

  isHeroAnimating(): boolean {
    return this.heroCamera.isAnimating();
  }

  /** Set a single hero shot param (directly controls ortho camera + effects) */
  setHeroConfig(property: string, value: number) {
    this.heroCamera.setParam(property as keyof HeroShotConfig, value);
  }

  getHeroConfig(): HeroShotConfig {
    return this.heroCamera.getParams();
  }

  /** Preview animation: save current composed state, animate to gameplay and back */
  heroPreviewToGameplay(duration?: number, onComplete?: () => void) {
    this.heroCamera.saveComposed();
    this.heroCamera.previewToGameplay(duration, onComplete);
  }

  heroPreviewToComposed(duration?: number, onComplete?: () => void) {
    this.heroCamera.previewToComposed(duration, onComplete);
  }

  /** Set the player ship's heading rotation for hero shot authoring */
  setShipRotationForHero(radians: number) {
    this.ship.state.rotation = radians;
    this.ship.syncMesh();
  }

  /** Get the player ship's current heading rotation */
  getShipRotation(): number {
    return this.ship.state.rotation;
  }

  /** Toggle ship-rotate mode on hero camera */
  setHeroShipRotateMode(on: boolean) {
    this.heroCamera.setShipRotateMode(on);
  }

  isHeroShipRotateMode(): boolean {
    return this.heroCamera.isShipRotateMode();
  }

  /** Set ship tilt (X rotation) for hero shot authoring */
  setShipTiltForHero(radians: number) {
    this.ship.setTilt(radians);
    this.ship.syncMesh();
  }

  /** Get ship tilt (X rotation) */
  getShipTilt(): number {
    return this.ship.getTilt();
  }

  /** Set ship roll (Y rotation) for hero shot authoring */
  setShipRollForHero(radians: number) {
    this.ship.setRoll(radians);
    this.ship.syncMesh();
  }

  /** Get ship roll (Y rotation) */
  getShipRoll(): number {
    return this.ship.getRoll();
  }

  /** Set ship scale for hero shot authoring */
  setShipScaleForHero(scale: number) {
    this.ship.setHeroScale(scale);
    this.ship.syncMesh();
  }

  /** Get ship hero scale */
  getShipScale(): number {
    return this.ship.getHeroScale();
  }

  /** Get the list of planet names for the hero shot subject picker */
  getPlanetNames(): string[] {
    return this.planets.map((p) => p.name);
  }

  /** Resolve a HeroSubject to a world position */
  private resolveSubjectPosition(subject: HeroSubject): THREE.Vector3 | null {
    if (subject.type === "ship") {
      return new THREE.Vector3(this.ship.position.x, this.ship.position.y, 10);
    }
    const planet = this.planets.find((p) => p.name === subject.id);
    if (planet) {
      return new THREE.Vector3(planet.position.x, planet.position.y, 0);
    }
    return null;
  }

  /** Update the hero camera subject position each frame (for moving subjects) */
  private updateHeroSubjectPosition() {
    const subject = this.heroCamera.getSubject();
    if (!subject) return;
    const pos = this.resolveSubjectPosition(subject);
    if (pos) {
      this.heroCamera.setSubjectPosition(pos);
    }
  }

  // ─── Post-Processing API (direct access for config panel) ───

  setPostProcessingEnabled(on: boolean) {
    this.postProcessing.enabled = on;
  }

  // ─── Hardpoint Editor API ───

  enterHardpointEditor() {
    const shipDef = getShipDef(this.currentShipId);

    // Use cached edits if available (from a previous editor session), otherwise
    // fall back to shipDef defaults. This preserves hardpoint tweaks across
    // close/reopen cycles so you can test in gameplay then resume editing.
    const cached = this.lastHardpointEdits.get(this.currentShipId);
    let hps: Hardpoint[] | undefined;
    let editorScale: number | undefined;
    let editorHeadingDeg: number | undefined;

    if (cached) {
      hps = cached.hardpoints;
      editorScale = cached.scale;
      editorHeadingDeg = (cached.headingRad * 180) / Math.PI;
    } else {
      // Convert ShipDef defaultHardpoints to Hardpoint[] (add generated IDs).
      // Fallback: community ships without explicit hardpoints get a default thruster.
      const rawHps = shipDef?.defaultHardpoints
        ?? (shipDef?.source === "community"
          ? [{ type: "thruster", localX: 0, localY: -0.3, localZ: 0, label: "engine" }]
          : undefined);
      hps = rawHps?.map((h, i) => ({
        id: `hp-${i + 1}`,
        type: h.type as HardpointType,
        localX: h.localX,
        localY: h.localY,
        localZ: h.localZ,
        label: h.label,
        thrustAngleDeg: (h as { thrustAngleDeg?: number }).thrustAngleDeg,
      }));
      editorScale = shipDef?.modelScale;
      editorHeadingDeg = shipDef?.defaultHeadingDeg;
    }

    this.hardpointEditor.activate(
      this.ship.mesh,
      hps,
      { modelScale: editorScale, defaultHeadingDeg: editorHeadingDeg },
    );
  }

  exitHardpointEditor() {
    // Guard: only cache + apply when editor is actually active.
    // This prevents a double-call (Panel handleExit + Game onClose) from
    // overwriting the cache with empty data after deactivate() clears it.
    if (!this.hardpointEditor.isActive()) {
      this.hardpointEditor.deactivate(); // no-op but safe
      return;
    }

    // Grab editor state before deactivate() clears it
    const hps = this.hardpointEditor.getHardpoints();
    const scale = this.hardpointEditor.getShipScale();
    const headingRad = this.hardpointEditor.getShipHeading();

    // Cache for re-entering the editor later + persist to localStorage
    this.lastHardpointEdits.set(this.currentShipId, {
      hardpoints: hps,
      scale,
      headingRad,
    });
    this.persistHardpointEdits();

    // Apply thruster hardpoints to the live ship.
    // Sync count first — the editor may have added/removed thrusters.
    // Coords are in mesh-local space — pass directly to Ship.
    const thrusterHps = hps.filter(h => h.type === "thruster");
    this.ship.setThrusterCount(thrusterHps.length);
    for (let i = 0; i < thrusterHps.length; i++) {
      const hp = thrusterHps[i]!;
      this.ship.setThrusterPosition(hp.localX, hp.localY, hp.localZ, i);
      this.ship.setThrusterAngle(hp.thrustAngleDeg ?? 0, i);
    }
    // Apply model scale if it was tuned
    if (scale != null) this.ship.setModelScale(scale);

    // Push edits into the ShipDef catalog so they persist with the ship config.
    // This updates defaultHardpoints + modelScale on the ShipDef in memory
    // and re-persists community ships to localStorage.
    updateShipConfig(this.currentShipId, {
      defaultHardpoints: hps.map(h => ({
        type: h.type,
        localX: h.localX,
        localY: h.localY,
        localZ: h.localZ,
        label: h.label,
        thrustAngleDeg: h.thrustAngleDeg,
      })),
      modelScale: scale,
    });

    this.hardpointEditor.deactivate();
  }

  isInHardpointEditor(): boolean {
    return this.hardpointEditor.isActive();
  }

  setHardpointPlacementType(type: HardpointType) {
    this.hardpointEditor.setPlacementType(type);
  }

  getHardpointPlacementType(): HardpointType {
    return this.hardpointEditor.getPlacementType();
  }

  getHardpoints(): Hardpoint[] {
    return this.hardpointEditor.getHardpoints();
  }

  deleteHardpoint(id: string) {
    this.hardpointEditor.deleteHardpoint(id);
  }

  selectHardpoint(id: string | null) {
    this.hardpointEditor.selectHardpoint(id);
  }

  getSelectedHardpointId(): string | null {
    return this.hardpointEditor.getSelectedId();
  }

  /** Switch ship model while staying in the hardpoint editor */
  changeShipForHardpointEditor(shipId: string) {
    if (!this.hardpointEditor.isActive()) return;
    const shipDef = getShipDef(shipId);
    if (!shipDef || shipId === this.currentShipId) return;

    // Swap ship model (same as changeShip but no tilt for editor)
    const savedState = { ...this.ship.state };
    this.scene.remove(this.ship.mesh);
    this.ship.dispose();

    const hasEmbedded = shipDef.source === "community" || !shipDef.texturePath;
    const texturePath = hasEmbedded ? undefined : this.getTexturePath(shipId, shipDef.name, this.currentShipColor);
    // Extract thruster positions from defaultHardpoints (supports multiple thrusters).
    // Coords are in mesh-local space — pass directly to Ship constructor.
    const thrusterHps = shipDef.defaultHardpoints?.filter((h) => h.type === "thruster");
    let thrusterPositions2 = thrusterHps && thrusterHps.length > 0
      ? thrusterHps.map((h) => ({
          x: h.localX, y: h.localY, z: h.localZ,
          thrustAngleDeg: (h as { thrustAngleDeg?: number }).thrustAngleDeg,
        }))
      : undefined;

    // Community ships without explicit thrusters: heading-compensated flame angle.
    const needsHeadingThruster2 = !thrusterPositions2 && !shipDef.thrusterPos && shipDef.defaultHeadingDeg;
    if (needsHeadingThruster2) {
      thrusterPositions2 = [{ x: 0, y: -1.6, z: 0, thrustAngleDeg: shipDef.defaultHeadingDeg }];
    }

    this.ship = new Ship({
      modelPath: shipDef.modelPath,
      texturePath,
      modelScale: shipDef.modelScale,
      modelHeadingDeg: shipDef.defaultHeadingDeg,
      thrusterPos: shipDef.thrusterPos,
      thrusterPositions: thrusterPositions2,
      materialConfig: shipDef.materialConfig,
    });
    this.ship.state = { ...savedState, shields: 1, armor: 1, heading: 0 };

    this.scene.add(this.ship.mesh);
    this.currentShipId = shipId;
    this.lighting.setShip(this.ship);

    // Tell editor about the new mesh with per-ship config.
    // Fallback: community ships without explicit hardpoints get a default thruster.
    const rawHps = shipDef.defaultHardpoints
      ?? (shipDef.source === "community"
        ? [{ type: "thruster", localX: 0, localY: -0.3, localZ: 0, label: "engine" }]
        : undefined);
    const defaultHps: Hardpoint[] | undefined = rawHps?.map((h, i) => ({
      id: `hp-${i + 1}`,
      type: h.type as HardpointType,
      localX: h.localX,
      localY: h.localY,
      localZ: h.localZ,
      label: h.label,
      thrustAngleDeg: (h as { thrustAngleDeg?: number }).thrustAngleDeg,
    }));
    this.hardpointEditor.changeShip(
      this.ship.mesh,
      defaultHps,
      { modelScale: shipDef.modelScale, defaultHeadingDeg: shipDef.defaultHeadingDeg },
    );
  }

  /** Set model scale in hardpoint editor */
  setHardpointShipScale(scale: number) {
    this.hardpointEditor.setShipScale(scale);
  }

  getHardpointShipScale(): number {
    return this.hardpointEditor.getShipScale();
  }

  /** Set heading rotation in hardpoint editor */
  setHardpointShipHeading(radians: number) {
    this.hardpointEditor.setShipHeading(radians);
  }

  getHardpointShipHeading(): number {
    return this.hardpointEditor.getShipHeading();
  }

  /** Adjust a hardpoint position on one axis.
   *  If the hardpoint is a thruster, also live-update the visual thruster flame. */
  updateHardpointPosition(id: string, axis: "x" | "y" | "z", value: number) {
    this.hardpointEditor.updateHardpointPosition(id, axis, value);

    // Sync visual thruster when a thruster hardpoint is moved
    const allHps = this.hardpointEditor.getHardpoints();
    const hp = allHps.find((h) => h.id === id);
    if (hp?.type === "thruster") {
      // Find this thruster's index among all thruster-type hardpoints
      const thrusterHps = allHps.filter((h) => h.type === "thruster");
      const thrusterIdx = thrusterHps.indexOf(hp);
      this.ship.setThrusterPosition(hp.localX, hp.localY, hp.localZ, thrusterIdx);
    }
  }

  /** Update a thruster hardpoint's flame angle and live-sync the visual */
  updateHardpointThrustAngle(id: string, angleDeg: number) {
    this.hardpointEditor.updateHardpointThrustAngle(id, angleDeg);

    // Sync visual thruster angle
    const allHps = this.hardpointEditor.getHardpoints();
    const hp = allHps.find((h) => h.id === id);
    if (hp?.type === "thruster") {
      const thrusterHps = allHps.filter((h) => h.type === "thruster");
      const thrusterIdx = thrusterHps.indexOf(hp);
      this.ship.setThrusterAngle(angleDeg, thrusterIdx);
    }
  }

  /** Set the locked axis for constrained drag */
  setHardpointLockedAxis(axis: "x" | "y" | "z" | null) {
    this.hardpointEditor.setLockedAxis(axis);
  }

  getHardpointLockedAxis(): "x" | "y" | "z" | null {
    return this.hardpointEditor.getLockedAxis();
  }

  /** Set a material property in the hardpoint editor */
  setHardpointMaterialProperty(property: string, value: number) {
    this.hardpointEditor.setMaterialProperty(property as any, value);
  }

  getHardpointMaterialConfig() {
    return this.hardpointEditor.getMaterialConfig();
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  private handleResize = () => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.cameraController.resize(width, height);
    // heroCamera doesn't need resize — it controls the main camera directly
    this.hardpointEditor.resize(width / height);
    this.postProcessing.resize(width, height);
    this.applyShiftOffset(); // world-unit ratio changes with viewport height
  };

  /** Tear down all subsystems, remove event listeners, free GPU resources */
  dispose() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleDebugKeys);
    this.canvas.removeEventListener("click", this.handleCanvasClick);
    this.canvas.removeEventListener("mousemove", this.handleCanvasMouseMove);
    this.orbitControls.dispose();
    this.input.dispose();
    this.starfield.dispose();
    this.nebulaBg.dispose();
    this.ship.dispose();
    for (const planet of this.planets) {
      planet.dispose();
    }
    this.npcManager.dispose();
    this.missionEngine.dispose();
    this.debugBeam.removeVisuals();
    this.postProcessing.dispose();
    this.heroCamera.dispose();
    this.hardpointEditor.dispose();
    SoundManager.dispose();
    this.renderer.dispose();
  }
}
