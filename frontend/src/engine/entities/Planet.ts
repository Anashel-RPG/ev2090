import * as THREE from "three";
import type { Vec2 } from "@/types/game";

/**
 * Planet entity with AI-generated texture mapped onto a 3D sphere.
 * Textures are generated via Gemini and stored as static assets.
 * Later: dynamic generation as players explore new systems.
 */

export interface PlanetConfig {
  name: string;
  position: Vec2;
  radius: number;
  texturePath?: string;
  canvasTexture?: HTMLCanvasElement; // procedurally generated texture
  color?: number; // fallback solid color if no texture
  rotationSpeed?: number; // radians/s
  atmosphereColor?: number; // hex color for atmosphere glow
}

/** Fresnel-based atmosphere shader — glows at edges, transparent at center */
const ATMOS_VERTEX = `
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

const ATMOS_FRAGMENT = `
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  float fresnel = 1.0 - dot(vNormal, vViewDir);
  fresnel = pow(fresnel, 3.0);
  float alpha = fresnel * uIntensity;
  gl_FragColor = vec4(uColor, alpha);
}
`;

export class Planet {
  mesh: THREE.Group;
  name: string;
  position: Vec2;
  radius: number;

  private sphere: THREE.Mesh | null = null;
  private atmosphere: THREE.Mesh | null = null;
  private rotationSpeed: number;

  constructor(config: PlanetConfig) {
    this.name = config.name;
    this.position = config.position;
    this.radius = config.radius;
    this.rotationSpeed = config.rotationSpeed ?? 0.05;

    this.mesh = new THREE.Group();
    this.mesh.position.set(config.position.x, config.position.y, 0);

    // Create sphere geometry
    const geometry = new THREE.SphereGeometry(config.radius, 64, 48);

    if (config.canvasTexture) {
      // Procedurally generated canvas texture
      const texture = new THREE.CanvasTexture(config.canvasTexture);
      texture.colorSpace = THREE.SRGBColorSpace;

      const material = new THREE.MeshStandardMaterial({
        map: texture,
        metalness: 0.1,
        roughness: 0.8,
      });

      this.sphere = new THREE.Mesh(geometry, material);
      this.sphere.rotation.x = Math.PI / 2 + 0.3;
      this.mesh.add(this.sphere);
    } else if (config.texturePath) {
      // Load texture from file
      const loader = new THREE.TextureLoader();
      loader.load(config.texturePath, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;

        const material = new THREE.MeshStandardMaterial({
          map: texture,
          metalness: 0.1,
          roughness: 0.8,
        });

        this.sphere = new THREE.Mesh(geometry, material);
        this.sphere.rotation.x = Math.PI / 2 + 0.3;
        this.mesh.add(this.sphere);
      });
    } else {
      // Solid color planet (no texture)
      const material = new THREE.MeshStandardMaterial({
        color: config.color ?? 0x888888,
        metalness: 0.15,
        roughness: 0.7,
      });
      this.sphere = new THREE.Mesh(geometry, material);
      this.sphere.rotation.x = Math.PI / 2 + 0.3;
      this.mesh.add(this.sphere);
    }

    // ─── Atmosphere: Fresnel glow sphere ───
    const atmosphereColor = config.atmosphereColor ?? 0x4488ff;
    const atmosGeo = new THREE.SphereGeometry(config.radius * 1.12, 64, 48);
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: ATMOS_VERTEX,
      fragmentShader: ATMOS_FRAGMENT,
      uniforms: {
        uColor: { value: new THREE.Color(atmosphereColor) },
        uIntensity: { value: 1.2 },
      },
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
    this.mesh.add(this.atmosphere);

    // Point light to simulate planet reflecting light onto nearby objects
    const glow = new THREE.PointLight(
      atmosphereColor,
      0.5,
      config.radius * 8,
    );
    glow.position.set(0, 0, 1);
    this.mesh.add(glow);
  }

  update(dt: number) {
    if (this.sphere) {
      this.sphere.rotation.z += this.rotationSpeed * dt;
    }
  }

  /** Distance from a point to this planet's center */
  distanceTo(point: Vec2): number {
    const dx = this.position.x - point.x;
    const dy = this.position.y - point.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  dispose() {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          if ("map" in child.material && child.material.map) {
            (child.material.map as THREE.Texture).dispose();
          }
          child.material.dispose();
        }
      }
    });
  }
}
