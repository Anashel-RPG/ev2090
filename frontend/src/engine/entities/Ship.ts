import * as THREE from "three";
import { ModelCache } from "../systems/ModelCache";
import { SHIP_CDN_BASE } from "../ShipCatalog";
import type { ShipState, Vec2 } from "@/types/game";

/**
 * Player ship entity.
 *
 * Loads a Quaternius GLTF spaceship model with UV-mapped texture.
 * The model is oriented for a top-down 2D game (XY plane, Z-rotation).
 */

const SHIP_THRUST = 30;
const SHIP_ROTATION_SPEED = 3.5;
const SHIP_MAX_SPEED = 80;
const SHIP_DRAG = 0.005;
const SHIP_BRAKE_FACTOR = 0.03;

/** Scale factor for GLTF model (original is ~5 units wide) */
const MODEL_SCALE = 0.4;

export interface ShipModelConfig {
  modelPath: string;
  texturePath?: string; // optional override texture (e.g. Blue variant)
  modelScale?: number;  // per-ship model scale (default: MODEL_SCALE = 0.4)
  modelHeadingDeg?: number; // heading correction in degrees (default: 0)
  /** Thruster position in visual-group local space (default: 0, -1.6, 0) */
  thrusterPos?: { x: number; y: number; z: number };
  /** Multiple thruster positions — overrides thrusterPos when provided */
  thrusterPositions?: { x: number; y: number; z: number; thrustAngleDeg?: number }[];
  /** Per-ship material overrides (community ships with custom tuning) */
  materialConfig?: {
    metalness?: number;
    roughness?: number;
    emissiveIntensity?: number;
    emissiveR?: number;
    emissiveG?: number;
    emissiveB?: number;
  };
}

const DEFAULT_CONFIG: ShipModelConfig = {
  modelPath: `${SHIP_CDN_BASE}/striker/Striker.gltf`,
  texturePath: `${SHIP_CDN_BASE}/striker/Striker_Blue.png`,
};

/** Shared PlaneGeometry for all flame meshes (avoid per-instance GC) */
const FLAME_GEO = new THREE.PlaneGeometry(1, 1);

interface ThrusterSet {
  group: THREE.Group;
  core: THREE.Mesh;
  outer: THREE.Mesh;
  light: THREE.PointLight;
  basePos: { x: number; y: number; z: number };
  originalPos: { x: number; y: number; z: number };
  angleDeg: number;
}

export class Ship {
  mesh: THREE.Group;
  state: ShipState;

  /** All thruster flame sets (supports 1 or more engines) */
  private thrusters: ThrusterSet[] = [];

  /** Visual wrapper group: holds the GLTF model. Rotated by modelHeading so
   *  the model faces the direction of travel without affecting gameplay rotation. */
  private visualGroup: THREE.Group;
  /** Bank group: sits between mesh and visualGroup for clean bank rotation.
   *  Isolated from the tilt/heading Euler on mesh — no compound rotation artifacts. */
  private bankGroup: THREE.Group;
  /** Reference to the loaded GLTF model group (for live rotation tuning) */
  private modelGroup: THREE.Group | null = null;
  /** True once the GLTF model (or fallback) is in the scene */
  modelLoaded = false;
  /** Extra tilt angle (radians) for perspective effect — applied on X axis */
  private tiltX = (-22 * Math.PI) / 180;
  /** Roll angle (radians) — applied on bankGroup for clean banking */
  private rollY = 0;
  /** Bank axis weights — which local axes the bank angle maps to.
   *  X and Y use |rollY| (non-directional — always same visual pitch/dip).
   *  Z uses signed rollY (directional — lean into turns).
   *  Tunable via FPV config panel. */
  bankAxisX = -0.76;
  bankAxisY = 2;
  bankAxisZ = -2;
  /** Hero shot scale multiplier (1 = normal gameplay size) */
  private heroScale = 1;
  /** Per-ship model scale (replaces hardcoded MODEL_SCALE) */
  private modelScale = MODEL_SCALE;
  /** Per-ship heading correction (radians) — rotates visual group on Z axis */
  private modelHeadingRad = 0;
  /** Physics thrust direction offset (radians) — derived from average thrustAngleDeg.
   *  When thrustAngleDeg≠0, the ship's "forward" is rotated so it moves
   *  opposite the thruster flame direction, not hardcoded +Y. */
  private thrustForwardAngle = 0;
  /** Base thruster position (set once at construction, used by setThrusterOffsetY) */
  private thrusterOriginalPos = { x: 0, y: -1.6, z: 0 };
  /** Current thruster position in mesh local space */
  private thrusterBasePos = { x: 0, y: -1.6, z: 0 };

  /** Create a radial-gradient sprite texture from canvas */
  private static createFlameTexture(
    innerColor: string,
    outerColor: string,
    size = 64,
  ): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, innerColor);
    gradient.addColorStop(0.4, outerColor);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  constructor(config: ShipModelConfig = DEFAULT_CONFIG) {
    this.state = {
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      rotation: 0,
      heading: 0,
      thrust: 0,
      shields: 1,
      armor: 1,
      fuel: 0.85,
    };

    // Apply per-ship overrides from config
    if (config.modelScale != null) this.modelScale = config.modelScale;
    if (config.modelHeadingDeg != null) this.modelHeadingRad = (config.modelHeadingDeg * Math.PI) / 180;

    // Determine thruster positions: explicit array > single pos > default
    let positions: { x: number; y: number; z: number; thrustAngleDeg?: number }[];
    if (config.thrusterPositions && config.thrusterPositions.length > 0) {
      positions = config.thrusterPositions;
    } else if (config.thrusterPos) {
      positions = [config.thrusterPos];
    } else {
      positions = [{ x: 0, y: -1.6, z: 0 }];
    }

    // Keep legacy single-thruster fields in sync with first position
    this.thrusterOriginalPos = { ...positions[0]! };
    this.thrusterBasePos = { ...positions[0]! };

    // Compute physics thrust direction from average thrustAngleDeg.
    // thrustAngleDeg rotates the flame from -Y: angleDeg=0 → flame -Y → forward +Y,
    // angleDeg=-90 → flame -X → forward +X. The offset = average angleDeg in radians.
    const angleSum = positions.reduce((sum, p) => sum + (p.thrustAngleDeg ?? 0), 0);
    this.thrustForwardAngle = (angleSum / positions.length) * (Math.PI / 180);

    this.mesh = new THREE.Group();

    // Bank group: isolated rotation for FPV banking (between mesh and visualGroup).
    // Keeps bank rotation separate from tilt/heading Euler to avoid compound artifacts.
    this.bankGroup = new THREE.Group();
    this.bankGroup.name = "bank-group";
    this.mesh.add(this.bankGroup);

    // Visual group: holds GLTF model, rotated by heading correction
    // so the model faces the direction of travel (mesh.rotation.z is gameplay rotation)
    this.visualGroup = new THREE.Group();
    this.visualGroup.name = "visual-group";
    this.visualGroup.rotation.z = this.modelHeadingRad;
    this.bankGroup.add(this.visualGroup);

    // Shared flame textures (created once, reused for all thruster sets)
    const coreTex = Ship.createFlameTexture(
      "rgba(255,255,220,1)",
      "rgba(255,160,40,0.8)",
    );
    const outerTex = Ship.createFlameTexture(
      "rgba(255,100,20,0.6)",
      "rgba(255,40,0,0.15)",
    );

    // Create flame sets for each thruster position.
    // Each thruster is a Group positioned at the thruster point, with the flame
    // meshes as children at local offsets. The group rotates by thrustAngleDeg
    // so flames can point in any direction (default -Y = behind).
    // Thrusters live in mesh (not visualGroup) so heading rotation doesn't
    // displace them — they always trail behind the direction of travel.
    for (const tp of positions) {
      const angleDeg = tp.thrustAngleDeg ?? 0;
      const group = new THREE.Group();
      group.position.set(tp.x, tp.y, tp.z);
      group.rotation.z = (angleDeg * Math.PI) / 180;

      const core = new THREE.Mesh(
        FLAME_GEO,
        new THREE.MeshBasicMaterial({
          map: coreTex,
          blending: THREE.AdditiveBlending,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      core.scale.set(0.8, 1.6, 1);
      // Core at group origin (0,0,0)
      group.add(core);

      const outer = new THREE.Mesh(
        FLAME_GEO,
        new THREE.MeshBasicMaterial({
          map: outerTex,
          blending: THREE.AdditiveBlending,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      outer.scale.set(1.4, 2.4, 1);
      outer.position.set(0, -0.4, 0);
      group.add(outer);

      const light = new THREE.PointLight(0xff4400, 0, 10);
      light.position.set(0, -0.4, 0.5);
      group.add(light);

      this.mesh.add(group);

      this.thrusters.push({
        group, core, outer, light,
        basePos: { ...tp },
        originalPos: { ...tp },
        angleDeg,
      });
    }

    // Load the GLTF model
    this.loadModel(config);
  }

  private loadModel(config: ShipModelConfig) {
    // Finalize: orient, texture, and add model to scene
    const finalizeModel = (model: THREE.Group) => {
      // Orient for top-down XY plane game:
      // GLTF from Blender: Z-forward (+Z=nose), Y-up (+Y=top)
      // Rx(+π/2) * Ry(π): +Y(top) → world +Z (faces camera ✓), +Z(nose) → world +Y (matches thrust ✓)
      model.rotation.set(Math.PI / 2, Math.PI, 0);
      this.modelGroup = model;
      model.scale.setScalar(this.modelScale);

      if (config.texturePath) {
        // Built-in ship: apply texture synchronously (already preloaded in cache)
        const tex = ModelCache.getTexture(config.texturePath);
        if (tex) {
          model.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material) {
              const mat = child.material as THREE.MeshStandardMaterial;
              mat.map = tex;
              mat.metalness = 0.4;
              mat.roughness = 0.2;
              mat.emissive = new THREE.Color(0x222233);
              mat.emissiveIntensity = 0.15;
              mat.needsUpdate = true;
            }
          });
        } else {
          // Fallback: texture not cached yet — load async (shouldn't happen after preload)
          ModelCache.applyTexture(model, config.texturePath, {
            metalness: 0.4,
            roughness: 0.2,
            emissive: new THREE.Color(0x222233),
            emissiveIntensity: 0.15,
          });
        }
      } else {
        // Community / embedded-PBR ships: match catalog look.
        // MeshyAI GLBs ship heavy normalMaps that make the hull look
        // bumpy; stripping them + lowering metalness gives a cleaner result.
        const mc = config.materialConfig;
        const metalness = mc?.metalness ?? 0.35;
        const roughness = mc?.roughness ?? 0.2;
        const emissiveIntensity = mc?.emissiveIntensity ?? 0.15;
        const emissiveColor = new THREE.Color(
          (mc?.emissiveR ?? 34) / 255,
          (mc?.emissiveG ?? 34) / 255,
          (mc?.emissiveB ?? 51) / 255,
        );
        model.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.metalness = metalness;
            mat.roughness = roughness;
            // Reduce MeshyAI normal/bump maps — full intensity adds noise, 0.35 keeps surface detail
            if (mat.normalMap) mat.normalScale.set(0.35, 0.35);
            if (mat.bumpMap) mat.bumpScale = 0.02;
            mat.emissive = emissiveColor;
            mat.emissiveIntensity = emissiveIntensity;
            mat.needsUpdate = true;
          }
        });
      }

      this.visualGroup.add(model);
      this.modelLoaded = true;
    };

    const loadClone = () => {
      ModelCache.getCloneAsync(
        config.modelPath,
        (model) => finalizeModel(model),
        (error) => {
          console.error("Failed to load ship model:", error);
          this.createFallbackGeometry();
        },
      );
    };

    // For built-in ships: preload texture into cache first, then load model.
    // This ensures the texture is available synchronously when we finalize,
    // avoiding a visible "red → blue" texture swap.
    if (config.texturePath) {
      ModelCache.loadTexture(config.texturePath).then(loadClone).catch(loadClone);
    } else {
      loadClone();
    }
  }

  /** Simple triangle placeholder if GLTF fails to load */
  private createFallbackGeometry() {
    const geo = new THREE.ConeGeometry(1, 2.5, 3);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x667788,
      metalness: 0.7,
      roughness: 0.3,
    });
    const fallback = new THREE.Mesh(geo, mat);
    this.visualGroup.add(fallback);
    this.modelLoaded = true;
  }

  update(
    dt: number,
    input: {
      thrustForward: boolean;
      thrustReverse: boolean;
      rotateLeft: boolean;
      rotateRight: boolean;
    },
  ) {
    // Rotation
    if (input.rotateLeft) {
      this.state.rotation += SHIP_ROTATION_SPEED * dt;
    }
    if (input.rotateRight) {
      this.state.rotation -= SHIP_ROTATION_SPEED * dt;
    }

    // Thrust direction = mesh rotation + thrustForwardAngle.
    // thrustForwardAngle is derived from thruster config (thrustAngleDeg).
    // Ships with thrustAngleDeg=0 (default) have offset=0 → moves +Y as before.
    // Ships with thrustAngleDeg=-90 have offset=-π/2 → moves +X (opposite flame).
    if (input.thrustForward && this.state.fuel > 0) {
      const physicsAngle = this.state.rotation + this.thrustForwardAngle;
      const ax = Math.sin(physicsAngle) * -SHIP_THRUST * dt;
      const ay = Math.cos(physicsAngle) * SHIP_THRUST * dt;
      this.state.velocity.x += ax;
      this.state.velocity.y += ay;
      this.state.thrust = 1;
      this.state.fuel = Math.max(0, this.state.fuel - 0.0001);
    } else {
      this.state.thrust = 0;
    }

    // Brake
    if (input.thrustReverse) {
      this.state.velocity.x *= 1 - SHIP_BRAKE_FACTOR;
      this.state.velocity.y *= 1 - SHIP_BRAKE_FACTOR;
    }

    // Speed cap
    const speed = Math.sqrt(
      this.state.velocity.x ** 2 + this.state.velocity.y ** 2,
    );
    if (speed > SHIP_MAX_SPEED) {
      const scale = SHIP_MAX_SPEED / speed;
      this.state.velocity.x *= scale;
      this.state.velocity.y *= scale;
    }

    // Light drag (space-like but prevents infinite drift)
    this.state.velocity.x *= 1 - SHIP_DRAG;
    this.state.velocity.y *= 1 - SHIP_DRAG;

    // Position update
    this.state.position.x += this.state.velocity.x * dt;
    this.state.position.y += this.state.velocity.y * dt;

    // Sync mesh + thruster visuals
    this.syncMesh();
  }

  /** Sync mesh transform and thruster visuals from current state (no physics). */
  syncMesh() {
    // Keep heading = physics forward direction in sync (covers comm mode, hero mode, etc.)
    this.state.heading = this.state.rotation + this.thrustForwardAngle;

    this.mesh.position.set(this.state.position.x, this.state.position.y, 10);
    this.mesh.rotation.set(this.tiltX, 0, this.state.rotation);
    // Bank: X and Y use |rollY| (non-directional — always same visual pitch).
    // Only Z uses signed rollY (directional — tilt into turns).
    // Making Y non-directional prevents the Euler Y×Z cross-coupling from
    // flipping the apparent nose pitch when turning left vs right.
    const absRoll = Math.abs(this.rollY);
    this.bankGroup.rotation.set(
      absRoll * this.bankAxisX,
      absRoll * this.bankAxisY,
      this.rollY * this.bankAxisZ,
    );
    this.mesh.scale.setScalar(this.heroScale);

    const thrustIntensity = this.state.thrust;
    const flicker = 0.85 + Math.random() * 0.15;

    for (const t of this.thrusters) {
      (t.core.material as THREE.MeshBasicMaterial).opacity =
        thrustIntensity * 0.9 * flicker;
      t.core.scale.set(
        0.6 + thrustIntensity * 0.3 * flicker,
        1.2 + thrustIntensity * 0.8 * flicker,
        1,
      );

      (t.outer.material as THREE.MeshBasicMaterial).opacity =
        thrustIntensity * 0.5 * flicker;
      t.outer.scale.set(
        1.0 + thrustIntensity * 0.5 * flicker,
        1.8 + thrustIntensity * 1.2 * flicker,
        1,
      );

      t.light.intensity = thrustIntensity * 2;
    }
  }

  /** Set tilt angle (radians) on the X axis for perspective effect */
  setTilt(radians: number) {
    this.tiltX = radians;
  }

  getTilt(): number {
    return this.tiltX;
  }

  /** Set roll angle (radians) on the Y axis — banking for hero shots */
  setRoll(radians: number) {
    this.rollY = radians;
  }

  getRoll(): number {
    return this.rollY;
  }

  /** Set hero scale multiplier (1 = normal gameplay size) */
  setHeroScale(s: number) {
    this.heroScale = s;
  }

  getHeroScale(): number {
    return this.heroScale;
  }

  /** Set per-ship model scale (debug tuning) */
  setModelScale(scale: number) {
    this.modelScale = scale;
    if (this.modelGroup) {
      this.modelGroup.scale.setScalar(scale);
    }
  }

  getModelScale(): number {
    return this.modelScale;
  }

  /** Shift all thruster elements on Y axis from their original positions (debug tuning) */
  setThrusterOffsetY(offset: number) {
    const orig = this.thrusterOriginalPos;
    this.setThrusterPosition(orig.x, orig.y + offset, orig.z);
  }

  /** Set thruster position in mesh local space (full XYZ control).
   *  With index: targets a specific thruster. Without: targets the first. */
  setThrusterPosition(x: number, y: number, z: number, index = 0) {
    const t = this.thrusters[index];
    if (!t) return;
    t.basePos = { x, y, z };
    t.group.position.set(x, y, z);
    // Keep legacy fields in sync for first thruster
    if (index === 0) {
      this.thrusterBasePos = { x, y, z };
    }
  }

  /** Set thruster flame direction angle (degrees, 0 = -Y). */
  setThrusterAngle(angleDeg: number, index = 0) {
    const t = this.thrusters[index];
    if (!t) return;
    t.angleDeg = angleDeg;
    t.group.rotation.z = (angleDeg * Math.PI) / 180;
    // Recompute physics thrust direction from all thruster angles
    this.recomputeThrustForwardAngle();
  }

  /** Recompute thrustForwardAngle from current thruster angles */
  private recomputeThrustForwardAngle() {
    if (this.thrusters.length === 0) return;
    const sum = this.thrusters.reduce((s, t) => s + t.angleDeg, 0);
    this.thrustForwardAngle = (sum / this.thrusters.length) * (Math.PI / 180);
  }

  getThrusterAngle(index = 0): number {
    return this.thrusters[index]?.angleDeg ?? 0;
  }

  /** Physics thrust direction offset (radians) — derived from average thruster angles.
   *  Used by scanner to align the scan beam with the ship's actual forward direction. */
  getThrustForwardAngle(): number {
    return this.thrustForwardAngle;
  }

  /** Physics forward heading (radians): mesh rotation + thrust offset.
   *  This is the SINGLE source of truth for "which direction the ship faces." */
  getHeading(): number {
    return this.state.rotation + this.thrustForwardAngle;
  }

  getThrusterPosition(): { x: number; y: number; z: number } {
    return { ...this.thrusterBasePos };
  }

  /** Number of thruster flame sets */
  getThrusterCount(): number {
    return this.thrusters.length;
  }

  /** Ensure exactly `count` thruster flame sets exist.
   *  Adds new ones (at default position) or removes extras as needed.
   *  Call before setThrusterPosition/setThrusterAngle when the editor
   *  changes the number of thrusters. */
  setThrusterCount(count: number) {
    // Remove extras
    while (this.thrusters.length > count) {
      const t = this.thrusters.pop()!;
      this.mesh.remove(t.group);
      (t.core.material as THREE.MeshBasicMaterial).dispose();
      (t.outer.material as THREE.MeshBasicMaterial).dispose();
      t.light.dispose();
    }
    // Add new
    while (this.thrusters.length < count) {
      const coreTex = Ship.createFlameTexture(
        "rgba(255,255,220,1)",
        "rgba(255,160,40,0.8)",
      );
      const outerTex = Ship.createFlameTexture(
        "rgba(255,100,20,0.6)",
        "rgba(255,40,0,0.15)",
      );
      const group = new THREE.Group();
      group.position.set(0, -1.6, 0);

      const core = new THREE.Mesh(
        FLAME_GEO,
        new THREE.MeshBasicMaterial({
          map: coreTex,
          blending: THREE.AdditiveBlending,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      core.scale.set(0.8, 1.6, 1);
      group.add(core);

      const outer = new THREE.Mesh(
        FLAME_GEO,
        new THREE.MeshBasicMaterial({
          map: outerTex,
          blending: THREE.AdditiveBlending,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      outer.scale.set(1.4, 2.4, 1);
      outer.position.set(0, -0.4, 0);
      group.add(outer);

      const light = new THREE.PointLight(0xff4400, 0, 10);
      light.position.set(0, -0.4, 0.5);
      group.add(light);

      this.mesh.add(group);

      this.thrusters.push({
        group, core, outer, light,
        basePos: { x: 0, y: -1.6, z: 0 },
        originalPos: { x: 0, y: -1.6, z: 0 },
        angleDeg: 0,
      });
    }
  }

  /** Live-tune the GLTF model orientation (debug only) */
  setModelRotation(rx: number, ry: number, rz: number) {
    if (this.modelGroup) {
      this.modelGroup.rotation.set(rx, ry, rz);
    }
  }

  /** Hot-swap the ship texture without reloading the model */
  changeTexture(texturePath: string) {
    if (!texturePath) return; // Community ships use embedded PBR — no texture swap
    ModelCache.loadTexture(texturePath).then((texture) => {
      this.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.map = texture;
          mat.needsUpdate = true;
        }
      });
    });
  }

  /** Update material properties (for debug tuning) */
  updateMaterial(property: string, value: number) {
    this.mesh.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.material instanceof THREE.MeshStandardMaterial
      ) {
        if (property === "metalness") child.material.metalness = value;
        else if (property === "roughness") child.material.roughness = value;
        else if (property === "emissiveIntensity")
          child.material.emissiveIntensity = value;
        child.material.needsUpdate = true;
      }
    });
  }

  get position(): Vec2 {
    return this.state.position;
  }

  get speed(): number {
    return Math.sqrt(
      this.state.velocity.x ** 2 + this.state.velocity.y ** 2,
    );
  }

  dispose() {
    // Only dispose cloned materials — NOT shared geometry or cached textures
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
