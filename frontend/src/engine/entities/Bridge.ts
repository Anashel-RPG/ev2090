import * as THREE from "three";
import { ModelCache } from "../systems/ModelCache";

/**
 * Bridge interior entity.
 *
 * Manages the baked bridge GLB — 28 objects split into:
 *   - 9 bake groups (unlit MeshBasicMaterial with baked lightmap textures)
 *   - 4 live screens (CanvasTexture, updated each frame)
 *   - 2 hologram objects (AdditiveBlending, pulsing opacity)
 *   - 13 window cutouts (fully transparent, depthWrite for correct occlusion)
 *
 * The bridge group is parented to the player Ship.mesh so it moves/rotates
 * with the ship. Visibility is toggled by the COMM mode transition.
 *
 * Blender scene uses Z-up. The GLB exporter bakes the Y-up conversion,
 * so no manual axis swap is needed here — just position + scale.
 */

import { ASSET_BASE } from "@/config/urls";

/** Bridge GLB served from R2 CDN (same bucket as ship assets) */
const BRIDGE_MODEL_PATH = `${ASSET_BASE}/bridge/bridge.glb`;

/**
 * PBR TEST MODE — loads the un-baked PBR GLB with original tiling materials
 * and dynamic lighting. Toggle via ?bridgePBR=1 in URL.
 * This proves that the source textures look sharp when not crushed into a bake.
 */
const PBR_TEST = new URLSearchParams(window.location.search).has("bridgePBR");
const BRIDGE_PBR_PATH = "/models/bridge/bridge_pbr_test.glb";

// ── Object name classifications (from the bake pipeline) ──

const BAKE_GROUPS = new Set([
  "BAKE_floor", "BAKE_walls", "BAKE_ceiling", "BAKE_dark_screens",
  "BAKE_misc", "BAKE_desk_a", "BAKE_desk_b", "BAKE_chairs_a", "BAKE_chairs_b",
]);

const LIVE_SCREENS: Record<string, { width: number; height: number }> = {
  "monitor_c006": { width: 540, height: 1080 },
  "monitor_a006": { width: 1280, height: 1024 },
  "monitor_b006": { width: 480, height: 1080 },
  "image_bigscreen1": { width: 2560, height: 2058 },
};

const HOLOGRAMS = new Set(["Sphere001", "image_midreplace"]);

const WINDOWS = new Set([
  "image_wreplace001", "image_wreplace002", "image_wreplace003", "image_wreplace004",
  "image_wreplace005", "image_wreplace006", "image_wreplace007", "image_wreplace008",
  "image_wsreplace001", "image_wsreplace002", "image_wsreplace003",
  "wall_b", "wall_c",
]);

interface ScreenEntry {
  mesh: THREE.Mesh;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  width: number;
  height: number;
  /** True if the screen was initialized with a texture from the GLB (e.g. 00-back.jpg logo) */
  hasBaseImage: boolean;
}

export class Bridge {
  /** Root group — parent this to Ship.mesh */
  group: THREE.Group;

  private bridgeScene: THREE.Group | null = null;
  private screens = new Map<string, ScreenEntry>();
  private hologramMeshes: THREE.Mesh[] = [];
  bakedMaterials: THREE.Material[] = [];
  bridgeLight: THREE.PointLight;
  private _visible = false;
  private _loaded = false;
  private hologramTime = 0;

  // ─── Interior lighting (bridge-only, doesn't affect space world) ───
  // With MeshBasicMaterial, the baked texture renders at full brightness (no emissive needed).
  // emissiveIntensity is kept for API compat but has no visual effect.
  lightIntensity = 8;
  lightX = 0;
  lightY = 2;
  lightZ = 0;
  emissiveIntensity = 1.0;

  // ─── Settled position (ship-local coords, tunable) ───
  // Blender camera at (3.42, 0.63, 1.77) Z-up → GLB Y-up: (3.42, 1.77, -0.63).
  // After bridge.group Rx(-PI/2): (3.42, -0.63, -1.77) in ship-local.
  // FPV camera in ship-local: (0, -0.8, 8.1).
  // Settled = FPV_cam - rotated_blender_cam = (0-3.42, -0.8-(-0.63), 8.1-(-1.77))
  //         = (-3.42, -0.17, 9.87)
  // Fine-tuned via preview: (-3.0, 1.0, 10.5) gives best cockpit framing.
  settledX = 4;
  settledY = -0.3;
  settledZ = 6.2;
  settledScale = 0.85;
  settledRotX = Math.PI / 2; // GLB Y-up → game Z-up (positive: Y→Z, matches ship GLTF)
  settledRotY = -2.99; // Heading rotation — tuned to face windows

  // ─── Slide-in animation ───
  // At bridgeTransition=0, bridge is offset from settled position (below camera).
  // At bridgeTransition=1, bridge is at settled position.
  // Offset direction: comes up from below (negative Z offset at start).
  slideOffsetZ = -15; // how far below settled the bridge starts

  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;

    // Bridge parented to ship.mesh — a sibling of the GLTF model.
    // Inherits ship.mesh transform (position + heading + tilt) but NOT the
    // internal GLTF model rotation. We only need Rx(-PI/2) for Y-up → Z-up.
    this.group.rotation.set(this.settledRotX, this.settledRotY, 0);
    this.group.scale.setScalar(this.settledScale);
    // Start at the off-screen position (will be animated by updateTransition)
    this.group.position.set(this.settledX, this.settledY, this.settledZ + this.slideOffsetZ);

    // Interior fill light — warm white, limited range so it doesn't spill into space
    this.bridgeLight = new THREE.PointLight(0xffeedd, this.lightIntensity, 30, 2);
    this.bridgeLight.position.set(this.lightX, this.lightY, this.lightZ);
    this.group.add(this.bridgeLight);

    // PBR test: add extra lighting since there's no baked illumination
    if (PBR_TEST) {
      // Ambient fill (simulates indirect GI) — boosted for visible interior
      const ambient = new THREE.AmbientLight(0x445566, 1.5);
      this.group.add(ambient);
      // Hemisphere light (sky/ground gradient for depth)
      const hemi = new THREE.HemisphereLight(0x8899bb, 0x334455, 1.2);
      this.group.add(hemi);
      // Ceiling point lights — spread across the bridge, strong enough to reach floor
      const ceilLightPositions = [
        [0, 3, 0], [-6, 3, 0], [6, 3, 0],
        [-3, 3, 4], [3, 3, 4], [-3, 3, -4], [3, 3, -4],
        [0, 3, 8], [0, 3, -8],
      ];
      for (const [x, y, z] of ceilLightPositions) {
        const pl = new THREE.PointLight(0xddeeff, 8, 30, 1.5);
        pl.position.set(x, y, z);
        this.group.add(pl);
      }
      // Desk accent lights — warm glow from control surfaces
      const deskLightPositions = [
        [0, 0.8, 6], [-4, 0.8, 4], [4, 0.8, 4],
      ];
      for (const [x, y, z] of deskLightPositions) {
        const dl = new THREE.PointLight(0xffa844, 5, 15, 2);
        dl.position.set(x, y, z);
        this.group.add(dl);
      }
    }

    // Debug axis lines (R=X, G=Y, B=Z) — 20 unit lines from origin
    this.addDebugAxes();

    this.loadModel();
  }

  /** Add colored axis lines at the bridge origin for position debugging */
  private addDebugAxes() {
    const len = 20;
    // X axis — Red
    const xGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(len, 0, 0),
    ]);
    this.group.add(new THREE.Line(xGeo, new THREE.LineBasicMaterial({ color: 0xff0000 })));
    // Y axis — Green
    const yGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, len, 0),
    ]);
    this.group.add(new THREE.Line(yGeo, new THREE.LineBasicMaterial({ color: 0x00ff00 })));
    // Z axis — Blue
    const zGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, len),
    ]);
    this.group.add(new THREE.Line(zGeo, new THREE.LineBasicMaterial({ color: 0x0088ff })));
  }

  private loadModel() {
    const modelPath = PBR_TEST ? BRIDGE_PBR_PATH : BRIDGE_MODEL_PATH;
    ModelCache.getCloneAsync(
      modelPath,
      (model) => {
        this.bridgeScene = model;
        this.processMeshes(model);
        this.group.add(model);
        this._loaded = true;
      },
      (error) => {
        console.error("[Bridge] Failed to load bridge model:", error);
      },
    );
  }

  /**
   * Walk all meshes in the loaded GLB and classify/configure them.
   */
  private processMeshes(root: THREE.Group) {
    const classified = { bake: [] as string[], screen: [] as string[], holo: [] as string[], window: [] as string[], unknown: [] as string[] };
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      // Interior scene: camera is INSIDE the geometry, so Three.js frustum
      // culling can incorrectly reject meshes whose bounding-sphere center
      // is behind the camera. Disable for all bridge meshes.
      child.frustumCulled = false;

      const name = child.name;

      if (PBR_TEST) {
        // ── PBR TEST MODE: keep original GLTF materials ──

        // Hide chairs — 98 meshes, 604K triangles, 40% of bridge for no visual payoff
        if (name.toLowerCase().includes("chair")) {
          child.visible = false;
          return;
        }

        // Live screens — still replace with CanvasTexture
        if (name in LIVE_SCREENS) {
          this.setupScreen(child, name);
          classified.screen.push(name);
          return;
        }
        // Holograms — still use custom material
        if (HOLOGRAMS.has(name)) {
          this.setupHologram(child);
          classified.holo.push(name);
          return;
        }
        // Window cutouts — still use transparent depth-only
        if (WINDOWS.has(name)) {
          this.setupWindow(child);
          classified.window.push(name);
          return;
        }

        // Everything else: keep PBR material, fix texture settings
        this.setupPBRMesh(child);
        classified.bake.push(name); // reuse bake array for PBR meshes
        return;
      }

      // ── BAKED MODE (original behavior) ──

      // ── Baked structure groups ──
      if (BAKE_GROUPS.has(name)) {
        this.setupBakedMesh(child);
        classified.bake.push(name);
        return;
      }

      // ── Live screens ──
      if (name in LIVE_SCREENS) {
        this.setupScreen(child, name);
        classified.screen.push(name);
        return;
      }

      // ── Holograms ──
      if (HOLOGRAMS.has(name)) {
        this.setupHologram(child);
        classified.holo.push(name);
        return;
      }

      // ── Window cutouts ──
      if (WINDOWS.has(name)) {
        this.setupWindow(child);
        classified.window.push(name);
        return;
      }

      // ── Unknown mesh — treat as baked (safe default) ──
      this.setupBakedMesh(child);
      classified.unknown.push(name);
    });
  }

  /**
   * Baked meshes: MeshBasicMaterial with the baked lightmap as the sole texture.
   *
   * Why MeshBasicMaterial (not MeshStandardMaterial):
   *   The baked textures from Blender already contain ALL lighting (raytraced GI,
   *   reflections, shadows). They ARE the final render. Using MeshStandardMaterial
   *   with a baked texture as both map+emissiveMap causes:
   *     - Dynamic lights double-lighting pre-baked data
   *     - emissiveIntensity < 1 dimming the bake (was 0.3 = 70% quality loss)
   *     - Hardcoded roughness/metalness overriding Blender PBR
   *
   *   MeshBasicMaterial renders the bake at FULL quality — no lighting interaction,
   *   no dimming, no PBR override. The texture IS the light.
   *
   * Texture settings applied:
   *   - colorSpace = SRGBColorSpace (baked textures are sRGB, not linear)
   *   - anisotropy = 16 (prevents pixelation at oblique angles — critical for floor)
   */
  private setupBakedMesh(mesh: THREE.Mesh) {
    const oldMat = mesh.material as THREE.MeshStandardMaterial;
    const bakedMap = oldMat?.map ?? oldMat?.emissiveMap ?? null;

    if (!bakedMap) {
    }

    // Fix texture settings — these are CRITICAL for quality:
    if (bakedMap) {
      // Baked textures are authored in sRGB. Without this, Three.js treats them
      // as linear data → washed out colors, wrong brightness.
      bakedMap.colorSpace = THREE.SRGBColorSpace;
      // Anisotropic filtering: prevents texture blur/pixelation when viewed at
      // oblique angles (e.g. floor from cockpit height). 16 is clamped to GPU max.
      bakedMap.anisotropy = 16;
      bakedMap.needsUpdate = true;
    }

    const mat = new THREE.MeshBasicMaterial({
      map: bakedMap,
      side: THREE.FrontSide,
    });

    // Dispose old material (cloned by ModelCache)
    if (oldMat?.dispose) oldMat.dispose();
    mesh.material = mat;
    this.bakedMaterials.push(mat);
  }

  /**
   * PBR TEST: Keep the GLTF MeshStandardMaterial as-is, just ensure
   * texture wrapping is REPEAT (for tiling) and anisotropy is max.
   * Don't touch colorSpace — the GLTF loader already sets it correctly
   * (sRGB for basecolor/emissive, Linear for normal/roughness/metallic).
   */
  private setupPBRMesh(mesh: THREE.Mesh) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat) return;

    // Collect all textures on this material
    const textures = [
      mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap,
      mat.aoMap, mat.emissiveMap,
    ];
    for (const tex of textures) {
      if (!tex) continue;
      tex.anisotropy = 16;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
    }
  }

  /**
   * Live screens: replace material with CanvasTexture driven by OffscreenCanvas.
   * Each screen gets its own canvas at the correct resolution.
   */
  private setupScreen(mesh: THREE.Mesh, name: string) {
    const { width, height } = LIVE_SCREENS[name]!;

    // ── Extract original texture from GLB material before we dispose it ──
    // The baked GLB embeds screen textures (e.g. 00-back.jpg EV2090 logo) as
    // emissiveMap on Emission-only materials. Grab the image so we can draw it
    // onto the CanvasTexture and keep it visible in-game.
    const oldMat = mesh.material as THREE.MeshStandardMaterial;
    let originalImage: CanvasImageSource | null = null;
    if (oldMat) {
      const tex = oldMat.emissiveMap || oldMat.map;
      if (tex?.image) {
        originalImage = tex.image as CanvasImageSource;
      }
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;

    // Draw original texture if available (logo, monitor content), otherwise dark fill
    let hasBaseImage = false;
    if (originalImage) {
      try {
        ctx.drawImage(originalImage, 0, 0, width, height);
        hasBaseImage = true;
      } catch {
        ctx.fillStyle = "#0a0a12";
        ctx.fillRect(0, 0, width, height);
      }
    } else {
      ctx.fillStyle = "#0a0a12";
      ctx.fillRect(0, 0, width, height);
    }

    const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // GLB UV convention
    texture.needsUpdate = true;

    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
    });

    // Dispose old material (we already extracted the texture image above)
    if (oldMat?.dispose) oldMat.dispose();
    mesh.material = mat;

    this.screens.set(name, { mesh, canvas, ctx, texture, width, height, hasBaseImage });
  }

  /**
   * Hologram meshes: additive blending, semi-transparent, pulsing.
   */
  private setupHologram(mesh: THREE.Mesh) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44aaff,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const oldMat = mesh.material as THREE.Material;
    if (oldMat?.dispose) oldMat.dispose();
    mesh.material = mat;

    this.hologramMeshes.push(mesh);
  }

  /**
   * Window cutouts: fully transparent geometry that writes to depth buffer.
   * The game world (stars, planets, NPCs) renders behind these naturally
   * since they're inside the bridge bounding volume.
   */
  private setupWindow(mesh: THREE.Mesh) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: true,
      side: THREE.DoubleSide,
      colorWrite: false, // don't draw pixels, just write depth
    });

    const oldMat = mesh.material as THREE.Material;
    if (oldMat?.dispose) oldMat.dispose();
    mesh.material = mat;
  }

  // ─── Visibility ───

  setVisible(visible: boolean) {
    this._visible = visible;
    this.group.visible = visible;
  }

  isVisible(): boolean {
    return this._visible;
  }

  isLoaded(): boolean {
    return this._loaded;
  }

  // ─── Per-frame updates ───

  /**
   * Update live screens and hologram animation.
   * Called from Engine.loop() when the bridge is visible.
   */
  updateScreens(dt: number, _screenData?: Record<string, unknown>) {
    // Hologram pulse animation
    this.hologramTime += dt;
    const pulse = 0.2 + 0.15 * Math.sin(this.hologramTime * 2.5);
    for (const holo of this.hologramMeshes) {
      (holo.material as THREE.MeshBasicMaterial).opacity = pulse;
    }

    // Screen content — placeholder: animated scan lines
    // Future: screenData would provide actual game data for each screen
    for (const [_name, entry] of this.screens) {
      this.drawPlaceholderScreen(entry, this.hologramTime);
    }
  }

  /**
   * Placeholder screen content: dark background with scrolling scan lines
   * and a subtle grid pattern. Replaced later with real data feeds.
   */
  private drawPlaceholderScreen(entry: ScreenEntry, time: number) {
    const { ctx, texture, width, height } = entry;

    // Screens with real content (e.g. EV2090 logo) already have their image drawn —
    // no need to redraw every frame. Skip the animated placeholder.
    if (entry.hasBaseImage) return;

    // Dark base
    ctx.fillStyle = "#060610";
    ctx.fillRect(0, 0, width, height);

    // Subtle grid
    ctx.strokeStyle = "rgba(40, 80, 120, 0.15)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Scrolling scan line
    const scanY = ((time * 80) % (height + 40)) - 20;
    const gradient = ctx.createLinearGradient(0, scanY - 20, 0, scanY + 20);
    gradient.addColorStop(0, "rgba(40, 120, 200, 0)");
    gradient.addColorStop(0.5, "rgba(40, 120, 200, 0.12)");
    gradient.addColorStop(1, "rgba(40, 120, 200, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, scanY - 20, width, 40);

    // Corner markers
    ctx.strokeStyle = "rgba(60, 140, 220, 0.3)";
    ctx.lineWidth = 2;
    const m = 10; // margin
    const c = 20; // corner length
    // Top-left
    ctx.beginPath(); ctx.moveTo(m, m + c); ctx.lineTo(m, m); ctx.lineTo(m + c, m); ctx.stroke();
    // Top-right
    ctx.beginPath(); ctx.moveTo(width - m - c, m); ctx.lineTo(width - m, m); ctx.lineTo(width - m, m + c); ctx.stroke();
    // Bottom-left
    ctx.beginPath(); ctx.moveTo(m, height - m - c); ctx.lineTo(m, height - m); ctx.lineTo(m + c, height - m); ctx.stroke();
    // Bottom-right
    ctx.beginPath(); ctx.moveTo(width - m - c, height - m); ctx.lineTo(width - m, height - m); ctx.lineTo(width - m, height - m - c); ctx.stroke();

    texture.needsUpdate = true;
  }

  // ─── Transition animation ───

  /**
   * Update the bridge model position based on bridgeTransition (0→1).
   * The camera does NOT move — the bridge slides into position around it.
   *
   * At t=0: bridge is offset below (slideOffsetZ below settled position).
   * At t=1: bridge is at settled position (cockpit surrounds FPV camera).
   *
   * Called from Engine.loop() each frame when bridgeTransition > 0.
   */
  updateTransition(t: number) {
    // easeInOutCubic
    const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

    // Lerp Z from offset to settled
    const z = this.settledZ + this.slideOffsetZ * (1 - ease);
    this.group.position.set(this.settledX, this.settledY, z);
    this.group.scale.setScalar(this.settledScale);
    this.group.rotation.set(this.settledRotX, this.settledRotY, 0);
  }

  // ─── Config API (for React tuning panel) ───

  getBridgeModelConfig(): Record<string, number> {
    return {
      bridgeX: this.settledX,
      bridgeY: this.settledY,
      bridgeZ: this.settledZ,
      bridgeScale: this.settledScale,
      bridgeRotY: this.settledRotY,
      bridgeSlideZ: this.slideOffsetZ,
      lightIntensity: this.lightIntensity,
      lightX: this.lightX,
      lightY: this.lightY,
      lightZ: this.lightZ,
      emissiveIntensity: this.emissiveIntensity,
    };
  }

  setBridgeModelParam(key: string, value: number) {
    if (key === "bridgeX") this.settledX = value;
    else if (key === "bridgeY") this.settledY = value;
    else if (key === "bridgeZ") this.settledZ = value;
    else if (key === "bridgeScale") {
      this.settledScale = value;
      this.group.scale.setScalar(value);
    }
    else if (key === "bridgeRotY") this.settledRotY = value;
    else if (key === "bridgeSlideZ") this.slideOffsetZ = value;
    else if (key === "lightIntensity") {
      this.lightIntensity = value;
      this.bridgeLight.intensity = value;
    }
    else if (key === "lightX") {
      this.lightX = value;
      this.bridgeLight.position.x = value;
    }
    else if (key === "lightY") {
      this.lightY = value;
      this.bridgeLight.position.y = value;
    }
    else if (key === "lightZ") {
      this.lightZ = value;
      this.bridgeLight.position.z = value;
    }
    else if (key === "emissiveIntensity") {
      this.emissiveIntensity = value;
      // With MeshBasicMaterial, emissiveIntensity has no effect — bake is always full brightness.
      // This setter is kept for API compatibility (BridgeEditor panel).
    }
  }

  // ─── Cleanup ───

  dispose() {
    // Dispose screen textures and canvases
    for (const [, entry] of this.screens) {
      entry.texture.dispose();
      (entry.mesh.material as THREE.Material).dispose();
    }
    this.screens.clear();

    // Dispose hologram materials
    for (const holo of this.hologramMeshes) {
      (holo.material as THREE.Material).dispose();
    }
    this.hologramMeshes = [];

    // Dispose bridge interior light and tracked materials
    this.bridgeLight.dispose();
    this.bakedMaterials = [];

    // Dispose all remaining materials in the bridge scene
    this.bridgeScene?.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
  }
}
