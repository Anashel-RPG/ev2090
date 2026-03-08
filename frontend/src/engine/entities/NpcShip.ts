import * as THREE from "three";
import { ModelCache } from "../systems/ModelCache";
import type { Vec2 } from "@/types/game";
import { SHIELD_VERTEX, SHIELD_FRAGMENT } from "../shaders/shield.glsl";

/**
 * NPC ship with a full docking state machine:
 *   APPROACHING → DOCKING → DOCKED → DEPARTING → DONE
 *
 * Features:
 * - Curved approach path (perpendicular drift for natural flight lines)
 * - Smooth deceleration to zero at docking (no sudden stop, no pixel jump)
 * - Directional scan outline when player's radar cone detects the ship
 * - Safe dispose (doesn't destroy shared geometry/textures from ModelCache)
 */

type NpcState = "APPROACHING" | "DOCKING" | "DOCKED" | "DEPARTING" | "DONE";

const MODEL_SCALE = 0.35;
const BASE_TILT_X = (-22 * Math.PI) / 180;

// APPROACHING
const APPROACH_SPEED = 25;
const APPROACH_DECEL_RANGE = 60;
const APPROACH_MIN_SPEED = 4;
const CURVE_STRENGTH = 8;

// DOCKING
const DOCKING_TRIGGER_MULT = 1.5;
const DOCK_OFFSET_MULT = 0.92;

// DOCKED
const DOCK_TIME_MIN = 3;
const DOCK_TIME_MAX = 10;

// DEPARTING
const DEPART_ROTATE_TIME = 2;
const DEPART_MAX_SPEED = 30;
const DEPART_ACCEL = 14;

// DONE
const DONE_DISTANCE = 200;

/** Shortest-arc signed difference between two angles (radians). */
function angleDelta(from: number, to: number): number {
  return (
    (((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI
  );
}

/** Lerp a toward b by t, respecting wrapping. */
function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * Math.min(t, 1);
}

export class NpcShip {
  mesh: THREE.Group;
  id: string;
  position: Vec2;
  name: string;
  done = false;

  /** When true, the NPC pauses its state machine (used during comm mode) */
  frozen = false;

  /** Get the NPC's current heading (radians) */
  getDirection(): number { return this.direction; }
  /** Set the NPC's heading (radians) — used during comm mode choreography */
  setDirection(radians: number) { this.direction = radians; }

  /** Set by Engine when player's scanner cone detects this NPC */
  scanned = false;
  /** Direction from NPC toward player — set by Engine for directional outline */
  scanDirection: Vec2 | null = null;
  /** World-space hit point where the scan beam intersects the shield — set by Engine */
  scanHitPoint: Vec2 | null = null;

  // ─── Static config (shared across all NPCs, tuned via config panel) ───
  /** Shield scale: how much larger than the ship */
  static shieldScale = 0.315;
  /** Fresnel power: higher = thinner edge glow (2 = wide glow, 6 = hair-thin) */
  static fresnelPow = 0.1;
  /** Dissipation rate: how fast energy fades from hit point (higher = tighter) */
  static dissipation = 2.3;
  /** Oval stretch X: horizontal shape of dissipation (1.0 = circle) */
  static ovalX = 3.6;
  /** Oval stretch Y: vertical shape of dissipation (1.0 = circle) */
  static ovalY = 1.4;
  /** Base opacity: subtle shield glow always visible (0–0.5) */
  static baseOpacity = 0.04;
  /** Hit opacity: max brightness at hit location (0–1) */
  static hitOpacity = 1.0;
  /** Hit radius: ray-circle intersection radius for beam contact (world units) */
  static hitRadius = 1.5;
  /** Shield color RGB (0–1 each) — default: Purple */
  static colorR = 0.7;
  static colorG = 0.3;
  static colorB = 1.0;

  /**
   * Global tilt override for all NPCs — defaults to the base -22° gameplay tilt.
   * Engine lerps this to 0 during FPV transition so ships appear level.
   */
  static tiltOverride = BASE_TILT_X;

  /**
   * All planets — set once by Engine after planets are created.
   * Used for avoidance steering so NPCs don't fly through non-target planets.
   */
  static allPlanets: { position: Vec2; radius: number }[] = [];

  private npcState: NpcState = "APPROACHING";
  private direction: number;

  // Targets & geometry
  private targetPlanet: { position: Vec2; radius: number };
  private spawnPos: Vec2;

  // Curved approach
  private curveSign: number;
  private initialDist: number;

  // DOCKED timer
  private dockTimer = 0;
  private dockDuration = 0;

  // DEPARTING
  private departureAngle = 0;
  private departSpeed = 0;
  private departRotateElapsed = 0;

  // Fresnel shield — energy shell that glows at edges when scanned
  private shieldMaterial: THREE.ShaderMaterial;
  private shieldGroup: THREE.Object3D | null = null;
  private scanGlowOpacity = 0;
  private lastScanDirection: Vec2 = { x: 0, y: 1 }; // persist last scan dir for fade-out

  constructor(
    id: string,
    name: string,
    targetPlanet: { position: Vec2; radius: number },
    spawnPos: Vec2,
    modelPath: string,
    texturePath: string,
  ) {
    this.id = id;
    this.name = name;
    this.position = { ...spawnPos };
    this.spawnPos = { ...spawnPos };
    this.targetPlanet = targetPlanet;

    // Initial heading: spawn → planet center
    const dx = targetPlanet.position.x - spawnPos.x;
    const dy = targetPlanet.position.y - spawnPos.y;
    this.direction = Math.atan2(-dx, dy);
    this.initialDist = Math.sqrt(dx * dx + dy * dy);

    // Randomly curve left or right
    this.curveSign = Math.random() < 0.5 ? -1 : 1;

    this.mesh = new THREE.Group();
    this.mesh.position.set(spawnPos.x, spawnPos.y, 10);
    this.mesh.rotation.set(NpcShip.tiltOverride, 0, this.direction);

    // Fresnel shield material — transparent energy shell with hit-point dissipation
    this.shieldMaterial = new THREE.ShaderMaterial({
      vertexShader: SHIELD_VERTEX,
      fragmentShader: SHIELD_FRAGMENT,
      uniforms: {
        u_scale: { value: NpcShip.shieldScale },
        u_fresnelPow: { value: NpcShip.fresnelPow },
        u_opacity: { value: 0.0 },
        u_color: { value: new THREE.Vector3(NpcShip.colorR, NpcShip.colorG, NpcShip.colorB) },
        // Hit-point dissipation
        u_hitPoint: { value: new THREE.Vector2(spawnPos.x, spawnPos.y) },
        u_dissipation: { value: NpcShip.dissipation },
        u_ovalX: { value: NpcShip.ovalX },
        u_ovalY: { value: NpcShip.ovalY },
        u_baseOpacity: { value: NpcShip.baseOpacity },
        u_hitOpacity: { value: NpcShip.hitOpacity },
      },
      side: THREE.FrontSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // Load GLTF model from cache (instant clone if pre-loaded)
    ModelCache.getCloneAsync(modelPath, (model) => {
      // Orient: Blender Y(up)→+Z, Z(fwd)→+Y — right-side up for top-down camera
      model.rotation.set(Math.PI / 2, Math.PI, 0);
      model.scale.setScalar(MODEL_SCALE);

      ModelCache.applyTexture(model, texturePath, {
        metalness: 0.4,
        roughness: 0.3,
      });

      this.mesh.add(model);

      // Create shield clone for scan effect
      this.createShield(model);
    });
  }

  /** Clone the model as a Fresnel energy shield shell. */
  private createShield(sourceModel: THREE.Object3D) {
    const shieldModel = sourceModel.clone();
    shieldModel.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = this.shieldMaterial;
      }
    });
    this.shieldGroup = shieldModel;
    this.mesh.add(shieldModel);
  }

  // ──────────────────────── update ────────────────────────

  update(dt: number) {
    if (this.done) return;

    // Frozen NPCs skip the state machine (comm view pause)
    // but still sync tilt and animate scan outline for visual continuity.
    if (this.frozen) {
      // Keep tilt in sync with FPV transition (tiltOverride lerps to 0 during FPV)
      this.mesh.rotation.set(NpcShip.tiltOverride, 0, this.direction);
      this.updateScanOutline(dt);
      return;
    }

    switch (this.npcState) {
      case "APPROACHING":
        this.updateApproaching(dt);
        break;
      case "DOCKING":
        this.updateDocking(dt);
        break;
      case "DOCKED":
        this.updateDocked(dt);
        break;
      case "DEPARTING":
        this.updateDeparting(dt);
        break;
      case "DONE":
        this.done = true;
        return;
    }

    // Sync mesh
    this.mesh.position.set(this.position.x, this.position.y, 10);
    this.mesh.rotation.set(NpcShip.tiltOverride, 0, this.direction);

    // Animate scan outline
    this.updateScanOutline(dt);
  }

  // ──────────────────── state handlers ────────────────────

  private updateApproaching(dt: number) {
    const planet = this.targetPlanet;
    const dx = planet.position.x - this.position.x;
    const dy = planet.position.y - this.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= planet.radius * DOCKING_TRIGGER_MULT) {
      this.npcState = "DOCKING";
      return;
    }

    const t = Math.max(0, Math.min(1, dist / APPROACH_DECEL_RANGE));
    const speed = Math.max(APPROACH_MIN_SPEED, APPROACH_SPEED * t);

    const nx = dx / dist;
    const ny = dy / dist;

    const progress = Math.min(1, dist / this.initialDist);
    const curveFactor = progress * progress * CURVE_STRENGTH;

    const px = -ny * this.curveSign;
    const py = nx * this.curveSign;

    this.position.x += (nx * speed + px * curveFactor) * dt;
    this.position.y += (ny * speed + py * curveFactor) * dt;

    // Avoid non-target planets — steer away when too close
    this.avoidPlanets(dt);

    const targetDir = Math.atan2(-dx, dy);
    this.direction = lerpAngle(this.direction, targetDir, dt * 3);
  }

  private updateDocking(dt: number) {
    const planet = this.targetPlanet;
    const dx = planet.position.x - this.position.x;
    const dy = planet.position.y - this.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const stopDist = planet.radius * DOCK_OFFSET_MULT;
    const remainingDist = dist - stopDist;

    // Sub-pixel snap threshold — eliminates the visible jump
    if (remainingDist <= 0.01) {
      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);
      this.position.x = planet.position.x - nx * stopDist;
      this.position.y = planet.position.y - ny * stopDist;

      this.dockDuration =
        DOCK_TIME_MIN + Math.random() * (DOCK_TIME_MAX - DOCK_TIME_MIN);
      this.dockTimer = 0;
      this.npcState = "DOCKED";
      return;
    }

    // Smooth deceleration: speed proportional to remaining distance
    const dockRange = planet.radius * DOCKING_TRIGGER_MULT - stopDist;
    const tDock = Math.max(0, Math.min(1, remainingDist / dockRange));
    // Smoothstep easing with very low minimum speed (no pixel jump at snap)
    const easeSpeed =
      APPROACH_MIN_SPEED * (tDock * tDock * (3 - 2 * tDock)) + 0.05;

    const nx = dx / dist;
    const ny = dy / dist;
    this.position.x += nx * easeSpeed * dt;
    this.position.y += ny * easeSpeed * dt;

    this.direction = lerpAngle(this.direction, Math.atan2(-dx, dy), dt * 4);
  }

  private updateDocked(dt: number) {
    this.dockTimer += dt;

    if (this.dockTimer >= this.dockDuration) {
      this.departureAngle = Math.random() * Math.PI * 2 - Math.PI;
      this.departSpeed = 0;
      this.departRotateElapsed = 0;
      this.npcState = "DEPARTING";
    }
  }

  private updateDeparting(dt: number) {
    this.departRotateElapsed += dt;

    const rotateT = Math.min(
      this.departRotateElapsed / DEPART_ROTATE_TIME,
      1,
    );
    this.direction = lerpAngle(
      this.direction,
      this.departureAngle,
      rotateT * dt * 3,
    );

    this.departSpeed = Math.min(
      this.departSpeed + DEPART_ACCEL * dt,
      DEPART_MAX_SPEED,
    );

    const moveX = -Math.sin(this.direction);
    const moveY = Math.cos(this.direction);
    this.position.x += moveX * this.departSpeed * dt;
    this.position.y += moveY * this.departSpeed * dt;

    // Avoid non-target planets — steer away when too close
    this.avoidPlanets(dt);

    const sx = this.position.x - this.spawnPos.x;
    const sy = this.position.y - this.spawnPos.y;
    if (Math.sqrt(sx * sx + sy * sy) > DONE_DISTANCE) {
      this.npcState = "DONE";
      this.done = true;
    }
  }

  /** Steer away from non-target planets to avoid visual clipping in FPV. */
  private avoidPlanets(dt: number) {
    for (const p of NpcShip.allPlanets) {
      if (p === this.targetPlanet) continue;
      const pdx = this.position.x - p.position.x;
      const pdy = this.position.y - p.position.y;
      const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
      const avoidRadius = p.radius * 2.5;
      if (pDist < avoidRadius && pDist > 0) {
        const avoidStrength = ((avoidRadius - pDist) / avoidRadius) * 15;
        this.position.x += (pdx / pDist) * avoidStrength * dt;
        this.position.y += (pdy / pDist) * avoidStrength * dt;
      }
    }
  }

  // ──────────────── Shield scan animation ────────────────

  /** Approximate "radius" of the ship model for hit-point offset */
  private static readonly SHIP_RADIUS = 1.5;

  private lastHitPoint: Vec2 = { x: 0, y: 0 }; // persist last hit for fade-out

  private updateScanOutline(dt: number) {
    // Persist last scan direction so shield fades out naturally
    if (this.scanDirection) {
      this.lastScanDirection = { ...this.scanDirection };
    }
    // Persist last hit point from Engine's ray-circle intersection
    if (this.scanHitPoint) {
      this.lastHitPoint = { ...this.scanHitPoint };
    }

    // Only glow when the beam ray physically intersects this ship.
    // scanHitPoint is set by the Engine's ray-circle intersection (previous frame).
    // Using the cone flag (scanned) would light the shield for any NPC in the 60°
    // cone even when the thin beam passes beside it.
    if (this.scanHitPoint !== null) {
      this.scanGlowOpacity = Math.min(1.0, this.scanGlowOpacity + dt * 6.0);
    } else {
      // Fast fade-out (~300ms)
      this.scanGlowOpacity = Math.max(0, this.scanGlowOpacity - dt * 3.3);
    }

    // Use Engine-computed hit point (ray-circle intersection) if available,
    // otherwise fall back to simple offset from scan direction
    let hitX: number;
    let hitY: number;
    if (this.lastHitPoint.x !== 0 || this.lastHitPoint.y !== 0) {
      hitX = this.lastHitPoint.x;
      hitY = this.lastHitPoint.y;
    } else {
      const sd = this.lastScanDirection;
      hitX = this.position.x + sd.x * NpcShip.SHIP_RADIUS;
      hitY = this.position.y + sd.y * NpcShip.SHIP_RADIUS;
    }

    // Sync shield uniforms from static config every frame
    const u = this.shieldMaterial.uniforms;
    (u["u_opacity"] as { value: number }).value = this.scanGlowOpacity;
    (u["u_scale"] as { value: number }).value = NpcShip.shieldScale;
    (u["u_fresnelPow"] as { value: number }).value = NpcShip.fresnelPow;
    (u["u_color"] as { value: THREE.Vector3 }).value.set(
      NpcShip.colorR, NpcShip.colorG, NpcShip.colorB,
    );

    // Hit-point dissipation uniforms
    (u["u_hitPoint"] as { value: THREE.Vector2 }).value.set(hitX, hitY);
    (u["u_dissipation"] as { value: number }).value = NpcShip.dissipation;
    (u["u_ovalX"] as { value: number }).value = NpcShip.ovalX;
    (u["u_ovalY"] as { value: number }).value = NpcShip.ovalY;
    (u["u_baseOpacity"] as { value: number }).value = NpcShip.baseOpacity;
    (u["u_hitOpacity"] as { value: number }).value = NpcShip.hitOpacity;

    // Show/hide shield for performance
    const visible = this.scanGlowOpacity > 0.001;
    if (this.shieldGroup) this.shieldGroup.visible = visible;
  }

  // ──────────────────────── cleanup ───────────────────────

  dispose() {
    // Only dispose cloned materials — NOT shared geometry or cached textures
    this.shieldMaterial.dispose();
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (child.material === this.shieldMaterial) return;
        if (Array.isArray(child.material)) {
          child.material.forEach((m: THREE.Material) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
