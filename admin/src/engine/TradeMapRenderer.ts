/**
 * Core 3D renderer for the admin trade map viewer.
 * Features: OrbitControls, space-drag panning, raycasting (planets + routes + cargo),
 * hover dimming, dead-route mode pass-through.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TradeMapBackground } from "./TradeMapBackground";
import { TradeMapPlanets, type DimState } from "./TradeMapPlanets";
import { TradeMapRoutes } from "./TradeMapRoutes";
import type {
  AdminPlanetMarketState,
  NpcTradeRoute,
  AdminDisruptionView,
  CommodityDef,
  CommodityCategory,
} from "../types";

export type SelectionInfo =
  | { type: "planet"; planetId: string }
  | { type: "route"; routeId: string }
  | null;

export type HoverInfo =
  | { type: "planet"; planetId: string; screenX: number; screenY: number }
  | { type: "route"; routeId: string; screenX: number; screenY: number }
  | {
      type: "cargo";
      routeId: string;
      screenX: number;
      screenY: number;
      commodityName: string;
      volume: number;
      source: string;
      dest: string;
      estimatedArrival: number;
    }
  | null;

export interface TradeMapData {
  planets: AdminPlanetMarketState[];
  routes: NpcTradeRoute[];
  disruptions: AdminDisruptionView[];
  commodityDefs: CommodityDef[];
}

export class TradeMapRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private animId = 0;

  // Subsystems
  private background: TradeMapBackground;
  private planets: TradeMapPlanets;
  private routes: TradeMapRoutes;

  // Interaction
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private onSelect: ((sel: SelectionInfo) => void) | null;
  private onHover: ((hov: HoverInfo) => void) | null;

  // Space-drag state
  private spaceHeld = false;
  private defaultMouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };

  // Dim state
  private lastDimKey = "";
  private deadRouteMode = false;

  constructor(
    canvas: HTMLCanvasElement,
    onSelect?: (sel: SelectionInfo) => void,
    onHover?: (hov: HoverInfo) => void,
  ) {
    this.onSelect = onSelect ?? null;
    this.onHover = onHover ?? null;

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x030308);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // ── Scene ──
    this.scene = new THREE.Scene();

    // ── Camera ──
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
    this.camera.position.set(10, 60, 50);
    this.camera.lookAt(10, 0, -5);

    // ── Controls ──
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(10, 0, -5);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 150;
    this.controls.enablePan = true;
    this.controls.panSpeed = 0.8;

    // Save default mouse button mapping
    this.defaultMouseButtons = {
      LEFT: THREE.MOUSE.ROTATE as number,
      MIDDLE: THREE.MOUSE.DOLLY as number,
      RIGHT: THREE.MOUSE.PAN as number,
    };

    // ── Lighting ──
    const ambient = new THREE.AmbientLight(0x8899aa, 0.8);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(20, 40, 30);
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x6688aa, 0.4);
    fillLight.position.set(-20, 10, -20);
    this.scene.add(fillLight);

    const hemi = new THREE.HemisphereLight(0x8899bb, 0x1a1a2e, 0.5);
    this.scene.add(hemi);

    // ── Subsystems ──
    this.background = new TradeMapBackground(this.scene);
    this.planets = new TradeMapPlanets(this.scene);
    this.routes = new TradeMapRoutes(this.scene);

    // ── Event listeners ──
    canvas.addEventListener("pointerdown", this.handleClick);
    canvas.addEventListener("pointermove", this.handleHover);
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);

    // ── Start loop ──
    this.resize(w, h);
    this.loop();
  }

  updateData(data: TradeMapData): void {
    this.planets.build(data.planets, data.disruptions);

    const planetPositions = new Map<string, THREE.Vector3>();
    for (const [id, meshData] of this.planets.planets) {
      planetPositions.set(
        id,
        new THREE.Vector3(meshData.position[0], 0, meshData.position[1]),
      );
    }

    this.routes.build(data.routes, data.commodityDefs, planetPositions);
  }

  updateLive(
    planets: AdminPlanetMarketState[],
    disruptions: AdminDisruptionView[],
  ): void {
    this.planets.updateFills(planets);
    this.planets.updateDisruptions(disruptions);
  }

  setFilter(categories: Set<CommodityCategory>): void {
    this.routes.setFilter(categories);
  }

  setDeadRouteMode(enabled: boolean, deadRouteIds: string[]): void {
    this.deadRouteMode = enabled;
    const idSet = new Set(deadRouteIds);
    this.routes.setDeadRouteMode(enabled, idSet);
    this.planets.setGlobalDim(enabled ? 0.3 : 1.0);
  }

  /**
   * Programmatic dim: highlight a specific route from React (e.g. event feed hover).
   * Pass null to clear.
   */
  highlightRoute(routeId: string | null): void {
    if (this.deadRouteMode) return;
    if (routeId) {
      const endpoints = this.routes.getRouteEndpoints(routeId);
      this.updateDimState(`ui-route:${routeId}`, {
        active: true,
        type: "route",
        routeId,
        connectedPlanets: new Set(endpoints ?? []),
      });
    } else {
      this.updateDimState("", { active: false });
    }
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.animId);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handleClick);
    canvas.removeEventListener("pointermove", this.handleHover);
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.background.dispose(this.scene);
    this.planets.dispose();
    this.routes.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }

  // ── Private ──

  private loop = (): void => {
    this.animId = requestAnimationFrame(this.loop);
    const dt = this.clock.getDelta();
    const time = this.clock.getElapsedTime();

    this.controls.update();
    this.planets.animate(time, dt);
    this.routes.animate(dt);
    this.renderer.render(this.scene, this.camera);
  };

  // ── Space-drag (Figma-style pan) ──

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Space" && !this.spaceHeld) {
      e.preventDefault();
      this.spaceHeld = true;
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN as number,
        MIDDLE: THREE.MOUSE.PAN as number,
        RIGHT: THREE.MOUSE.PAN as number,
      };
      this.renderer.domElement.style.cursor = "grab";
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space") {
      this.spaceHeld = false;
      this.controls.mouseButtons = this.defaultMouseButtons;
      this.renderer.domElement.style.cursor = "default";
    }
  };

  private handleBlur = (): void => {
    if (this.spaceHeld) {
      this.spaceHeld = false;
      this.controls.mouseButtons = this.defaultMouseButtons;
      this.renderer.domElement.style.cursor = "default";
    }
  };

  private handlePointerDown = (): void => {
    if (this.spaceHeld) {
      this.renderer.domElement.style.cursor = "grabbing";
    }
  };

  private handlePointerUp = (): void => {
    if (this.spaceHeld) {
      this.renderer.domElement.style.cursor = "grab";
    }
  };

  // ── Click ──

  private handleClick = (e: PointerEvent): void => {
    if (!this.onSelect || this.spaceHeld) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Test planets first
    const planetHits = this.raycaster.intersectObjects(
      this.planets.getClickTargets(),
      false,
    );
    if (planetHits.length > 0) {
      const planetId = planetHits[0]?.object.userData.planetId as string | undefined;
      if (planetId) {
        this.onSelect({ type: "planet", planetId });
        return;
      }
    }

    // Test cargo (click selects parent route)
    const cargoHits = this.raycaster.intersectObjects(
      this.routes.getCargoTargets(),
      false,
    );
    if (cargoHits.length > 0) {
      const routeId = cargoHits[0]?.object.userData.routeId as string | undefined;
      if (routeId) {
        this.onSelect({ type: "route", routeId });
        return;
      }
    }

    // Test route lines
    this.raycaster.params.Line!.threshold = 1.5;
    const routeHits = this.raycaster.intersectObjects(
      this.routes.getClickTargets(),
      false,
    );
    if (routeHits.length > 0) {
      const routeId = routeHits[0]?.object.userData.routeId as string | undefined;
      if (routeId) {
        this.onSelect({ type: "route", routeId });
        return;
      }
    }

    this.onSelect(null);
  };

  // ── Hover (with dimming) ──

  private handleHover = (e: PointerEvent): void => {
    if (this.spaceHeld) return; // Skip raycasting during pan

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Test planets
    const planetHits = this.raycaster.intersectObjects(
      this.planets.getClickTargets(),
      false,
    );
    if (planetHits.length > 0) {
      const planetId = planetHits[0]?.object.userData.planetId as string | undefined;
      if (planetId) {
        this.onHover?.({
          type: "planet",
          planetId,
          screenX: e.clientX,
          screenY: e.clientY,
        });
        this.renderer.domElement.style.cursor = "pointer";
        this.updateDimState(`planet:${planetId}`, {
          active: true,
          type: "planet",
          planetId,
        });
        return;
      }
    }

    // Test cargo ships (before route lines — more specific)
    const cargoHits = this.raycaster.intersectObjects(
      this.routes.getCargoTargets(),
      false,
    );
    if (cargoHits.length > 0) {
      const ud = cargoHits[0]?.object.userData;
      const routeId = ud?.routeId as string | undefined;
      if (routeId && ud) {
        const progress =
          (Date.now() - (ud.lastDeparture as number)) /
          (ud.tripDurationMs as number);
        const remaining = Math.max(
          0,
          (1 - progress) * (ud.tripDurationMs as number),
        );
        this.onHover?.({
          type: "cargo",
          routeId,
          screenX: e.clientX,
          screenY: e.clientY,
          commodityName: ud.commodityName as string,
          volume: ud.volume as number,
          source: ud.source as string,
          dest: ud.dest as string,
          estimatedArrival: remaining,
        });
        this.renderer.domElement.style.cursor = "pointer";
        // Dim as if hovering the parent route
        const endpoints = this.routes.getRouteEndpoints(routeId);
        this.updateDimState(`route:${routeId}`, {
          active: true,
          type: "route",
          routeId,
          connectedPlanets: new Set(endpoints ?? []),
        });
        return;
      }
    }

    // Test route lines
    this.raycaster.params.Line!.threshold = 1.5;
    const routeHits = this.raycaster.intersectObjects(
      this.routes.getClickTargets(),
      false,
    );
    if (routeHits.length > 0) {
      const routeId = routeHits[0]?.object.userData.routeId as string | undefined;
      if (routeId) {
        this.onHover?.({
          type: "route",
          routeId,
          screenX: e.clientX,
          screenY: e.clientY,
        });
        this.renderer.domElement.style.cursor = "pointer";
        const endpoints = this.routes.getRouteEndpoints(routeId);
        this.updateDimState(`route:${routeId}`, {
          active: true,
          type: "route",
          routeId,
          connectedPlanets: new Set(endpoints ?? []),
        });
        return;
      }
    }

    // Nothing hovered
    this.onHover?.(null);
    this.renderer.domElement.style.cursor = "default";
    this.updateDimState("", { active: false });
  };

  private updateDimState(key: string, state: DimState): void {
    if (key === this.lastDimKey) return;
    this.lastDimKey = key;
    if (!this.deadRouteMode) {
      this.planets.setDimState(state);
      this.routes.setDimState(state);
    }
  }
}
