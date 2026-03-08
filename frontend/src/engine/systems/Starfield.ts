import * as THREE from "three";

/** Multi-layer parallax starfield background + FPV star sphere */

interface StarLayer {
  points: THREE.Points;
  speed: number; // parallax speed multiplier (0-1, lower = more distant)
  basePositions: Float32Array;
  baseMaterial: THREE.PointsMaterial;
}

export class Starfield {
  private layers: StarLayer[] = [];
  private scene: THREE.Scene;

  // FPV star sphere — surrounds the camera during FPV mode
  private fpvSphere: THREE.Points | null = null;
  private fpvSphereMaterial: THREE.PointsMaterial | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Dense distant dust — very tiny, high count for that deep-space feel
    this.createLayer(3000, 0.2, 0.10, [0.35, 0.35, 0.45]);
    // Mid-distant stars
    this.createLayer(1200, 0.5, 0.18, [0.45, 0.45, 0.55]);
    // Standard stars
    this.createLayer(600, 0.8, 0.30, [0.6, 0.6, 0.7]);
    // Near bright stars — larger, less numerous
    this.createLayer(200, 1.5, 0.50, [0.8, 0.85, 1.0]);
    // Rare bright stars — occasional blue-white sparkles
    this.createLayer(40, 2.2, 0.65, [0.9, 0.92, 1.0]);

    // Create the FPV star sphere (hidden by default — zero GPU cost)
    this.createFpvSphere();
  }

  private createLayer(
    count: number,
    size: number,
    speed: number,
    color: [number, number, number],
  ) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const spread = 600;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * spread;
      positions[i3 + 1] = (Math.random() - 0.5) * spread;
      positions[i3 + 2] = -1 - speed * 10; // push behind ship

      // Slight color variation per star
      const brightness = 0.7 + Math.random() * 0.3;
      // Occasional warm-tinted star (adds visual variety)
      const warmTint = Math.random() < 0.08 ? 0.15 : 0;
      colors[i3] = Math.min(1, color[0] * brightness + warmTint);
      colors[i3 + 1] = color[1] * brightness;
      colors[i3 + 2] = color[2] * brightness;

      sizes[i] = size * (0.5 + Math.random() * 0.5);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: false,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    this.layers.push({
      points,
      speed,
      basePositions: new Float32Array(positions),
      baseMaterial: material,
    });
  }

  /**
   * Create a large sphere of stars for the FPV environment.
   * Stars are distributed uniformly on a sphere surface, visible from inside.
   * Hidden by default (visible=false) so zero GPU cost during normal gameplay.
   */
  private createFpvSphere() {
    const count = 2500;
    const radius = 400;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Uniform distribution on sphere surface (Marsaglia method)
      let x: number, y: number, z: number;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
      } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.01);
      const len = Math.sqrt(x * x + y * y + z * z);
      positions[i3] = (x / len) * radius;
      positions[i3 + 1] = (y / len) * radius;
      positions[i3 + 2] = (z / len) * radius;

      // Star colors — mix of blue-white, warm white, and occasional gold
      const brightness = 0.5 + Math.random() * 0.5;
      const warmTint = Math.random() < 0.12 ? 0.2 : 0;
      const coolTint = Math.random() < 0.15 ? 0.1 : 0;
      colors[i3] = Math.min(1, (0.7 + warmTint) * brightness);
      colors[i3 + 1] = Math.min(1, (0.72 + coolTint * 0.5) * brightness);
      colors[i3 + 2] = Math.min(1, (0.85 + coolTint) * brightness);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    this.fpvSphereMaterial = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
      depthWrite: false,
    });

    this.fpvSphere = new THREE.Points(geometry, this.fpvSphereMaterial);
    this.fpvSphere.visible = false; // zero GPU cost
    this.scene.add(this.fpvSphere);
  }

  /**
   * Set the FPV transition value (0 = normal top-down, 1 = fully FPV).
   * Crossfades between flat starfield and surrounding star sphere.
   */
  setFpvTransition(t: number) {
    // Flat starfield: fade out during FPV
    const flatOpacity = 0.8 * (1 - t);
    for (const layer of this.layers) {
      layer.baseMaterial.opacity = flatOpacity;
    }

    // FPV sphere: fade in during FPV
    if (this.fpvSphere && this.fpvSphereMaterial) {
      if (t > 0.01) {
        this.fpvSphere.visible = true;
        this.fpvSphereMaterial.opacity = t * 0.9;
      } else {
        this.fpvSphere.visible = false;
        this.fpvSphereMaterial.opacity = 0;
      }
    }
  }

  /** Update star positions for parallax based on camera position */
  update(cameraX: number, cameraY: number, cameraZ = 100) {
    const spread = 600;
    const halfSpread = spread / 2;

    for (const layer of this.layers) {
      const positions = layer.points.geometry.attributes[
        "position"
      ] as THREE.BufferAttribute;
      const array = positions.array as Float32Array;

      for (let i = 0; i < array.length; i += 3) {
        // Offset star by parallax amount
        let x =
          (layer.basePositions[i]! - cameraX * layer.speed) % halfSpread;
        let y =
          (layer.basePositions[i + 1]! - cameraY * layer.speed) % halfSpread;

        // Wrap around to keep stars visible
        if (x < -halfSpread) x += spread;
        if (x > halfSpread) x -= spread;
        if (y < -halfSpread) y += spread;
        if (y > halfSpread) y -= spread;

        array[i] = x + cameraX;
        array[i + 1] = y + cameraY;
      }

      positions.needsUpdate = true;
    }

    // FPV sphere follows camera position
    if (this.fpvSphere && this.fpvSphere.visible) {
      this.fpvSphere.position.set(cameraX, cameraY, cameraZ);
    }
  }

  dispose() {
    for (const layer of this.layers) {
      layer.points.geometry.dispose();
      (layer.points.material as THREE.Material).dispose();
      this.scene.remove(layer.points);
    }
    if (this.fpvSphere) {
      this.fpvSphere.geometry.dispose();
      this.fpvSphereMaterial?.dispose();
      this.scene.remove(this.fpvSphere);
    }
  }
}
