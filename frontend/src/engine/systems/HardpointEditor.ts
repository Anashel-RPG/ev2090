import * as THREE from "three";
import type { Hardpoint, HardpointType } from "@/types/game";

/**
 * Ship hardpoint placement editor.
 *
 * When active, isolates the ship on a neutral grey background with orbit
 * camera controls. The user clicks the hull to place colored markers,
 * selects them for fine X/Y/Z adjustment, and exports as JSON.
 *
 * Labels with leader lines automatically position themselves to the
 * nearest side (left / right) of the model as the camera orbits.
 *
 * Pattern: constructor(scene, canvas) + activate/deactivate + update() + dispose()
 */

const MARKER_COLORS: Record<HardpointType, number> = {
  thruster: 0xff6600,
  weapon: 0xff0000,
  bridge: 0x00ccff,
  hull: 0x888888,
  shield: 0x8833ff,
};

export interface ShipMaterialConfig {
  metalness: number;
  roughness: number;
  emissiveIntensity: number;
  emissiveR: number; // 0-255
  emissiveG: number;
  emissiveB: number;
}

const DEFAULT_MATERIAL: ShipMaterialConfig = {
  metalness: 0.4,
  roughness: 0.2,
  emissiveIntensity: 0.15,
  emissiveR: 34,
  emissiveG: 34,
  emissiveB: 51,
};

const MARKER_RADIUS = 0.08;
const LABEL_OFFSET_PX = 140;
const BG_COLOR = 0x2a2a2a;

export class HardpointEditor {
  private scene: THREE.Scene;
  private canvas: HTMLCanvasElement;
  private camera: THREE.PerspectiveCamera;
  private active = false;
  private shipMesh: THREE.Group | null = null;

  // Hardpoint data
  private hardpoints: Hardpoint[] = [];
  private markers = new Map<string, THREE.Mesh>();
  private markerGroup = new THREE.Group();
  private selectedId: string | null = null;
  private placementType: HardpointType = "thruster";

  // Thrust direction arrows (thruster-only visual: shaft line + cone tip)
  private thrustArrows = new Map<string, { shaft: THREE.Line; cone: THREE.Mesh }>();
  /** Shared cone geometry for thrust direction arrowheads */
  private static readonly ARROW_CONE_GEO = new THREE.ConeGeometry(0.04, 0.12, 8);
  private static readonly ARROW_LENGTH = 0.6;
  private static readonly ARROW_COLOR = 0xff6600;

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private raycastTargets: THREE.Object3D[] = [];

  // Orbit camera
  private azimuth = Math.PI / 6;
  private elevation = Math.PI / 4;
  private orbitDistance = 6;
  private orbitCenter = new THREE.Vector3(0, 0, 10);

  // Mouse drag
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Axis-constrained drag
  private lockedAxis: "x" | "y" | "z" | null = null;
  private axisGuideLine: THREE.Line | null = null;
  private axisDragActive = false;
  /** Previous axis-projection value — used for delta-based drag sensitivity */
  private axisDragPrevT: number | null = null;
  /** Sensitivity multiplier for axis drag (lower = finer control) */
  private static readonly AXIS_DRAG_SENSITIVITY = 0.25;
  /** Screen-space pixel radius for axis drag grab zone (much easier to click than the tiny 3D sphere) */
  private static readonly AXIS_GRAB_RADIUS_PX = 50;

  // Saved state for restore
  private savedShipPosition = new THREE.Vector3();
  private savedShipRotation = new THREE.Euler();
  private savedBackground: THREE.Color | THREE.Texture | null = null;
  private hiddenObjects: THREE.Object3D[] = [];

  // Editor lights (clean viewer illumination)
  private editorLights: THREE.Light[] = [];

  // Label overlay (HTML + SVG for crisp text and lines)
  private overlay: HTMLDivElement | null = null;
  private svgEl: SVGSVGElement | null = null;
  private labelEls = new Map<string, { div: HTMLDivElement; line: SVGLineElement }>();

  private nextId = 1;

  // Ship tuning (live adjustable from panel)
  private shipScale = 0.4;
  private shipHeading = 0; // radians, Z-axis rotation in game
  private materialConfig: ShipMaterialConfig = { ...DEFAULT_MATERIAL };

  /** False until the GLTF model group appears as a child of shipMesh.
   *  When false, update() keeps retrying setShipScale / collectRaycastTargets
   *  so that async-loaded models get correct config. */
  private modelGroupReady = false;

  constructor(scene: THREE.Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.canvas = canvas;

    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.camera.up.set(0, 0, 1);

    this.markerGroup.name = "hardpoint-markers";
  }

  // ─── Lifecycle ───

  activate(
    shipMesh: THREE.Group,
    existingHardpoints?: Hardpoint[],
    shipTuning?: { modelScale?: number; defaultHeadingDeg?: number },
  ) {
    if (this.active) return; // guard against double-activation
    this.active = true;
    this.shipMesh = shipMesh;

    // Save & set grey background
    this.savedBackground = this.scene.background as THREE.Color | THREE.Texture | null;
    this.scene.background = new THREE.Color(BG_COLOR);

    // Hide all scene children except the ship — gives clean viewer look
    this.hiddenObjects = [];
    for (const child of this.scene.children) {
      if (child === shipMesh || child === this.markerGroup) continue;
      if (child.visible) {
        this.hiddenObjects.push(child);
        child.visible = false;
      }
    }

    // Add clean viewer lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(5, -5, 15);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-5, 5, 8);
    this.editorLights = [ambient, key, fill];
    for (const l of this.editorLights) this.scene.add(l);

    // Save ship position/rotation, center at orbit point
    this.savedShipPosition.copy(shipMesh.position);
    this.savedShipRotation.copy(shipMesh.rotation);
    shipMesh.position.set(0, 0, 10);
    shipMesh.rotation.set(0, 0, 0);
    shipMesh.updateMatrixWorld(true);

    this.collectRaycastTargets();
    this.orbitCenter.set(0, 0, 10);

    // Load existing hardpoints
    if (existingHardpoints) {
      for (const hp of existingHardpoints) this.addHardpoint(hp);
    }

    // Apply per-ship tuning (from ShipDef) or defaults
    this.shipScale = shipTuning?.modelScale ?? 0.4;
    this.shipHeading = (shipTuning?.defaultHeadingDeg ?? 0) * (Math.PI / 180);

    // Apply scale + heading to the model (may be deferred if GLTF is still loading)
    this.modelGroupReady = this.hasModelGroup();
    this.setShipScale(this.shipScale);
    this.setShipHeading(this.shipHeading);

    // Snapshot current material values from the loaded model
    if (this.modelGroupReady) this.snapshotMaterial();

    this.scene.add(this.markerGroup);
    this.createOverlay();

    // Auto-place a default thruster if none provided
    this.addDefaultThruster();

    // Ensure nextId won't collide with loaded IDs, and auto-select first point
    this.syncNextId();
    this.autoSelectFirst();

    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("contextmenu", this.handleRightClick);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    this.canvas.addEventListener("mousemove", this.handleMouseMove);
    this.canvas.addEventListener("mouseup", this.handleMouseUp);
    this.canvas.addEventListener("wheel", this.handleWheel);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;

    // Restore scene background
    this.scene.background = this.savedBackground;

    // Restore hidden objects
    for (const obj of this.hiddenObjects) obj.visible = true;
    this.hiddenObjects = [];

    // Remove editor lights
    for (const l of this.editorLights) {
      this.scene.remove(l);
      l.dispose();
    }
    this.editorLights = [];

    // Restore ship
    if (this.shipMesh) {
      this.shipMesh.position.copy(this.savedShipPosition);
      this.shipMesh.rotation.copy(this.savedShipRotation);
    }

    // Clean up markers + thrust arrows
    this.removeAllThrustArrows();
    for (const [, marker] of this.markers) {
      this.markerGroup.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.MeshBasicMaterial).dispose();
    }
    this.markers.clear();
    this.hardpoints = [];
    this.scene.remove(this.markerGroup);

    this.removeOverlay();

    this.shipMesh = null;
    this.selectedId = null;
    this.nextId = 1;
    this.raycastTargets = [];
    this.lockedAxis = null;
    this.axisDragActive = false;
    this.axisDragPrevT = null;
    this.removeAxisGuideLine();

    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("contextmenu", this.handleRightClick);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("mousemove", this.handleMouseMove);
    this.canvas.removeEventListener("mouseup", this.handleMouseUp);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  isActive(): boolean {
    return this.active;
  }

  dispose() {
    this.deactivate();
  }

  // ─── Public API ───

  setPlacementType(type: HardpointType) {
    this.placementType = type;
  }

  getPlacementType(): HardpointType {
    return this.placementType;
  }

  getHardpoints(): Hardpoint[] {
    return [...this.hardpoints];
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  /** Set model scale (live tuning from panel).
   *  Targets the GLTF model group (nested inside the visualGroup), NOT
   *  the visualGroup itself — thrusters shouldn't scale with the model. */
  setShipScale(scale: number) {
    this.shipScale = scale;
    const modelGroup = this.findModelGroup();
    if (modelGroup) modelGroup.scale.setScalar(scale);
  }

  getShipScale(): number {
    return this.shipScale;
  }

  /** Set heading rotation (Z-axis, radians) to preview default heading.
   *  Rotates the visualGroup (first child Group) — NOT shipMesh — so the
   *  heading isn't applied twice (the Ship constructor already sets
   *  visualGroup.rotation.z = modelHeadingRad). */
  setShipHeading(radians: number) {
    this.shipHeading = radians;
    if (!this.shipMesh) return;

    // Apply heading to the visual group, not the top-level mesh
    const visualGroup = this.findVisualGroup();
    if (visualGroup) visualGroup.rotation.z = radians;

    // Markers use visualGroup as coordinate root, so repositioning after
    // heading change automatically places them at the correct world position.
    this.repositionAllMarkers();
  }

  getShipHeading(): number {
    return this.shipHeading;
  }

  // ─── Ship material tuning ───

  /** Update a single material property on the ship and apply to all meshes */
  setMaterialProperty(property: keyof ShipMaterialConfig, value: number) {
    this.materialConfig[property] = value;
    this.applyMaterial();
  }

  getMaterialConfig(): ShipMaterialConfig {
    return { ...this.materialConfig };
  }

  /** Read current material values from the ship mesh (call after model loads) */
  private snapshotMaterial() {
    if (!this.shipMesh) return;
    let found = false;
    this.shipMesh.traverse((child) => {
      if (found) return;
      if (
        child instanceof THREE.Mesh &&
        child.material instanceof THREE.MeshStandardMaterial
      ) {
        const mat = child.material;
        this.materialConfig.metalness = mat.metalness;
        this.materialConfig.roughness = mat.roughness;
        this.materialConfig.emissiveIntensity = mat.emissiveIntensity;
        this.materialConfig.emissiveR = Math.round(mat.emissive.r * 255);
        this.materialConfig.emissiveG = Math.round(mat.emissive.g * 255);
        this.materialConfig.emissiveB = Math.round(mat.emissive.b * 255);
        found = true;
      }
    });
  }

  /** Apply current materialConfig to all MeshStandardMaterial on the ship */
  private applyMaterial() {
    if (!this.shipMesh) return;
    const c = this.materialConfig;
    const emissive = new THREE.Color(c.emissiveR / 255, c.emissiveG / 255, c.emissiveB / 255);
    this.shipMesh.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.material instanceof THREE.MeshStandardMaterial
      ) {
        child.material.metalness = c.metalness;
        child.material.roughness = c.roughness;
        child.material.emissiveIntensity = c.emissiveIntensity;
        child.material.emissive.copy(emissive);
        child.material.needsUpdate = true;
      }
    });
  }

  // ─── Axis lock for constrained drag ───

  setLockedAxis(axis: "x" | "y" | "z" | null) {
    this.lockedAxis = axis;
    this.updateAxisGuideLine();
  }

  getLockedAxis(): "x" | "y" | "z" | null {
    return this.lockedAxis;
  }

  /** Cycle through axes: null → x → y → z → x ... */
  cycleLockedAxis() {
    const order: ("x" | "y" | "z")[] = ["x", "y", "z"];
    if (!this.lockedAxis) {
      this.lockedAxis = "x";
    } else {
      const idx = order.indexOf(this.lockedAxis);
      this.lockedAxis = order[(idx + 1) % 3]!;
    }
    this.updateAxisGuideLine();
  }

  /** Add a default thruster hardpoint at (0, baseY, 0) if none exist */
  addDefaultThruster() {
    const hasThruster = this.hardpoints.some((h) => h.type === "thruster");
    if (hasThruster) return;

    const id = `hp-${this.nextId++}`;
    const hp: Hardpoint = {
      id,
      type: "thruster",
      localX: 0,
      localY: -0.3,
      localZ: 0,
      label: "engine",
    };
    this.addHardpoint(hp);
    // Auto-select so ADJUST POSITION is immediately visible
    this.selectHardpoint(id);
  }

  selectHardpoint(id: string | null) {
    // Deselect previous
    if (this.selectedId) {
      const prev = this.markers.get(this.selectedId);
      if (prev) {
        const hp = this.hardpoints.find((h) => h.id === this.selectedId);
        if (hp) {
          (prev.material as THREE.MeshBasicMaterial).color.setHex(MARKER_COLORS[hp.type]);
        }
      }
    }
    this.selectedId = id;
    if (id) {
      const marker = this.markers.get(id);
      if (marker) {
        (marker.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
      }
    }
  }

  deleteHardpoint(id: string) {
    const idx = this.hardpoints.findIndex((h) => h.id === id);
    if (idx === -1) return;
    this.hardpoints.splice(idx, 1);

    this.removeThrustArrow(id);
    const marker = this.markers.get(id);
    if (marker) {
      this.markerGroup.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.MeshBasicMaterial).dispose();
      this.markers.delete(id);
    }

    this.removeLabelEl(id);
    if (this.selectedId === id) this.selectedId = null;
  }

  /**
   * Swap the ship mesh (e.g. switching models).
   * Clears old hardpoints, loads new per-ship defaults, applies tuning.
   */
  changeShip(
    newShipMesh: THREE.Group,
    newHardpoints?: Hardpoint[],
    shipTuning?: { modelScale?: number; defaultHeadingDeg?: number },
  ) {
    if (!this.active) return;

    // Clear existing hardpoints + markers + thrust arrows
    this.removeAllThrustArrows();
    for (const [id, marker] of this.markers) {
      this.markerGroup.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.MeshBasicMaterial).dispose();
      this.removeLabelEl(id);
    }
    this.markers.clear();
    this.hardpoints = [];
    this.selectedId = null;
    this.nextId = 1;

    // Save new mesh's original position for later restore
    this.savedShipPosition.copy(newShipMesh.position);
    this.savedShipRotation.copy(newShipMesh.rotation);

    // Center new ship at orbit point
    newShipMesh.position.set(0, 0, 10);
    newShipMesh.rotation.set(0, 0, 0);
    newShipMesh.updateMatrixWorld(true);

    this.shipMesh = newShipMesh;
    this.collectRaycastTargets();

    // Apply per-ship tuning (from ShipDef) or defaults
    // May be deferred if GLTF model is still loading async
    this.shipScale = shipTuning?.modelScale ?? 0.4;
    this.shipHeading = (shipTuning?.defaultHeadingDeg ?? 0) * (Math.PI / 180);
    this.modelGroupReady = this.hasModelGroup();
    this.setShipScale(this.shipScale);
    this.setShipHeading(this.shipHeading);

    // Reset material config to defaults and re-snapshot from new model
    this.materialConfig = { ...DEFAULT_MATERIAL };
    if (this.modelGroupReady) this.snapshotMaterial();

    // Load per-ship hardpoints
    if (newHardpoints) {
      for (const hp of newHardpoints) this.addHardpoint(hp);
    }

    // Auto-place a default thruster if none provided
    this.addDefaultThruster();

    // Ensure nextId won't collide with loaded IDs, and auto-select first point
    this.syncNextId();
    this.autoSelectFirst();
  }

  /** Update a thruster hardpoint's flame angle */
  updateHardpointThrustAngle(id: string, angleDeg: number) {
    const hp = this.hardpoints.find((h) => h.id === id);
    if (!hp || hp.type !== "thruster") return;
    hp.thrustAngleDeg = angleDeg;
    // Arrow will update automatically in the next update() call
  }

  // ─── Thrust direction arrows ───

  /** Create a direction arrow for a thruster hardpoint (shaft + cone arrowhead) */
  private createThrustArrow(id: string): { shaft: THREE.Line; cone: THREE.Mesh } {
    const shaftMat = new THREE.LineBasicMaterial({
      color: HardpointEditor.ARROW_COLOR,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const shaftGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ]);
    const shaft = new THREE.Line(shaftGeo, shaftMat);
    shaft.renderOrder = 998;

    const coneMat = new THREE.MeshBasicMaterial({
      color: HardpointEditor.ARROW_COLOR,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const cone = new THREE.Mesh(HardpointEditor.ARROW_CONE_GEO, coneMat);
    cone.renderOrder = 998;

    this.markerGroup.add(shaft);
    this.markerGroup.add(cone);
    this.thrustArrows.set(id, { shaft, cone });
    return { shaft, cone };
  }

  /** Remove a thrust arrow by hardpoint ID */
  private removeThrustArrow(id: string) {
    const arrow = this.thrustArrows.get(id);
    if (!arrow) return;
    this.markerGroup.remove(arrow.shaft);
    this.markerGroup.remove(arrow.cone);
    arrow.shaft.geometry.dispose();
    (arrow.shaft.material as THREE.LineBasicMaterial).dispose();
    (arrow.cone.material as THREE.MeshBasicMaterial).dispose();
    this.thrustArrows.delete(id);
  }

  /** Remove all thrust arrows */
  private removeAllThrustArrows() {
    for (const [id] of this.thrustArrows) this.removeThrustArrow(id);
  }

  /** Update all thrust direction arrows to match current marker positions + angles.
   *  Called every frame from update(). */
  private updateThrustArrows() {
    if (!this.shipMesh) return;
    this.shipMesh.updateMatrixWorld(true);
    const root = this.getCoordRoot();

    for (const hp of this.hardpoints) {
      if (hp.type !== "thruster") continue;

      // Ensure arrow exists
      let arrow = this.thrustArrows.get(hp.id);
      if (!arrow) arrow = this.createThrustArrow(hp.id);

      const marker = this.markers.get(hp.id);
      if (!marker) continue;

      const origin = marker.position.clone();

      // Compute thrust direction in world space.
      // In visualGroup-local space the flame points -Y, rotated by thrustAngleDeg around Z.
      const angleDeg = hp.thrustAngleDeg ?? 0;
      const angleRad = (angleDeg * Math.PI) / 180;
      const localDir = new THREE.Vector3(
        Math.sin(angleRad),   // -Y rotated CW by angle → sin component on X
        -Math.cos(angleRad),  // -Y rotated CW by angle → -cos component on Y
        0,
      );

      // Transform direction from visualGroup-local to world
      const localEnd = new THREE.Vector3(hp.localX, hp.localY, hp.localZ).add(localDir);
      const worldEnd = localEnd.clone();
      root.localToWorld(worldEnd);
      const worldDir = worldEnd.sub(origin).normalize();

      const len = HardpointEditor.ARROW_LENGTH;
      const tipPos = origin.clone().addScaledVector(worldDir, len);

      // Update shaft line
      const positions = arrow.shaft.geometry.attributes.position as THREE.BufferAttribute;
      positions.setXYZ(0, origin.x, origin.y, origin.z);
      positions.setXYZ(1, tipPos.x, tipPos.y, tipPos.z);
      positions.needsUpdate = true;

      // Update cone position + orientation
      arrow.cone.position.copy(tipPos);
      // ConeGeometry points +Y by default — align it with worldDir
      const up = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(up, worldDir);
      arrow.cone.quaternion.copy(quat);
    }

    // Remove stale arrows for deleted / non-thruster hardpoints
    for (const [id] of this.thrustArrows) {
      const hp = this.hardpoints.find((h) => h.id === id);
      if (!hp || hp.type !== "thruster") this.removeThrustArrow(id);
    }
  }

  /** Adjust a hardpoint's position on one axis */
  updateHardpointPosition(id: string, axis: "x" | "y" | "z", value: number) {
    const hp = this.hardpoints.find((h) => h.id === id);
    if (!hp || !this.shipMesh) return;

    const rounded = Math.round(value * 1000) / 1000;
    if (axis === "x") hp.localX = rounded;
    else if (axis === "y") hp.localY = rounded;
    else hp.localZ = rounded;

    const marker = this.markers.get(id);
    if (marker) {
      this.shipMesh.updateMatrixWorld(true);
      const root = this.getCoordRoot();
      const worldPos = new THREE.Vector3(hp.localX, hp.localY, hp.localZ);
      root.localToWorld(worldPos);
      marker.position.copy(worldPos);
    }
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  update() {
    if (!this.active) return;

    // Deferred model setup: if the GLTF model was still loading async when
    // we applied tuning, re-apply now that the model group has appeared.
    // This fixes per-ship scale/heading/raycast not working on async loads.
    if (!this.modelGroupReady && this.shipMesh) {
      if (this.hasModelGroup()) {
        this.modelGroupReady = true;
        // Re-apply scale to the now-present model group
        this.setShipScale(this.shipScale);
        // Re-apply heading (also repositions all markers)
        this.setShipHeading(this.shipHeading);
        // Re-collect raycast targets from loaded geometry
        this.collectRaycastTargets();
        // Reposition all markers now that the model transform is correct
        this.repositionAllMarkers();
        // Snapshot material values from freshly-loaded model
        this.snapshotMaterial();
        // Ensure something is selected (covers async-load race conditions)
        this.autoSelectFirst();
      }
    }

    // Orbit camera
    const cx = this.orbitCenter.x;
    const cy = this.orbitCenter.y;
    const cz = this.orbitCenter.z;
    const camX = cx + this.orbitDistance * Math.cos(this.elevation) * Math.sin(this.azimuth);
    const camY = cy - this.orbitDistance * Math.cos(this.elevation) * Math.cos(this.azimuth);
    const camZ = cz + this.orbitDistance * Math.sin(this.elevation);
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(cx, cy, cz);

    // Update label overlay positions
    this.updateLabels();

    // Update thrust direction arrows for all thruster hardpoints
    this.updateThrustArrows();

    // Keep axis guide line in sync with marker/heading changes
    if (this.lockedAxis) this.updateAxisGuideLine();
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Find the visualGroup by name (robust against hierarchy changes like bankGroup insertion) */
  private findVisualGroup(): THREE.Group | null {
    if (!this.shipMesh) return null;
    const found = this.shipMesh.getObjectByName("visual-group");
    if (found instanceof THREE.Group) return found;
    // Fallback: first Group child (legacy ships without named groups)
    for (const child of this.shipMesh.children) {
      if (child instanceof THREE.Group) return child;
    }
    return null;
  }

  /** Get the coordinate root for marker positioning.
   *  Returns the top-level ship mesh so that marker coordinates are stored in
   *  mesh-local space — the same space Ship.ts uses for thruster.group.position.
   *  No heading rotation transform needed when passing coords to Ship. */
  private getCoordRoot(): THREE.Object3D {
    return this.shipMesh!;
  }

  /** Find the GLTF model group — a Group child INSIDE the visualGroup (loaded async) */
  private findModelGroup(): THREE.Group | null {
    const vg = this.findVisualGroup();
    if (!vg) return null;
    for (const child of vg.children) {
      if (child instanceof THREE.Group) return child;
    }
    return null;
  }

  /** Check whether the GLTF model group has been added (async load may be pending).
   *  Looks inside the visualGroup for a nested Group (the GLTF model), not just
   *  for the visualGroup itself (which is always present). */
  private hasModelGroup(): boolean {
    return this.findModelGroup() !== null;
  }

  // ─── Private: utility helpers ───

  /** Select the first hardpoint if nothing is currently selected (safety net) */
  private autoSelectFirst() {
    if (!this.selectedId && this.hardpoints.length > 0) {
      this.selectHardpoint(this.hardpoints[0]!.id);
    }
  }

  /** Ensure nextId is above any loaded hardpoint ID to prevent collisions */
  private syncNextId() {
    for (const hp of this.hardpoints) {
      const match = hp.id.match(/^hp-(\d+)$/);
      if (match) {
        this.nextId = Math.max(this.nextId, parseInt(match[1]!) + 1);
      }
    }
  }

  /** Reposition all existing markers to match current ship world transform.
   *  Called after async model loading completes or heading changes. */
  private repositionAllMarkers() {
    if (!this.shipMesh) return;
    this.shipMesh.updateMatrixWorld(true);
    const root = this.getCoordRoot();
    for (const hp of this.hardpoints) {
      const marker = this.markers.get(hp.id);
      if (marker) {
        const worldPos = new THREE.Vector3(hp.localX, hp.localY, hp.localZ);
        root.localToWorld(worldPos);
        marker.position.copy(worldPos);
      }
    }
  }

  // ─── Private: hardpoints ───

  private addHardpoint(hp: Hardpoint) {
    this.hardpoints.push(hp);

    const geo = new THREE.SphereGeometry(MARKER_RADIUS, 12, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: MARKER_COLORS[hp.type],
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const marker = new THREE.Mesh(geo, mat);

    if (this.shipMesh) {
      this.shipMesh.updateMatrixWorld(true);
      const root = this.getCoordRoot();
      const worldPos = new THREE.Vector3(hp.localX, hp.localY, hp.localZ);
      root.localToWorld(worldPos);
      marker.position.copy(worldPos);
    } else {
      marker.position.set(hp.localX, hp.localY, hp.localZ);
    }

    this.markerGroup.add(marker);
    this.markers.set(hp.id, marker);
    this.addLabelEl(hp);

    // Auto-select newly added point if nothing is selected (safety net)
    if (!this.selectedId) {
      this.selectHardpoint(hp.id);
    }
  }

  private collectRaycastTargets() {
    this.raycastTargets = [];
    if (!this.shipMesh) return;
    this.shipMesh.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.material instanceof THREE.MeshStandardMaterial
      ) {
        this.raycastTargets.push(child);
      }
    });
  }

  // ─── Private: label overlay ───

  private createOverlay() {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    this.overlay = document.createElement("div");
    this.overlay.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:10;";

    this.svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgEl.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;";
    this.overlay.appendChild(this.svgEl);

    parent.style.position = "relative";
    parent.appendChild(this.overlay);
  }

  private removeOverlay() {
    this.labelEls.clear();
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      this.svgEl = null;
    }
  }

  private addLabelEl(hp: Hardpoint) {
    if (!this.svgEl || !this.overlay) return;

    const colorHex = "#" + MARKER_COLORS[hp.type].toString(16).padStart(6, "0");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("stroke", colorHex);
    line.setAttribute("stroke-width", "1");
    line.setAttribute("stroke-opacity", "0.5");
    this.svgEl.appendChild(line);

    const div = document.createElement("div");
    div.style.cssText = [
      "position:absolute",
      "font-family:'JetBrains Mono','Fira Code',monospace",
      "font-size:9px",
      `color:${colorHex}`,
      "text-transform:uppercase",
      "letter-spacing:0.5px",
      "white-space:nowrap",
      "padding:2px 6px",
      "background:rgba(0,0,0,0.6)",
      `border:1px solid ${colorHex}44`,
      "border-radius:2px",
      "pointer-events:none",
    ].join(";");
    this.overlay.appendChild(div);

    this.labelEls.set(hp.id, { div, line });
  }

  private removeLabelEl(id: string) {
    const el = this.labelEls.get(id);
    if (el) {
      el.div.remove();
      el.line.remove();
      this.labelEls.delete(id);
    }
  }

  private getLabelText(hp: Hardpoint): string {
    if (hp.label) return hp.label;
    const sameType = this.hardpoints.filter((h) => h.type === hp.type);
    const idx = sameType.indexOf(hp) + 1;
    return `${hp.type} ${idx}`;
  }

  private updateLabels() {
    if (!this.overlay || !this.svgEl) return;

    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Model center in screen space
    const centerScreen = this.orbitCenter.clone().project(this.camera);
    const centerX = (centerScreen.x * 0.5 + 0.5) * w;

    for (const hp of this.hardpoints) {
      const marker = this.markers.get(hp.id);
      const el = this.labelEls.get(hp.id);
      if (!marker || !el) continue;

      const screenPos = marker.position.clone().project(this.camera);

      // Behind camera → hide
      if (screenPos.z > 1) {
        el.div.style.display = "none";
        el.line.style.display = "none";
        continue;
      }

      el.div.style.display = "";
      el.line.style.display = "";

      const mx = (screenPos.x * 0.5 + 0.5) * w;
      const my = (1 - (screenPos.y * 0.5 + 0.5)) * h;

      // Place label to whichever side is closer to the edge (shorter route)
      const isRight = mx >= centerX;
      const labelX = isRight ? mx + LABEL_OFFSET_PX : mx - LABEL_OFFSET_PX;
      const labelY = my;

      // Update label text (index can shift after deletes)
      el.div.textContent = this.getLabelText(hp);

      const elW = el.div.offsetWidth || 60;
      el.div.style.left = `${isRight ? labelX : labelX - elW}px`;
      el.div.style.top = `${labelY - 8}px`;

      // Leader line: marker → label edge
      const lineEndX = isRight ? labelX : labelX;
      el.line.setAttribute("x1", String(mx));
      el.line.setAttribute("y1", String(my));
      el.line.setAttribute("x2", String(lineEndX));
      el.line.setAttribute("y2", String(labelY));
    }
  }

  // ─── Private: axis guide line ───

  private updateAxisGuideLine() {
    if (!this.lockedAxis || !this.selectedId || !this.shipMesh) {
      this.removeAxisGuideLine();
      return;
    }

    const hp = this.hardpoints.find((h) => h.id === this.selectedId);
    if (!hp) { this.removeAxisGuideLine(); return; }

    const axisColors: Record<string, number> = { x: 0xff4444, y: 0x44ff44, z: 0x4488ff };
    const color = axisColors[this.lockedAxis] ?? 0xffffff;
    const extent = 10;

    this.shipMesh.updateMatrixWorld(true);
    const root = this.getCoordRoot();
    const center = new THREE.Vector3(hp.localX, hp.localY, hp.localZ);
    const dir = new THREE.Vector3(
      this.lockedAxis === "x" ? 1 : 0,
      this.lockedAxis === "y" ? 1 : 0,
      this.lockedAxis === "z" ? 1 : 0,
    );
    const p1 = center.clone().addScaledVector(dir, -extent);
    const p2 = center.clone().addScaledVector(dir, extent);
    root.localToWorld(p1);
    root.localToWorld(p2);

    if (this.axisGuideLine) {
      // Update existing line positions + color
      const positions = this.axisGuideLine.geometry.attributes.position as THREE.BufferAttribute;
      positions.setXYZ(0, p1.x, p1.y, p1.z);
      positions.setXYZ(1, p2.x, p2.y, p2.z);
      positions.needsUpdate = true;
      (this.axisGuideLine.material as THREE.LineBasicMaterial).color.setHex(color);
    } else {
      // Create new line
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        depthTest: false,
      });
      this.axisGuideLine = new THREE.Line(geo, mat);
      this.axisGuideLine.renderOrder = 999;
      this.markerGroup.add(this.axisGuideLine);
    }
  }

  private removeAxisGuideLine() {
    if (this.axisGuideLine) {
      this.markerGroup.remove(this.axisGuideLine);
      this.axisGuideLine.geometry.dispose();
      (this.axisGuideLine.material as THREE.LineBasicMaterial).dispose();
      this.axisGuideLine = null;
    }
  }

  // ─── Private: axis-constrained drag ───

  private handleAxisDrag(clientX: number, clientY: number) {
    if (!this.lockedAxis || !this.selectedId || !this.shipMesh) return;

    const hp = this.hardpoints.find((h) => h.id === this.selectedId);
    if (!hp) return;

    this.shipMesh.updateMatrixWorld(true);
    const root = this.getCoordRoot();

    // Axis origin and direction in world space
    const localOrigin = new THREE.Vector3(hp.localX, hp.localY, hp.localZ);
    const axisUnit = new THREE.Vector3(
      this.lockedAxis === "x" ? 1 : 0,
      this.lockedAxis === "y" ? 1 : 0,
      this.lockedAxis === "z" ? 1 : 0,
    );
    const localEnd = localOrigin.clone().add(axisUnit);

    const worldOrigin = localOrigin.clone();
    root.localToWorld(worldOrigin);
    const worldEnd = localEnd.clone();
    root.localToWorld(worldEnd);
    const worldAxisDir = worldEnd.sub(worldOrigin).normalize();

    // Create plane containing the axis and facing the camera
    const viewDir = this.camera.position.clone().sub(worldOrigin).normalize();
    let planeNormal = new THREE.Vector3().crossVectors(worldAxisDir, viewDir);
    if (planeNormal.lengthSq() < 0.001) {
      planeNormal.crossVectors(worldAxisDir, this.camera.up);
    }
    planeNormal.normalize();

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, worldOrigin);

    // Raycast from mouse position
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersection = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, intersection)) return;

    // Project intersection onto the axis line (parametric t)
    const t = intersection.clone().sub(worldOrigin).dot(worldAxisDir);

    // Delta-based: apply only a fraction of the movement for precise control
    if (this.axisDragPrevT === null) {
      this.axisDragPrevT = t;
      return; // First frame — just record baseline, don't move
    }

    const rawDelta = t - this.axisDragPrevT;
    this.axisDragPrevT = t;

    const scaledDelta = rawDelta * HardpointEditor.AXIS_DRAG_SENSITIVITY;

    // Apply delta to the current hardpoint value
    let current: number;
    if (this.lockedAxis === "x") current = hp.localX;
    else if (this.lockedAxis === "y") current = hp.localY;
    else current = hp.localZ;

    const value = Math.round((current + scaledDelta) * 1000) / 1000;
    this.updateHardpointPosition(this.selectedId, this.lockedAxis, value);
    this.updateAxisGuideLine();
  }

  // ─── Private: event handlers ───

  private handleClick = (event: MouseEvent) => {
    if (this.isDragging) return;
    if (!this.shipMesh) return;

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check existing markers first
    const markerHits = this.raycaster.intersectObjects(Array.from(this.markers.values()));
    if (markerHits.length > 0) {
      for (const [id, marker] of this.markers) {
        if (marker === markerHits[0]!.object) {
          this.selectHardpoint(id);
          this.updateAxisGuideLine();
          return;
        }
      }
    }

    // Lazy re-collect in case GLTF loaded after activate
    if (this.raycastTargets.length === 0) this.collectRaycastTargets();

    this.shipMesh.updateMatrixWorld(true);
    const intersects = this.raycaster.intersectObjects(this.raycastTargets, false);

    if (intersects.length > 0) {
      const hit = intersects[0]!;
      const localPoint = hit.point.clone();
      this.getCoordRoot().worldToLocal(localPoint);

      const id = `hp-${this.nextId++}`;
      const hardpoint: Hardpoint = {
        id,
        type: this.placementType,
        localX: Math.round(localPoint.x * 1000) / 1000,
        localY: Math.round(localPoint.y * 1000) / 1000,
        localZ: Math.round(localPoint.z * 1000) / 1000,
      };

      this.addHardpoint(hardpoint);
    }
  };

  private handleRightClick = (event: MouseEvent) => {
    event.preventDefault();
    if (!this.shipMesh) return;

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const markerHits = this.raycaster.intersectObjects(Array.from(this.markers.values()));
    if (markerHits.length > 0) {
      for (const [id, marker] of this.markers) {
        if (marker === markerHits[0]!.object) {
          this.deleteHardpoint(id);
          return;
        }
      }
    }
  };

  private handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;

    this.isDragging = false;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;

    // Check if clicking near selected marker with a locked axis → start constrained drag.
    // Uses screen-space proximity instead of precise 3D raycasting — the marker
    // sphere (0.08 radius) is too small to reliably click in world space.
    if (this.lockedAxis && this.selectedId) {
      const marker = this.markers.get(this.selectedId);
      if (marker) {
        const rect = this.canvas.getBoundingClientRect();
        const screenPos = marker.position.clone().project(this.camera);
        // Behind camera → skip
        if (screenPos.z <= 1) {
          const markerScreenX = (screenPos.x * 0.5 + 0.5) * rect.width;
          const markerScreenY = (1 - (screenPos.y * 0.5 + 0.5)) * rect.height;
          const mouseX = event.clientX - rect.left;
          const mouseY = event.clientY - rect.top;
          const dist = Math.hypot(mouseX - markerScreenX, mouseY - markerScreenY);

          if (dist < HardpointEditor.AXIS_GRAB_RADIUS_PX) {
            this.axisDragActive = true;
            this.axisDragPrevT = null; // reset baseline for delta calculation
            return; // Don't start orbit
          }
        }
      }
    }
  };

  private handleMouseMove = (event: MouseEvent) => {
    // Axis-constrained drag takes priority
    if (this.axisDragActive) {
      this.handleAxisDrag(event.clientX, event.clientY);
      this.isDragging = true; // suppress subsequent click
      return;
    }

    // Orbit camera drag
    if (event.buttons & 1) {
      const dx = event.clientX - this.lastMouseX;
      const dy = event.clientY - this.lastMouseY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.isDragging = true;

      this.azimuth += dx * 0.008;
      this.elevation = Math.max(
        -Math.PI / 2 + 0.05,
        Math.min(Math.PI / 2 - 0.05, this.elevation - dy * 0.008),
      );

      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }
  };

  private handleMouseUp = () => {
    if (this.axisDragActive) {
      this.axisDragActive = false;
      this.axisDragPrevT = null;
    }
    setTimeout(() => {
      this.isDragging = false;
    }, 10);
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.orbitDistance = Math.max(2, Math.min(20, this.orbitDistance + event.deltaY * 0.005));
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    // Don't capture keys when typing in input fields
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (event.code === "Space") {
      event.preventDefault();
      this.cycleLockedAxis();
    }
  };
}
