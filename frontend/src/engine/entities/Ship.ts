import * as THREE from "three";
import { ModelCache } from "../systems/ModelCache";
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
}

const DEFAULT_CONFIG: ShipModelConfig = {
  modelPath: "/models/striker/Striker.gltf",
  texturePath: "/models/striker/Striker_Blue.png",
};

/** Shared PlaneGeometry for all flame meshes (avoid per-instance GC) */
const FLAME_GEO = new THREE.PlaneGeometry(1, 1);

export class Ship {
  mesh: THREE.Group;
  state: ShipState;

  private thrusterLight: THREE.PointLight;
  private thrusterCore: THREE.Mesh;
  private thrusterOuter: THREE.Mesh;
  /** Reference to the loaded GLTF model group (for live rotation tuning) */
  private modelGroup: THREE.Group | null = null;
  /** True once the GLTF model (or fallback) is in the scene */
  modelLoaded = false;
  /** Extra tilt angle (radians) for perspective effect — applied on X axis */
  private tiltX = (-22 * Math.PI) / 180;

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
      thrust: 0,
      shields: 1,
      armor: 1,
      fuel: 0.85,
    };

    this.mesh = new THREE.Group();

    // Engine thruster glow — PlaneGeometry meshes (NOT Sprites)
    // so they rotate correctly with the ship instead of always facing camera
    const coreTex = Ship.createFlameTexture(
      "rgba(255,255,220,1)",
      "rgba(255,160,40,0.8)",
    );
    this.thrusterCore = new THREE.Mesh(
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
    this.thrusterCore.scale.set(0.8, 1.6, 1);
    this.thrusterCore.position.set(0, -1.6, 0);
    this.mesh.add(this.thrusterCore);

    const outerTex = Ship.createFlameTexture(
      "rgba(255,100,20,0.6)",
      "rgba(255,40,0,0.15)",
    );
    this.thrusterOuter = new THREE.Mesh(
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
    this.thrusterOuter.scale.set(1.4, 2.4, 1);
    this.thrusterOuter.position.set(0, -2.0, 0);
    this.mesh.add(this.thrusterOuter);

    // Thruster point light
    this.thrusterLight = new THREE.PointLight(0xff4400, 0, 10);
    this.thrusterLight.position.set(0, -2.0, 0.5);
    this.mesh.add(this.thrusterLight);

    // Load the GLTF model
    this.loadModel(config);
  }

  private loadModel(config: ShipModelConfig) {
    ModelCache.getCloneAsync(
      config.modelPath,
      (model) => {
        // Orient for top-down XY plane game:
        // GLTF from Blender: Z-forward (+Z=nose), Y-up (+Y=top)
        // Rx(+π/2) * Ry(π): +Y(top) → world +Z (faces camera ✓), +Z(nose) → world +Y (matches thrust ✓)
        model.rotation.set(Math.PI / 2, Math.PI, 0);
        this.modelGroup = model;
        model.scale.setScalar(MODEL_SCALE);

        // Apply override texture (e.g. Blue variant)
        if (config.texturePath) {
          ModelCache.applyTexture(model, config.texturePath, {
            metalness: 0.4,
            roughness: 0.2,
            emissive: new THREE.Color(0x222233),
            emissiveIntensity: 0.15,
          });
        } else {
          // Enhance the embedded material
          model.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material) {
              const mat = child.material as THREE.MeshStandardMaterial;
              mat.metalness = 0.5;
              mat.roughness = 0.4;
              mat.needsUpdate = true;
            }
          });
        }

        this.mesh.add(model);
        this.modelLoaded = true;
      },
      (error) => {
        console.error("Failed to load ship model:", error);
        this.createFallbackGeometry();
      },
    );
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
    this.mesh.add(fallback);
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

    // Thrust
    if (input.thrustForward && this.state.fuel > 0) {
      const ax = Math.sin(this.state.rotation) * -SHIP_THRUST * dt;
      const ay = Math.cos(this.state.rotation) * SHIP_THRUST * dt;
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

    // Sync mesh — z=10 keeps ship above planet spheres (which extend ±radius in z)
    this.mesh.position.set(this.state.position.x, this.state.position.y, 10);
    this.mesh.rotation.set(this.tiltX, 0, this.state.rotation);

    // Thruster visual — animated flame meshes
    const thrustIntensity = this.state.thrust;
    const flicker = 0.85 + Math.random() * 0.15;

    (this.thrusterCore.material as THREE.MeshBasicMaterial).opacity =
      thrustIntensity * 0.9 * flicker;
    this.thrusterCore.scale.set(
      0.6 + thrustIntensity * 0.3 * flicker,
      1.2 + thrustIntensity * 0.8 * flicker,
      1,
    );

    (this.thrusterOuter.material as THREE.MeshBasicMaterial).opacity =
      thrustIntensity * 0.5 * flicker;
    this.thrusterOuter.scale.set(
      1.0 + thrustIntensity * 0.5 * flicker,
      1.8 + thrustIntensity * 1.2 * flicker,
      1,
    );

    this.thrusterLight.intensity = thrustIntensity * 2;
  }

  /** Set tilt angle (radians) on the X axis for perspective effect */
  setTilt(radians: number) {
    this.tiltX = radians;
  }

  /** Live-tune the GLTF model orientation (debug only) */
  setModelRotation(rx: number, ry: number, rz: number) {
    if (this.modelGroup) {
      this.modelGroup.rotation.set(rx, ry, rz);
    }
  }

  /** Hot-swap the ship texture without reloading the model */
  changeTexture(texturePath: string) {
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
