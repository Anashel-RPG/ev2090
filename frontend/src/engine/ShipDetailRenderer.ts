/**
 * ShipDetailRenderer — full-material spinning ship for the hangar detail panel.
 *
 * Renders with PBR materials, shadow support, and a cinematic lighting rig.
 * Used as an overlay on the ship detail modal's hero image area.
 *
 * Usage (from React via useEffect):
 *   const renderer = new ShipDetailRenderer(canvas, shipId);
 *   return () => renderer.dispose();
 */

import * as THREE from "three";
import { getShipDef, type ShipDef } from "./ShipCatalog";
import { ModelCache } from "./systems/ModelCache";

/** Serializable light config for the detail renderer. */
export interface DetailLightConfig {
  exposure: number;
  ambientIntensity: number;
  keyIntensity: number;
  keyX: number;
  keyY: number;
  keyZ: number;
  fillIntensity: number;
  fillX: number;
  fillY: number;
  fillZ: number;
  rimIntensity: number;
  rimX: number;
  rimY: number;
  rimZ: number;
  camX: number;
  camY: number;
  camZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
}

/** Serializable material config for ship surfaces. */
export interface DetailMaterialConfig {
  metalness: number;
  roughness: number;
  emissiveIntensity: number;
  emissiveR: number; // 0-255
  emissiveG: number;
  emissiveB: number;
}

const DEFAULT_LIGHT_CONFIG: DetailLightConfig = {
  exposure: 1.4,
  ambientIntensity: 0,
  keyIntensity: 2.6,
  keyX: 2, keyY: 5, keyZ: 5,
  fillIntensity: 0,
  fillX: -6, fillY: 1, fillZ: 3,
  rimIntensity: 2.25,
  rimX: 3.5, rimY: 1.5, rimZ: -1.5,
  camX: 0, camY: 1, camZ: 6,
  lookX: -0.45, lookY: 0.65, lookZ: 0,
  fov: 26,
};

const DEFAULT_MATERIAL_CONFIG: DetailMaterialConfig = {
  metalness: 0.5,
  roughness: 0.38,
  emissiveIntensity: 0,
  emissiveR: 0,
  emissiveG: 0,
  emissiveB: 0,
};

/** Centered camera for full-screen hero mode */
const HERO_CAMERA = { camX: 0, camY: 1.0, camZ: 6, lookX: 0, lookY: 0, lookZ: 0 };
/** Corner camera for the small bottom-right preview */
const PREVIEW_CAMERA = { camX: 1.5, camY: 3, camZ: 7, lookX: -0.45, lookY: 0.65, lookZ: 0 };

export class ShipDetailRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private spinGroup: THREE.Group;
  private animId = 0;
  private canvas: HTMLCanvasElement;

  // Exposed lights for tuning
  private ambient: THREE.AmbientLight;
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private shadowPlane: THREE.Mesh;

  // Pose controls
  private paused = false;
  private interactive = false;
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Bound event handlers for cleanup
  private onPointerDown: ((e: PointerEvent) => void) | null = null;
  private onPointerMove: ((e: PointerEvent) => void) | null = null;
  private onPointerUp: ((e: PointerEvent) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, shipId: string, shipDef?: ShipDef) {
    this.canvas = canvas;
    const W = canvas.width || 420;
    const H = canvas.height || 340;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(W, H, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = DEFAULT_LIGHT_CONFIG.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(DEFAULT_LIGHT_CONFIG.fov, W / H, 0.1, 100);
    this.camera.position.set(DEFAULT_LIGHT_CONFIG.camX, DEFAULT_LIGHT_CONFIG.camY, DEFAULT_LIGHT_CONFIG.camZ);
    this.camera.lookAt(DEFAULT_LIGHT_CONFIG.lookX, DEFAULT_LIGHT_CONFIG.lookY, DEFAULT_LIGHT_CONFIG.lookZ);

    // Lighting rig: warm key + cool fill + cyan rim
    this.ambient = new THREE.AmbientLight(0xc8d8ff, DEFAULT_LIGHT_CONFIG.ambientIntensity);
    this.scene.add(this.ambient);

    this.keyLight = new THREE.DirectionalLight(0xffffff, DEFAULT_LIGHT_CONFIG.keyIntensity);
    this.keyLight.position.set(DEFAULT_LIGHT_CONFIG.keyX, DEFAULT_LIGHT_CONFIG.keyY, DEFAULT_LIGHT_CONFIG.keyZ);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(512, 512);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 20;
    this.keyLight.shadow.camera.left = -4;
    this.keyLight.shadow.camera.right = 4;
    this.keyLight.shadow.camera.top = 4;
    this.keyLight.shadow.camera.bottom = -4;
    this.keyLight.shadow.radius = 12;
    this.keyLight.shadow.bias = -0.001;
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0x4488ff, DEFAULT_LIGHT_CONFIG.fillIntensity);
    this.fillLight.position.set(DEFAULT_LIGHT_CONFIG.fillX, DEFAULT_LIGHT_CONFIG.fillY, DEFAULT_LIGHT_CONFIG.fillZ);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0x00ccff, DEFAULT_LIGHT_CONFIG.rimIntensity);
    this.rimLight.position.set(DEFAULT_LIGHT_CONFIG.rimX, DEFAULT_LIGHT_CONFIG.rimY, DEFAULT_LIGHT_CONFIG.rimZ);
    this.scene.add(this.rimLight);

    // Shadow-receiving floor plane
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.ShadowMaterial({ opacity: 0.42, transparent: true }),
    );
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = -1.3;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);

    this.spinGroup = new THREE.Group();
    this.scene.add(this.spinGroup);

    this.loadShip(shipId, shipDef);
    this.animate();
  }

  private loadShip(shipId: string, explicitDef?: ShipDef): void {
    const shipDef = explicitDef ?? getShipDef(shipId);
    if (!shipDef) return;

    const hasEmbeddedTextures = shipDef.source === "community" || !shipDef.texturePath;

    // Use ModelCache (IndexedDB-backed) for loading — avoids re-downloading from CDN.
    // For built-in ships with separate textures, preload both model + texture
    // before adding to scene so there's no visible texture swap.
    const onModelReady = (model: THREE.Group) => {
      if (!hasEmbeddedTextures && shipDef.texturePath) {
        // Built-in ship: apply texture (already loaded via ModelCache)
        const tex = ModelCache.getTexture(shipDef.texturePath);
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.material = new THREE.MeshStandardMaterial({
              map: tex,
              metalness: DEFAULT_MATERIAL_CONFIG.metalness,
              roughness: DEFAULT_MATERIAL_CONFIG.roughness,
            });
          }
        });
      } else {
        // Community ships — apply materialConfig (same as gameplay) + reduce normal maps
        const mc = shipDef.materialConfig;
        const metalness        = mc?.metalness        ?? DEFAULT_MATERIAL_CONFIG.metalness;
        const roughness        = mc?.roughness        ?? DEFAULT_MATERIAL_CONFIG.roughness;
        const emissiveIntensity = mc?.emissiveIntensity ?? DEFAULT_MATERIAL_CONFIG.emissiveIntensity;
        const emissiveColor = new THREE.Color(
          (mc?.emissiveR ?? DEFAULT_MATERIAL_CONFIG.emissiveR) / 255,
          (mc?.emissiveG ?? DEFAULT_MATERIAL_CONFIG.emissiveG) / 255,
          (mc?.emissiveB ?? DEFAULT_MATERIAL_CONFIG.emissiveB) / 255,
        );
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.metalness = metalness;
            mat.roughness = roughness;
            mat.emissive = emissiveColor;
            mat.emissiveIntensity = emissiveIntensity;
            // Reduce (not strip) normal/bump maps — 0.35 keeps surface detail without noise
            if (mat.normalMap) mat.normalScale.set(0.35, 0.35);
            if (mat.bumpMap) mat.bumpScale = 0.02;
            mat.needsUpdate = true;
          }
        });
      }

      // Normalize to a consistent display size
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2.2 / maxDim;
      model.scale.setScalar(scale);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
      model.position.sub(center);

      this.spinGroup.add(model);
    };

    // Preload texture first (if needed), then get model clone
    const loadModel = () => {
      ModelCache.getCloneAsync(
        shipDef.modelPath,
        (clone) => onModelReady(clone),
        (err) => console.error("ShipDetailRenderer: failed to load model:", err),
      );
    };

    if (!hasEmbeddedTextures && shipDef.texturePath) {
      // Preload texture into cache first, then load model
      ModelCache.loadTexture(shipDef.texturePath).then(loadModel).catch(loadModel);
    } else {
      loadModel();
    }
  }

  private animate = (): void => {
    this.animId = requestAnimationFrame(this.animate);
    if (!this.paused) {
      this.spinGroup.rotation.y += 0.005;
    }
    this.renderer.render(this.scene, this.camera);
  };

  /* ─── Light Config ─── */

  getLightConfig(): DetailLightConfig {
    return {
      exposure: this.renderer.toneMappingExposure,
      ambientIntensity: this.ambient.intensity,
      keyIntensity: this.keyLight.intensity,
      keyX: this.keyLight.position.x,
      keyY: this.keyLight.position.y,
      keyZ: this.keyLight.position.z,
      fillIntensity: this.fillLight.intensity,
      fillX: this.fillLight.position.x,
      fillY: this.fillLight.position.y,
      fillZ: this.fillLight.position.z,
      rimIntensity: this.rimLight.intensity,
      rimX: this.rimLight.position.x,
      rimY: this.rimLight.position.y,
      rimZ: this.rimLight.position.z,
      camX: this.camera.position.x,
      camY: this.camera.position.y,
      camZ: this.camera.position.z,
      lookX: DEFAULT_LIGHT_CONFIG.lookX, // lookAt target isn't stored on camera
      lookY: DEFAULT_LIGHT_CONFIG.lookY,
      lookZ: DEFAULT_LIGHT_CONFIG.lookZ,
      fov: this.camera.fov,
    };
  }

  setLightConfig(cfg: Partial<DetailLightConfig>): void {
    if (cfg.exposure !== undefined) this.renderer.toneMappingExposure = cfg.exposure;
    if (cfg.ambientIntensity !== undefined) this.ambient.intensity = cfg.ambientIntensity;
    if (cfg.keyIntensity !== undefined) this.keyLight.intensity = cfg.keyIntensity;
    if (cfg.keyX !== undefined) this.keyLight.position.x = cfg.keyX;
    if (cfg.keyY !== undefined) this.keyLight.position.y = cfg.keyY;
    if (cfg.keyZ !== undefined) this.keyLight.position.z = cfg.keyZ;
    if (cfg.fillIntensity !== undefined) this.fillLight.intensity = cfg.fillIntensity;
    if (cfg.fillX !== undefined) this.fillLight.position.x = cfg.fillX;
    if (cfg.fillY !== undefined) this.fillLight.position.y = cfg.fillY;
    if (cfg.fillZ !== undefined) this.fillLight.position.z = cfg.fillZ;
    if (cfg.rimIntensity !== undefined) this.rimLight.intensity = cfg.rimIntensity;
    if (cfg.rimX !== undefined) this.rimLight.position.x = cfg.rimX;
    if (cfg.rimY !== undefined) this.rimLight.position.y = cfg.rimY;
    if (cfg.rimZ !== undefined) this.rimLight.position.z = cfg.rimZ;
    if (cfg.camX !== undefined) this.camera.position.x = cfg.camX;
    if (cfg.camY !== undefined) this.camera.position.y = cfg.camY;
    if (cfg.camZ !== undefined) this.camera.position.z = cfg.camZ;
    if (cfg.fov !== undefined) {
      this.camera.fov = cfg.fov;
      this.camera.updateProjectionMatrix();
    }
    // Re-point camera at lookAt target
    if (cfg.lookX !== undefined || cfg.lookY !== undefined || cfg.lookZ !== undefined) {
      const current = this.getLightConfig();
      this.camera.lookAt(
        cfg.lookX ?? current.lookX,
        cfg.lookY ?? current.lookY,
        cfg.lookZ ?? current.lookZ,
      );
    }
  }

  /* ─── Material Config ─── */

  getMaterialConfig(): DetailMaterialConfig {
    let metalness = DEFAULT_MATERIAL_CONFIG.metalness;
    let roughness = DEFAULT_MATERIAL_CONFIG.roughness;
    let emissiveIntensity = DEFAULT_MATERIAL_CONFIG.emissiveIntensity;
    let emissiveR = DEFAULT_MATERIAL_CONFIG.emissiveR;
    let emissiveG = DEFAULT_MATERIAL_CONFIG.emissiveG;
    let emissiveB = DEFAULT_MATERIAL_CONFIG.emissiveB;

    // Read from first MeshStandardMaterial found
    this.spinGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        metalness = child.material.metalness;
        roughness = child.material.roughness;
        emissiveIntensity = child.material.emissiveIntensity;
        emissiveR = Math.round(child.material.emissive.r * 255);
        emissiveG = Math.round(child.material.emissive.g * 255);
        emissiveB = Math.round(child.material.emissive.b * 255);
        return; // take first mesh's values
      }
    });

    return { metalness, roughness, emissiveIntensity, emissiveR, emissiveG, emissiveB };
  }

  setMaterialConfig(cfg: Partial<DetailMaterialConfig>): void {
    this.spinGroup.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        const mat = child.material;
        if (cfg.metalness !== undefined) mat.metalness = cfg.metalness;
        if (cfg.roughness !== undefined) mat.roughness = cfg.roughness;
        if (cfg.emissiveIntensity !== undefined) mat.emissiveIntensity = cfg.emissiveIntensity;
        if (cfg.emissiveR !== undefined || cfg.emissiveG !== undefined || cfg.emissiveB !== undefined) {
          const current = mat.emissive;
          mat.emissive.setRGB(
            (cfg.emissiveR ?? Math.round(current.r * 255)) / 255,
            (cfg.emissiveG ?? Math.round(current.g * 255)) / 255,
            (cfg.emissiveB ?? Math.round(current.b * 255)) / 255,
          );
        }
        mat.needsUpdate = true;
      }
    });
  }

  /** Get combined light + material config for COPY CONFIG. */
  getFullConfig(): DetailLightConfig & { material: DetailMaterialConfig } {
    return { ...this.getLightConfig(), material: this.getMaterialConfig() };
  }

  /* ─── Pose Controls ─── */

  /** Switch between centered hero camera and corner preview camera. */
  setHeroMode(hero: boolean): void {
    const cam = hero ? HERO_CAMERA : PREVIEW_CAMERA;
    this.camera.position.set(cam.camX, cam.camY, cam.camZ);
    this.camera.lookAt(cam.lookX, cam.lookY, cam.lookZ);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;

    if (interactive && !this.onPointerDown) {
      this.onPointerDown = (e: PointerEvent) => {
        if (!this.interactive) return;
        this.dragging = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.canvas.setPointerCapture(e.pointerId);
      };

      this.onPointerMove = (e: PointerEvent) => {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;

        // Horizontal drag → Y rotation, Vertical drag → X rotation (clamped)
        this.spinGroup.rotation.y += dx * 0.008;
        this.spinGroup.rotation.x = Math.max(
          -Math.PI / 4,
          Math.min(Math.PI / 4, this.spinGroup.rotation.x + dy * 0.008),
        );
      };

      this.onPointerUp = (_e: PointerEvent) => {
        this.dragging = false;
      };

      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      this.canvas.addEventListener("pointermove", this.onPointerMove);
      this.canvas.addEventListener("pointerup", this.onPointerUp);
      this.canvas.addEventListener("pointercancel", this.onPointerUp);
    } else if (!interactive && this.onPointerDown) {
      this.canvas.removeEventListener("pointerdown", this.onPointerDown);
      this.canvas.removeEventListener("pointermove", this.onPointerMove!);
      this.canvas.removeEventListener("pointerup", this.onPointerUp!);
      this.canvas.removeEventListener("pointercancel", this.onPointerUp!);
      this.onPointerDown = null;
      this.onPointerMove = null;
      this.onPointerUp = null;
      this.dragging = false;
    }
  }

  /** Capture the current frame as a base64 PNG (without data URI prefix).
   *  Hides the shadow plane and uses a solid grey background for clean Gemini input. */
  captureScreenshot(): string {
    // Hide shadow plane — Gemini should only see the ship on a neutral background
    this.shadowPlane.visible = false;
    // Switch to opaque grey background (Gemini needs a non-transparent backdrop)
    this.renderer.setClearColor(0x808080, 1);

    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.canvas.toDataURL("image/png");

    // Restore transparent background + shadow for normal rendering
    this.shadowPlane.visible = true;
    this.renderer.setClearColor(0x000000, 0);

    // Strip the "data:image/png;base64," prefix
    return dataUrl.split(",")[1] || "";
  }

  /** Resize the renderer (e.g. for larger hero capture). */
  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    // Remove pointer listeners
    this.setInteractive(false);

    cancelAnimationFrame(this.animId);
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
