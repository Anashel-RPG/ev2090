import * as THREE from "three";
import { Ship } from "./entities/Ship";
import { Planet } from "./entities/Planet";
import { Starfield } from "./systems/Starfield";
import { NebulaBg } from "./systems/NebulaBg";
import { InputManager } from "./systems/InputManager";
import { CameraController, type DebugView } from "./systems/CameraController";
import { ModelCache } from "./systems/ModelCache";
import { SoundManager } from "./systems/SoundManager";
import { SHIP_CATALOG, getShipDef } from "./ShipCatalog";
import { generatePlanetTexture } from "./systems/PlanetTextureGen";
import { LightingSetup } from "./systems/LightingSetup";
import { NpcManager } from "./systems/NpcManager";
import { DebugBeam } from "./systems/DebugBeam";
import { OrbitControls } from "./systems/OrbitControls";
import type { GameState, RadarContact, LightConfig, ShipColor } from "@/types/game";

/**
 * Core game engine. Manages the Three.js scene, game loop, and all systems.
 * Designed to be mounted into a React component via a canvas element.
 */

// Sound URLs
const SFX_THRUSTER = "https://cdn.ev2090.com/sound/thurster.mp3";
const SFX_PING = "https://cdn.ev2090.com/sound/ping.mp3";

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

  private animationId: number | null = null;
  private lastTime = 0;
  private frameCount = 0;
  private fpsTime = 0;
  private currentFps = 0;
  currentShipId = "striker";
  currentShipColor: ShipColor = "Blue";

  // Sound state
  private thrusterPlaying = false;

  // Sidebar pixel width — used to center ship in playable area via camera offset
  private sidebarWidthPx = 0;

  private canvas: HTMLCanvasElement;

  private onStateUpdate: ((state: GameState) => void) | null = null;
  private container: HTMLElement;

  constructor(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.container = container;
    this.canvas = canvas;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Renderer — create WebGL2 context first to avoid FLIP_Y 3D texture warning
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

    // Scene
    this.scene = new THREE.Scene();

    // Lighting
    this.lighting = new LightingSetup(this.scene);

    // Camera
    this.cameraController = new CameraController(width, height);

    // Systems
    this.input = new InputManager();
    this.starfield = new Starfield(this.scene);

    // Nebula background — fixed behind everything
    this.nebulaBg = new NebulaBg();
    this.scene.add(this.nebulaBg.group);

    // Entities
    this.ship = new Ship();
    this.ship.setTilt((-22 * Math.PI) / 180);
    this.scene.add(this.ship.mesh);

    // Wire up lighting to ship and nebula
    this.lighting.setShip(this.ship);
    this.lighting.setNebulaBg(this.nebulaBg);

    // NPC Manager
    this.npcManager = new NpcManager(this.scene);

    // Debug Beam
    this.debugBeam = new DebugBeam(this.scene);

    // Orbit Controls
    this.orbitControls = new OrbitControls(this.canvas, this.cameraController);
    this.orbitControls.attach();

    // ─── Solar System: multiple planets ───

    const planetConfigs = [
      {
        name: "Nexara",
        position: { x: 25, y: 15 },
        radius: 6,
        texturePath: "/textures/planet-earth.jpg",
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

    // Pre-load all ship GLTF models so spawns are instant (no frame stutter)
    ModelCache.preloadModels(SHIP_CATALOG.map((s) => s.modelPath));

    // Pre-load sound effects
    SoundManager.preload(SFX_PING);
    SoundManager.preload(SFX_THRUSTER);

    // Handle resize
    window.addEventListener("resize", this.handleResize);

    // Debug keyboard shortcut: B = toggle beam
    window.addEventListener("keydown", this.handleDebugKeys);

    // Start loop
    this.lastTime = performance.now();
    this.fpsTime = this.lastTime;
    this.loop(this.lastTime);
  }

  /** Subscribe to game state updates (called ~60fps) */
  subscribe(callback: (state: GameState) => void) {
    this.onStateUpdate = callback;
  }

  /** Switch to a different ship model (preserves position/velocity) */
  changeShip(shipId: string) {
    const shipDef = getShipDef(shipId);
    if (!shipDef || shipId === this.currentShipId) return;

    // If current color is a custom texture not available on the new ship, fall back to Blue
    const isCustomColor = !["Blue", "Green", "Orange", "Purple", "Red"].includes(this.currentShipColor);
    if (isCustomColor && !shipDef.extraTextures?.[this.currentShipColor]) {
      this.currentShipColor = "Blue";
    }

    const savedState = { ...this.ship.state };
    this.scene.remove(this.ship.mesh);
    this.ship.dispose();

    const texturePath = this.getTexturePath(shipId, shipDef.name, this.currentShipColor);
    this.ship = new Ship({ modelPath: shipDef.modelPath, texturePath });
    this.ship.state = { ...savedState, shields: 1, armor: 1 };
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

    const texturePath = this.getTexturePath(this.currentShipId, shipDef.name, color);
    this.ship.changeTexture(texturePath);
    this.currentShipColor = color;
  }

  /** Build texture path — handles custom textures (e.g. Challenger Fire) */
  private getTexturePath(shipId: string, shipName: string, color: ShipColor): string {
    const shipDef = getShipDef(shipId);
    if (shipDef?.extraTextures?.[color]) {
      return shipDef.extraTextures[color];
    }
    return `/models/${shipId}/${shipName}_${color}.png`;
  }

  // ─── Light Debug API ───

  /** Get current light configuration for debug panel */
  getLightConfig(): LightConfig {
    return this.lighting.getLightConfig();
  }

  /** Update a single light property in real time */
  updateLight(lightName: string, property: string, value: number) {
    this.lighting.updateLight(lightName, property, value);
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

    this.ship.update(dt, this.input.state);

    for (const planet of this.planets) {
      planet.update(dt);
    }

    // NPC update (scanner detection, spawning, removal)
    const { fwdX, fwdY, px, py } = this.npcManager.update(dt, this.ship, this.planets);

    // Debug beam visualization
    this.debugBeam.update(px, py, fwdX, fwdY, this.npcManager.getNpcs());

    // Sound: thruster loop
    this.updateThrusterSound();

    this.cameraController.setTarget(
      this.ship.position.x,
      this.ship.position.y,
    );

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

    this.cameraController.update();

    this.starfield.update(
      this.cameraController.camera.position.x,
      this.cameraController.camera.position.y,
    );

    // Keep nebula centered on camera (no parallax — fixed background)
    this.nebulaBg.update(
      this.cameraController.camera.position.x,
      this.cameraController.camera.position.y,
    );

    this.renderer.render(this.scene, this.cameraController.getActiveCamera());

    if (this.frameCount % 3 === 0 && this.onStateUpdate) {
      this.onStateUpdate(this.getGameState());
    }
  };

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

    let nearestPlanet: string | null = null;
    let nearestDistance: number | null = null;
    for (const planet of this.planets) {
      const dist = planet.distanceTo(this.ship.position);
      if (nearestDistance === null || dist < nearestDistance) {
        nearestDistance = dist;
        nearestPlanet = planet.name;
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
    };
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

  private handleDebugKeys = (e: KeyboardEvent) => {
    // Don't capture keys when typing in input fields
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.code === "KeyB") {
      this.setBeamVisible(!this.debugBeam.isVisible());
    }
  };

  /**
   * Notify the engine of the permanent sidebar width (pixels).
   * Shifts the ortho camera right so the ship stays centered in the playable area.
   * Call once after mount and whenever the breakpoint changes.
   */
  setSidebarWidthPx(px: number) {
    this.sidebarWidthPx = px;
    this.applyShiftOffset();
  }

  private applyShiftOffset() {
    // viewSize is the vertical world extent of the ortho camera (40 units).
    // 1 pixel vertically = viewSize / containerHeight world units.
    // We shift right by half the sidebar width so the ship centers in the playable area.
    const worldOffset =
      (this.sidebarWidthPx / 2) *
      (this.cameraController.viewSize / this.container.clientHeight);
    this.cameraController.setSidebarOffset(worldOffset);
  }

  private handleResize = () => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.cameraController.resize(width, height);
    this.applyShiftOffset(); // world-unit ratio changes with viewport height
  };

  dispose() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("keydown", this.handleDebugKeys);
    this.orbitControls.dispose();
    this.input.dispose();
    this.starfield.dispose();
    this.nebulaBg.dispose();
    this.ship.dispose();
    for (const planet of this.planets) {
      planet.dispose();
    }
    this.npcManager.dispose();
    this.debugBeam.removeVisuals();
    SoundManager.dispose();
    this.renderer.dispose();
  }
}
