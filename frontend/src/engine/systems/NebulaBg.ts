import * as THREE from "three";

// ---------------------------------------------------------------------------
// NebulaBg.ts
// Two-layer deep-space background:
//   1. CDN image (Eve Online style nebula photo) — fixed to camera
//   2. Procedural noise-based nebula clouds — very slight parallax for depth
//
// Both layers use depthTest: true so planets properly occlude them.
// ---------------------------------------------------------------------------

import { CDN_BASE } from "@/config/urls";

const BG_IMAGE_URL = `${CDN_BASE}/images/nebula.jpg`;

const BG_SIZE = 2048; // procedural texture resolution
const NEBULA_PARALLAX = 0.08; // how much the nebula drifts relative to camera

// ── Procedural nebula generation (value noise, layered clouds) ──────────────

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNoiseField(
  width: number,
  height: number,
  scale: number,
  octaves: number,
  rng: () => number,
): Float32Array {
  const field = new Float32Array(width * height);

  for (let oct = 0; oct < octaves; oct++) {
    const s = scale / Math.pow(2, oct);
    const amp = 1 / Math.pow(2, oct);
    const gW = Math.ceil(width / s) + 2;
    const gH = Math.ceil(height / s) + 2;
    const g = new Float32Array(gW * gH);
    for (let i = 0; i < g.length; i++) g[i] = rng();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const fx = x / s;
        const fy = y / s;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);

        const i00 = iy * gW + ix;
        const v00 = g[i00] ?? 0;
        const v10 = g[i00 + 1] ?? 0;
        const v01 = g[i00 + gW] ?? 0;
        const v11 = g[i00 + gW + 1] ?? 0;

        const top = v00 + (v10 - v00) * sx;
        const bot = v01 + (v11 - v01) * sx;
        field[y * width + x] = (field[y * width + x] ?? 0) + (top + (bot - top) * sy) * amp;
      }
    }
  }

  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < field.length; i++) {
    if (field[i]! < min) min = field[i]!;
    if (field[i]! > max) max = field[i]!;
  }
  const range = max - min || 1;
  for (let i = 0; i < field.length; i++) {
    field[i] = (field[i]! - min) / range;
  }
  return field;
}

function paintNebula(
  data: Uint8ClampedArray,
  noise: Float32Array,
  r: number,
  g: number,
  b: number,
  opacity: number,
  threshold: number,
  softness: number,
) {
  for (let i = 0; i < noise.length; i++) {
    let v = Math.max(0, (noise[i]! - threshold) / softness);
    v = Math.min(1, v);
    v = v * v * (3 - 2 * v) * opacity;
    const idx = i * 4;
    data[idx] = Math.min(255, data[idx]! + r * v);
    data[idx + 1] = Math.min(255, data[idx + 1]! + g * v);
    data[idx + 2] = Math.min(255, data[idx + 2]! + b * v);
  }
}

function paintStarDust(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  count: number,
  rng: () => number,
) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * w);
    const y = Math.floor(rng() * h);
    const bri = 100 + Math.floor(rng() * 155);
    const idx = (y * w + x) * 4;
    data[idx] = Math.min(255, data[idx]! + bri * 0.9);
    data[idx + 1] = Math.min(255, data[idx + 1]! + bri * 0.92);
    data[idx + 2] = Math.min(255, data[idx + 2]! + bri);
  }
}

function paintVignette(data: Uint8ClampedArray, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxR;
      const fade = 1 - Math.pow(d, 1.8) * 0.6;
      const idx = (y * w + x) * 4;
      data[idx] = Math.floor(data[idx]! * fade);
      data[idx + 1] = Math.floor(data[idx + 1]! * fade);
      data[idx + 2] = Math.floor(data[idx + 2]! * fade);
    }
  }
}

function generateNebulaCanvas(seed = 42): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = BG_SIZE;
  canvas.height = BG_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#050510";
  ctx.fillRect(0, 0, BG_SIZE, BG_SIZE);

  const imageData = ctx.getImageData(0, 0, BG_SIZE, BG_SIZE);
  const d = imageData.data;
  const rng = mulberry32(seed);

  const n1 = createNoiseField(BG_SIZE, BG_SIZE, 200, 5, mulberry32(seed + 1));
  const n2 = createNoiseField(BG_SIZE, BG_SIZE, 300, 4, mulberry32(seed + 2));
  const n3 = createNoiseField(BG_SIZE, BG_SIZE, 150, 5, mulberry32(seed + 3));
  const n4 = createNoiseField(BG_SIZE, BG_SIZE, 400, 3, mulberry32(seed + 4));
  const n5 = createNoiseField(BG_SIZE, BG_SIZE, 250, 4, mulberry32(seed + 5));

  paintNebula(d, n4, 15, 8, 35, 0.5, 0.2, 0.6);
  paintNebula(d, n1, 5, 25, 40, 0.4, 0.35, 0.45);
  paintNebula(d, n2, 35, 8, 25, 0.3, 0.4, 0.4);
  paintNebula(d, n3, 20, 22, 45, 0.25, 0.5, 0.35);
  paintNebula(d, n5, 30, 20, 5, 0.15, 0.45, 0.35);
  paintStarDust(d, BG_SIZE, BG_SIZE, 4000, rng);
  paintVignette(d, BG_SIZE, BG_SIZE);

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ── NebulaBg class ──────────────────────────────────────────────────────────

export class NebulaBg {
  /** Add this to the scene */
  readonly group: THREE.Group;

  // CDN image layer
  private imagePlane: THREE.Mesh | null = null;
  private imageMaterial: THREE.MeshBasicMaterial | null = null;
  private imageTexture: THREE.Texture | null = null;

  // Procedural nebula layer
  private nebulaPlane: THREE.Mesh;
  private nebulaMaterial: THREE.MeshBasicMaterial;
  private nebulaTexture: THREE.CanvasTexture;

  // FPV fade: base opacities are set by config panel, fpvFade multiplies them
  private baseImageOpacity = 0.14;
  private baseNebulaOpacity = 0.2;
  private fpvFade = 1; // 1 = fully visible, 0 = hidden

  constructor() {
    this.group = new THREE.Group();

    // ── Layer 1: CDN image background (loads async) ───
    const loader = new THREE.TextureLoader();
    loader.load(
      BG_IMAGE_URL,
      (texture) => {
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        this.imageTexture = texture;

        this.imageMaterial = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
          depthTest: true,
        });

        // ~16:9 aspect to match the image
        const geo = new THREE.PlaneGeometry(100, 56);
        this.imagePlane = new THREE.Mesh(geo, this.imageMaterial);
        this.imagePlane.renderOrder = -100;
        // Z is set dynamically in update() to track camera distance
        this.group.add(this.imagePlane);
      },
      undefined,
      () => {
        // Image load failed — no big deal, procedural nebula is the fallback
      },
    );

    // ── Layer 2: Procedural noise-based nebula ───
    const canvas = generateNebulaCanvas();
    this.nebulaTexture = new THREE.CanvasTexture(canvas);
    this.nebulaTexture.minFilter = THREE.LinearFilter;
    this.nebulaTexture.magFilter = THREE.LinearFilter;

    this.nebulaMaterial = new THREE.MeshBasicMaterial({
      map: this.nebulaTexture,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      depthTest: true,
    });

    this.nebulaPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(250, 250),
      this.nebulaMaterial,
    );
    this.nebulaPlane.renderOrder = -99;
    // Z is set dynamically in update() to track camera distance
    this.group.add(this.nebulaPlane);
  }

  /** Call every frame — keeps layers centered (or near-centered) on camera.
   *  cameraZ is used to maintain constant camera-to-plane distance so that
   *  switching from ortho to perspective doesn't change apparent background size. */
  update(cameraX: number, cameraY: number, cameraZ: number) {
    // Image: fixed to camera (infinitely far away — no parallax).
    // Z tracks camera to keep constant distance (125 units = original 100 - (-25)).
    if (this.imagePlane) {
      this.imagePlane.position.x = cameraX;
      this.imagePlane.position.y = cameraY;
      this.imagePlane.position.z = cameraZ - 125;
    }

    // Procedural nebula: very slight parallax for depth.
    // Z tracks camera to keep constant distance (122 units = original 100 - (-22)).
    this.nebulaPlane.position.x = cameraX * (1 - NEBULA_PARALLAX);
    this.nebulaPlane.position.y = cameraY * (1 - NEBULA_PARALLAX);
    this.nebulaPlane.position.z = cameraZ - 122;
  }

  // ── Opacity API for config panel ──

  setImageOpacity(v: number) {
    this.baseImageOpacity = v;
    if (this.imageMaterial) this.imageMaterial.opacity = v * this.fpvFade;
  }
  setNebulaOpacity(v: number) {
    this.baseNebulaOpacity = v;
    this.nebulaMaterial.opacity = v * this.fpvFade;
  }
  getImageOpacity(): number {
    return this.baseImageOpacity;
  }
  getNebulaOpacity(): number {
    return this.baseNebulaOpacity;
  }

  /**
   * Set FPV fade multiplier (1 = fully visible, 0 = hidden).
   * Multiplies the base opacities set by config panel.
   * Called by Engine during FPV transition to fade out the flat nebula planes.
   */
  setFpvFade(v: number) {
    this.fpvFade = Math.max(0, Math.min(1, v));
    if (this.imageMaterial) {
      this.imageMaterial.opacity = this.baseImageOpacity * this.fpvFade;
    }
    this.nebulaMaterial.opacity = this.baseNebulaOpacity * this.fpvFade;
  }

  dispose() {
    if (this.imagePlane) {
      this.imagePlane.geometry.dispose();
      this.imageMaterial?.dispose();
      this.imageTexture?.dispose();
    }
    this.nebulaPlane.geometry.dispose();
    this.nebulaMaterial.dispose();
    this.nebulaTexture.dispose();
  }
}
