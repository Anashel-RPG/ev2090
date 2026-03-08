/**
 * Planet visualization for the trade map.
 * Game-quality textured spheres with Fresnel atmospheres, heatmap rings,
 * disruption pulses, and dimming support.
 */
import * as THREE from "three";
import type { AdminPlanetMarketState, AdminDisruptionView } from "../types";
import { generatePlanetTexture } from "./PlanetTextureGen";

// ── Dim state (driven by renderer hover logic) ──

export type DimState =
  | { active: false }
  | { active: true; type: "planet"; planetId: string }
  | { active: true; type: "route"; routeId: string; connectedPlanets: Set<string> };

// ── Planet configs ──

const PLANET_POSITIONS: Record<string, [number, number]> = {
  nexara: [25 * 0.4, 15 * 0.4],
  velkar: [-55 * 0.4, -40 * 0.4],
  zephyra: [95 * 0.4, -65 * 0.4],
  arctis: [40 * 0.4, 32 * 0.4],
};

const PLANET_RADII: Record<string, number> = {
  nexara: 2.0,
  velkar: 1.3,
  zephyra: 3.0,
  arctis: 0.7,
};

const PLANET_TEXTURES: Record<string, "mars" | "neptune" | "luna" | "terran"> = {
  nexara: "terran",
  velkar: "mars",
  zephyra: "neptune",
  arctis: "luna",
};

const PLANET_ATMOS_COLORS: Record<string, number> = {
  nexara: 0x3399bb,
  velkar: 0xff6633,
  zephyra: 0x44aaff,
  arctis: 0x666666,
};

const PLANET_ROTATION_SPEEDS: Record<string, number> = {
  nexara: 0.04,
  velkar: 0.03,
  zephyra: 0.015,
  arctis: 0.02,
};

// ── Atmosphere shaders (from game's Planet.ts) ──

const ATMOS_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}`;

const ATMOS_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  float fresnel = 1.0 - dot(vNormal, vViewDir);
  fresnel = pow(fresnel, 3.0);
  float alpha = fresnel * uIntensity;
  gl_FragColor = vec4(uColor, alpha);
}`;

export interface PlanetMeshData {
  planetId: string;
  group: THREE.Group;
  sphere: THREE.Mesh;
  atmosphere: THREE.Mesh;
  heatRing: THREE.Mesh;
  disruptionRing: THREE.Mesh;
  label: THREE.Sprite;
  pointLight: THREE.PointLight;
  texture: THREE.CanvasTexture;
  position: [number, number];
  radius: number;
  rotationSpeed: number;
  // Default opacities for dimming restore
  defaultSphereOpacity: number;
  defaultLabelOpacity: number;
  defaultLightIntensity: number;
  defaultAtmosIntensity: number;
  // Disruption base opacity (set by updateDisruptions)
  disruptionBaseOpacity: number;
}

export class TradeMapPlanets {
  planets: Map<string, PlanetMeshData> = new Map();
  private scene: THREE.Scene;
  private globalDimFactor = 1.0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  build(
    marketStates: AdminPlanetMarketState[],
    disruptions: AdminDisruptionView[],
  ): void {
    this.dispose();

    for (const planet of marketStates) {
      const id = planet.planetId;
      const pos = PLANET_POSITIONS[id] ?? [0, 0];
      const radius = PLANET_RADII[id] ?? 1;
      const textureType = PLANET_TEXTURES[id] ?? "luna";
      const atmosColor = PLANET_ATMOS_COLORS[id] ?? 0x666666;
      const rotSpeed = PLANET_ROTATION_SPEEDS[id] ?? 0.02;

      const group = new THREE.Group();
      group.position.set(pos[0], 0, pos[1]);
      group.userData = { type: "planet", planetId: id };

      // ── Textured sphere (game-quality) ──
      const canvasTex = generatePlanetTexture(textureType);
      const texture = new THREE.CanvasTexture(canvasTex);
      texture.colorSpace = THREE.SRGBColorSpace;

      const sphereGeo = new THREE.SphereGeometry(radius, 64, 48);
      const sphereMat = new THREE.MeshStandardMaterial({
        map: texture,
        metalness: 0.1,
        roughness: 0.8,
        transparent: true,
        opacity: 1.0,
      });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.rotation.x = Math.PI / 2 + 0.3;
      sphere.userData = { type: "planet", planetId: id };
      group.add(sphere);

      // ── Fresnel atmosphere ──
      const atmosGeo = new THREE.SphereGeometry(radius * 1.12, 64, 48);
      const atmosMat = new THREE.ShaderMaterial({
        vertexShader: ATMOS_VERTEX,
        fragmentShader: ATMOS_FRAGMENT,
        uniforms: {
          uColor: { value: new THREE.Color(atmosColor) },
          uIntensity: { value: 1.2 },
        },
        transparent: true,
        side: THREE.FrontSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const atmosphere = new THREE.Mesh(atmosGeo, atmosMat);
      group.add(atmosphere);

      // ── Fill ratio heatmap ring ──
      const avgFill = this.getAvgFill(planet);
      const heatColor = this.fillToColor(avgFill);
      const ringGeo = new THREE.RingGeometry(radius * 1.2, radius * 1.35, 48);
      const ringMat = new THREE.MeshBasicMaterial({
        color: heatColor,
        transparent: true,
        opacity: avgFill < 0.15 || avgFill > 0.9 ? 0.6 : 0.15,
        side: THREE.DoubleSide,
      });
      const heatRing = new THREE.Mesh(ringGeo, ringMat);
      heatRing.rotation.x = -Math.PI / 2;
      heatRing.position.y = 0.05;
      group.add(heatRing);

      // ── Disruption pulse ring (same radius as heat ring, overlays it) ──
      const dRingGeo = new THREE.RingGeometry(radius * 1.2, radius * 1.35, 48);
      const dRingMat = new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      });
      const disruptionRing = new THREE.Mesh(dRingGeo, dRingMat);
      disruptionRing.rotation.x = -Math.PI / 2;
      disruptionRing.position.y = 0.06; // Slightly above heat ring
      group.add(disruptionRing);

      // ── Text label ──
      const label = this.createLabel(planet.name.toUpperCase(), atmosColor);
      label.position.set(0, radius + 1.2, 0);
      group.add(label);

      // ── Point light (game-style: atmosphere color) ──
      const pointLight = new THREE.PointLight(atmosColor, 0.5, radius * 8);
      pointLight.position.set(0, 1, 0);
      group.add(pointLight);

      this.scene.add(group);
      this.planets.set(id, {
        planetId: id,
        group,
        sphere,
        atmosphere,
        heatRing,
        disruptionRing,
        label,
        pointLight,
        texture,
        position: pos,
        radius,
        rotationSpeed: rotSpeed,
        defaultSphereOpacity: 1.0,
        defaultLabelOpacity: 0.85,
        defaultLightIntensity: 0.5,
        defaultAtmosIntensity: 1.2,
        disruptionBaseOpacity: 0,
      });
    }

    this.updateDisruptions(disruptions);
  }

  updateDisruptions(disruptions: AdminDisruptionView[]): void {
    // Reset all disruption rings and restore heatmap visibility
    for (const [, data] of this.planets) {
      (data.disruptionRing.material as THREE.MeshBasicMaterial).opacity = 0;
      data.disruptionBaseOpacity = 0;
      data.heatRing.visible = true;
    }
    for (const d of disruptions) {
      const data = this.planets.get(d.planetId);
      if (!data) continue;
      const mat = data.disruptionRing.material as THREE.MeshBasicMaterial;
      if (d.type === "production_halt") {
        mat.color.setHex(0xff4444);
        mat.opacity = 0.7;
        data.disruptionBaseOpacity = 0.7;
      } else if (d.type === "demand_surge") {
        mat.color.setHex(0xffaa00);
        mat.opacity = 0.5;
        data.disruptionBaseOpacity = 0.5;
      } else if (d.type === "production_boost") {
        mat.color.setHex(0x00ff88);
        mat.opacity = 0.5;
        data.disruptionBaseOpacity = 0.5;
      }
      // Hide heatmap ring when disruption is active (same slot)
      data.heatRing.visible = false;
    }
  }

  updateFills(marketStates: AdminPlanetMarketState[]): void {
    for (const planet of marketStates) {
      const data = this.planets.get(planet.planetId);
      if (!data) continue;
      const avgFill = this.getAvgFill(planet);
      const heatColor = this.fillToColor(avgFill);
      const mat = data.heatRing.material as THREE.MeshBasicMaterial;
      mat.color.setHex(heatColor);
      mat.opacity = avgFill < 0.15 || avgFill > 0.9 ? 0.6 : 0.15;
    }
  }

  animate(time: number, dt: number): void {
    for (const [, data] of this.planets) {
      // Disruption pulse
      const dMat = data.disruptionRing.material as THREE.MeshBasicMaterial;
      if (data.disruptionBaseOpacity > 0) {
        const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 3));
        dMat.opacity = data.disruptionBaseOpacity * pulse;
      }
      // Textured sphere rotation
      data.sphere.rotation.z += data.rotationSpeed * dt;
    }
  }

  /**
   * Dim/undim planets based on hover state.
   */
  setDimState(state: DimState): void {
    for (const [id, data] of this.planets) {
      const sphereMat = data.sphere.material as THREE.MeshStandardMaterial;
      const labelMat = data.label.material as THREE.SpriteMaterial;
      const atmosMat = data.atmosphere.material as THREE.ShaderMaterial;

      let factor = 1.0;
      if (state.active) {
        if (state.type === "planet") {
          factor = id === state.planetId ? 1.0 : 0.2;
        } else {
          // Route hovered: connected planets full, others dim
          factor = state.connectedPlanets.has(id) ? 1.0 : 0.25;
        }
      }

      // Apply global dim on top
      factor *= this.globalDimFactor;

      sphereMat.opacity = data.defaultSphereOpacity * factor;
      labelMat.opacity = data.defaultLabelOpacity * factor;
      data.pointLight.intensity = data.defaultLightIntensity * factor;
      atmosMat.uniforms.uIntensity!.value = data.defaultAtmosIntensity * factor;
    }
  }

  /**
   * Global dim for dead-route mode.
   */
  setGlobalDim(factor: number): void {
    this.globalDimFactor = factor;
    // Apply immediately with no hover state
    this.setDimState({ active: false });
  }

  getClickTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const [, data] of this.planets) {
      targets.push(data.sphere);
    }
    return targets;
  }

  getPosition(planetId: string): THREE.Vector3 | null {
    const data = this.planets.get(planetId);
    if (!data) return null;
    return new THREE.Vector3(data.position[0], 0, data.position[1]);
  }

  dispose(): void {
    for (const [, data] of this.planets) {
      this.scene.remove(data.group);
      data.sphere.geometry.dispose();
      (data.sphere.material as THREE.Material).dispose();
      data.texture.dispose();
      data.atmosphere.geometry.dispose();
      (data.atmosphere.material as THREE.Material).dispose();
      data.heatRing.geometry.dispose();
      (data.heatRing.material as THREE.Material).dispose();
      data.disruptionRing.geometry.dispose();
      (data.disruptionRing.material as THREE.Material).dispose();
      (data.label.material as THREE.SpriteMaterial).map?.dispose();
      (data.label.material as THREE.Material).dispose();
    }
    this.planets.clear();
  }

  // ── Private helpers ──

  private getAvgFill(planet: AdminPlanetMarketState): number {
    if (planet.commodities.length === 0) return 0.5;
    const sum = planet.commodities.reduce((s, c) => s + c.fillRatio, 0);
    return sum / planet.commodities.length;
  }

  private fillToColor(fill: number): number {
    if (fill < 0.05) return 0xff2222;
    if (fill < 0.15) return 0xff4444;
    if (fill > 0.95) return 0x2266ff;
    if (fill > 0.9) return 0x4488ff;
    return 0x334466;
  }

  private createLabel(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 28px 'Share Tech Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = `#${color.toString(16).padStart(6, "0")}`;
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0.85,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(6, 1.5, 1);
    return sprite;
  }
}
