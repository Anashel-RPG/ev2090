// ---------------------------------------------------------------------------
// PlanetTextureGen.ts
// Procedural equirectangular planet texture generation using HTML Canvas.
// Produces a 512x256 canvas for each supported planet type using multi-octave
// value noise. No external dependencies.
// ---------------------------------------------------------------------------

const WIDTH = 512;
const HEIGHT = 256;

// ---- Seedable pseudo-random number generator (xorshift32) -----------------

function xorshift32(seed: number): () => number {
  let state = seed | 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0xffffffff);
  };
}

// ---- Value noise implementation -------------------------------------------

/** Build a 2-D lattice of random values used by the value-noise sampler. */
function buildLattice(size: number, rng: () => number): Float64Array {
  const lattice = new Float64Array(size * size);
  for (let i = 0; i < lattice.length; i++) {
    lattice[i] = rng();
  }
  return lattice;
}

/** Smooth (cubic / Hermite) interpolation. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear sample with smooth interpolation on a tileable lattice. */
function sampleLattice(
  lattice: Float64Array,
  size: number,
  x: number,
  y: number,
): number {
  // Wrap coordinates so the texture tiles horizontally (equirectangular).
  const fx = ((x % size) + size) % size;
  const fy = ((y % size) + size) % size;

  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smoothstep(fx - ix);
  const ty = smoothstep(fy - iy);

  const ix1 = (ix + 1) % size;
  const iy1 = (iy + 1) % size;

  const v00 = lattice[iy * size + ix] ?? 0;
  const v10 = lattice[iy * size + ix1] ?? 0;
  const v01 = lattice[iy1 * size + ix] ?? 0;
  const v11 = lattice[iy1 * size + ix1] ?? 0;

  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/**
 * Multi-octave value noise.
 * Returns a value in roughly [0, 1].
 */
function valueNoise(
  lattice: Float64Array,
  latticeSize: number,
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  persistence: number,
): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let maxAmplitude = 0;

  for (let o = 0; o < octaves; o++) {
    total += sampleLattice(lattice, latticeSize, x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return total / maxAmplitude;
}

// ---- Colour helpers -------------------------------------------------------

/** Parse a hex colour string (#rrggbb) into [r, g, b] (0-255). */
function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Linearly interpolate between two RGB colours. t in [0, 1]. */
function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Clamp a value to [0, 255]. */
function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// ---- Per-planet generators ------------------------------------------------

function generateMars(
  imageData: ImageData,
  lattice: Float64Array,
  latticeSize: number,
): void {
  const data = imageData.data;
  const base = hexToRgb('#cc4422');
  const dark = hexToRgb('#aa3311');
  const light = hexToRgb('#dd6633');
  const craterDark = hexToRgb('#772211');

  // Secondary lattice for crater features.
  const rng2 = xorshift32(9173);
  const lattice2 = buildLattice(latticeSize, rng2);

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const nx = x / WIDTH * latticeSize;
      const ny = y / HEIGHT * latticeSize;

      // Large-scale terrain.
      const n1 = valueNoise(lattice, latticeSize, nx, ny, 5, 2.0, 0.5);
      // Higher-frequency detail (canyons / ridges).
      const n2 = valueNoise(lattice2, latticeSize, nx * 1.5, ny * 1.5, 4, 2.2, 0.45);

      // Blend base colours by noise.
      let color: [number, number, number];
      if (n1 < 0.4) {
        color = lerpColor(dark, base, n1 / 0.4);
      } else {
        color = lerpColor(base, light, (n1 - 0.4) / 0.6);
      }

      // Crater-like dark spots: where secondary noise is very low.
      if (n2 < 0.3) {
        const t = 1 - n2 / 0.3; // 0..1, strongest at center
        color = lerpColor(color, craterDark, t * 0.6);
      }

      // Subtle brightness variation.
      const brightness = 0.85 + n1 * 0.3;
      const idx = (y * WIDTH + x) * 4;
      data[idx] = clamp255(color[0] * brightness);
      data[idx + 1] = clamp255(color[1] * brightness);
      data[idx + 2] = clamp255(color[2] * brightness);
      data[idx + 3] = 255;
    }
  }
}

function generateNeptune(
  imageData: ImageData,
  lattice: Float64Array,
  latticeSize: number,
): void {
  const data = imageData.data;
  const deep = hexToRgb('#1133aa');
  const mid = hexToRgb('#2255cc');
  const light = hexToRgb('#1144bb');
  const highlight = hexToRgb('#4488ee');

  const rng2 = xorshift32(4482);
  const lattice2 = buildLattice(latticeSize, rng2);

  for (let y = 0; y < HEIGHT; y++) {
    // Horizontal banding: use latitude to drive a sine-based band structure.
    const lat = y / HEIGHT; // 0..1
    const bandBase = Math.sin(lat * Math.PI * 8) * 0.5 + 0.5; // 0..1

    for (let x = 0; x < WIDTH; x++) {
      const nx = x / WIDTH * latticeSize;
      const ny = y / HEIGHT * latticeSize;

      // Large swirling features (stretch horizontally for gas-giant look).
      const n1 = valueNoise(lattice, latticeSize, nx * 0.8, ny * 1.6, 5, 2.0, 0.5);
      // Fine turbulence.
      const n2 = valueNoise(lattice2, latticeSize, nx * 2.0, ny * 3.0, 4, 2.0, 0.4);

      // Combine banding with noise to create wind-distorted bands.
      const bandVal = bandBase * 0.5 + n1 * 0.35 + n2 * 0.15;

      let color: [number, number, number];
      if (bandVal < 0.35) {
        color = lerpColor(deep, mid, bandVal / 0.35);
      } else if (bandVal < 0.65) {
        color = lerpColor(mid, light, (bandVal - 0.35) / 0.3);
      } else {
        color = lerpColor(light, highlight, (bandVal - 0.65) / 0.35);
      }

      // Slight brightness modulation.
      const brightness = 0.9 + n1 * 0.2;
      const idx = (y * WIDTH + x) * 4;
      data[idx] = clamp255(color[0] * brightness);
      data[idx + 1] = clamp255(color[1] * brightness);
      data[idx + 2] = clamp255(color[2] * brightness);
      data[idx + 3] = 255;
    }
  }
}

function generateLuna(
  imageData: ImageData,
  lattice: Float64Array,
  latticeSize: number,
): void {
  const data = imageData.data;
  const base = hexToRgb('#999999');
  const dark = hexToRgb('#777777');
  const light = hexToRgb('#aaaaaa');
  const craterFloor = hexToRgb('#555555');
  const craterRim = hexToRgb('#bbbbbb');

  const rng2 = xorshift32(6631);
  const lattice2 = buildLattice(latticeSize, rng2);
  const rng3 = xorshift32(2290);
  const lattice3 = buildLattice(latticeSize, rng3);

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const nx = x / WIDTH * latticeSize;
      const ny = y / HEIGHT * latticeSize;

      // Base terrain.
      const n1 = valueNoise(lattice, latticeSize, nx, ny, 5, 2.0, 0.5);
      // Crater mask (low-frequency blobs that will become "maria").
      const n2 = valueNoise(lattice2, latticeSize, nx * 0.7, ny * 0.7, 3, 2.0, 0.55);
      // Fine surface detail.
      const n3 = valueNoise(lattice3, latticeSize, nx * 2.0, ny * 2.0, 4, 2.0, 0.4);

      // Base grey with subtle variation.
      let color: [number, number, number];
      if (n1 < 0.45) {
        color = lerpColor(dark, base, n1 / 0.45);
      } else {
        color = lerpColor(base, light, (n1 - 0.45) / 0.55);
      }

      // Dark maria (large crater basins) where n2 is low.
      if (n2 < 0.35) {
        const t = 1 - n2 / 0.35;
        color = lerpColor(color, craterFloor, t * 0.55);
      }

      // Crater rims: where the gradient of n2 is steep (approximate with
      // a narrow band just above the maria threshold).
      if (n2 >= 0.35 && n2 < 0.42) {
        const t = 1 - (n2 - 0.35) / 0.07;
        color = lerpColor(color, craterRim, t * 0.4);
      }

      // Fine surface roughness.
      const detail = 0.88 + n3 * 0.24;
      const idx = (y * WIDTH + x) * 4;
      data[idx] = clamp255(color[0] * detail);
      data[idx + 1] = clamp255(color[1] * detail);
      data[idx + 2] = clamp255(color[2] * detail);
      data[idx + 3] = 255;
    }
  }
}

function generateTerran(
  imageData: ImageData,
  lattice: Float64Array,
  latticeSize: number,
): void {
  const data = imageData.data;

  // Earth-like color palette
  const deepOcean = hexToRgb('#0a1e3d');
  const ocean = hexToRgb('#0f3366');
  const shallowOcean = hexToRgb('#1a4a7a');
  const sand = hexToRgb('#c4a862');
  const lowland = hexToRgb('#2d6b30');
  const forest = hexToRgb('#1e5428');
  const highland = hexToRgb('#4a6633');
  const mountain = hexToRgb('#7a6a4a');
  const rock = hexToRgb('#8a7a5a');
  const snow = hexToRgb('#d8d8d0');
  const ice = hexToRgb('#c8d8e8');

  // 3 lattices for layered detail (like Luna approach)
  const rng2 = xorshift32(7731);
  const lattice2 = buildLattice(latticeSize, rng2);
  const rng3 = xorshift32(3319);
  const lattice3 = buildLattice(latticeSize, rng3);

  const sea = 0.46; // sea level threshold

  for (let y = 0; y < HEIGHT; y++) {
    // Latitude: 0 at equator, 1 at poles (for polar ice)
    const lat = Math.abs(y / HEIGHT - 0.5) * 2.0; // 0..1 (equator..pole)

    for (let x = 0; x < WIDTH; x++) {
      const nx = x / WIDTH * latticeSize;
      const ny = y / HEIGHT * latticeSize;

      // Layer 1: Large continental shapes (low frequency)
      const n1 = valueNoise(lattice, latticeSize, nx * 0.8, ny * 0.8, 5, 2.0, 0.5);
      // Layer 2: Mid-frequency coastline variation
      const n2 = valueNoise(lattice2, latticeSize, nx * 1.6, ny * 1.6, 4, 2.2, 0.45);
      // Layer 3: High-frequency surface detail
      const n3 = valueNoise(lattice3, latticeSize, nx * 3.0, ny * 3.0, 4, 2.0, 0.4);

      // Combine noise layers for elevation with sharper continent edges
      // Apply a curve to n1 to create more distinct land/ocean separation
      const curved = n1 * n1 * (3 - 2 * n1); // smoothstep-like sharpening
      const elev = curved * 0.55 + n2 * 0.3 + n3 * 0.15;

      let color: [number, number, number];

      if (elev < sea - 0.12) {
        // Deep ocean
        const t = Math.max(0, elev / (sea - 0.12));
        color = lerpColor(deepOcean, ocean, t);
      } else if (elev < sea - 0.03) {
        // Mid ocean
        const t = (elev - (sea - 0.12)) / 0.09;
        color = lerpColor(ocean, shallowOcean, t);
      } else if (elev < sea) {
        // Shallow / near-shore
        const t = (elev - (sea - 0.03)) / 0.03;
        color = lerpColor(shallowOcean, sand, t * 0.5);
      } else if (elev < sea + 0.03) {
        // Sandy coast / beach
        const t = (elev - sea) / 0.03;
        color = lerpColor(sand, lowland, t);
      } else if (elev < sea + 0.12) {
        // Lowlands (green)
        const t = (elev - sea - 0.03) / 0.09;
        color = lerpColor(lowland, forest, t);
      } else if (elev < sea + 0.22) {
        // Forest → highland
        const t = (elev - sea - 0.12) / 0.10;
        color = lerpColor(forest, highland, t);
      } else if (elev < sea + 0.32) {
        // Highland → mountain
        const t = (elev - sea - 0.22) / 0.10;
        color = lerpColor(highland, mountain, t);
      } else if (elev < sea + 0.40) {
        // Mountain → rock
        const t = (elev - sea - 0.32) / 0.08;
        color = lerpColor(mountain, rock, t);
      } else {
        // Peaks → snow
        const t = Math.min(1, (elev - sea - 0.40) / 0.12);
        color = lerpColor(rock, snow, t);
      }

      // Polar ice caps: blend to ice at high latitudes
      // Stronger at poles, with noise modulation for irregular edges
      const polarThreshold = 0.65 + n2 * 0.15; // irregular ice edge
      if (lat > polarThreshold) {
        const iceT = Math.min(1, (lat - polarThreshold) / 0.2);
        color = lerpColor(color, ice, iceT * 0.85);
      }

      // Surface detail: fine brightness modulation from n3
      const detail = 0.90 + n3 * 0.20;
      const idx = (y * WIDTH + x) * 4;
      data[idx] = clamp255(color[0] * detail);
      data[idx + 1] = clamp255(color[1] * detail);
      data[idx + 2] = clamp255(color[2] * detail);
      data[idx + 3] = 255;
    }
  }
}

// ---- Public API -----------------------------------------------------------

/**
 * Generate a procedural equirectangular planet texture on an HTML Canvas.
 *
 * @param type - The planet type to generate.
 * @returns An HTMLCanvasElement (512x256) containing the texture.
 */
export function generatePlanetTexture(
  type: 'mars' | 'neptune' | 'luna' | 'terran',
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(WIDTH, HEIGHT);

  // Deterministic seed per planet type so textures are stable across calls.
  const seeds: Record<string, number> = {
    mars: 42,
    neptune: 137,
    luna: 256,
    terran: 814,
  };

  const rng = xorshift32(seeds[type] ?? 1);
  // Terran uses 128×128 lattice for finer detail; others use 64×64
  const latticeSize = type === 'terran' ? 128 : 64;
  const lattice = buildLattice(latticeSize, rng);

  switch (type) {
    case 'mars':
      generateMars(imageData, lattice, latticeSize);
      break;
    case 'neptune':
      generateNeptune(imageData, lattice, latticeSize);
      break;
    case 'luna':
      generateLuna(imageData, lattice, latticeSize);
      break;
    case 'terran':
      generateTerran(imageData, lattice, latticeSize);
      break;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
