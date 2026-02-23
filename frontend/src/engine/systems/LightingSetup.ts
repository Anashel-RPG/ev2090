import * as THREE from "three";
import type { Ship } from "../entities/Ship";
import { NpcShip } from "../entities/NpcShip";
import type { NebulaBg } from "./NebulaBg";
import type { LightConfig } from "@/types/game";

/**
 * Manages scene lighting: ambient, hemisphere, key, fill, and rim lights.
 * Also delegates special updateLight cases for ship tilt, model rotation,
 * background opacity, and NPC shield config.
 */
export class LightingSetup {
  private ambientLight: THREE.AmbientLight;
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;

  private ship: Ship | null = null;
  private nebulaBg: NebulaBg | null = null;

  // Live model rotation debug state (radians, matching default in Ship.ts)
  private shipModelRx = Math.PI / 2;
  private shipModelRy = Math.PI;
  private shipModelRz = 0;

  constructor(scene: THREE.Scene) {
    this.ambientLight = new THREE.AmbientLight(0x334455, 0.35);
    scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0xccddff, 0x112233, 0.25);
    this.hemiLight.position.set(0, 0, 1);
    scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xffeedd, 4.9);
    this.keyLight.position.set(71, 60, 66);
    scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0x556677, 0);
    this.fillLight.position.set(-5, -20, 60);
    scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0x6688cc, 2.5);
    this.rimLight.position.set(27, 21, 0);
    scene.add(this.rimLight);
  }

  setShip(ship: Ship) {
    this.ship = ship;
  }

  setNebulaBg(nebulaBg: NebulaBg) {
    this.nebulaBg = nebulaBg;
  }

  /** Get current light configuration for debug panel */
  getLightConfig(): LightConfig {
    return {
      ambient: { intensity: this.ambientLight.intensity },
      hemisphere: { intensity: this.hemiLight.intensity },
      keyLight: {
        intensity: this.keyLight.intensity,
        x: this.keyLight.position.x,
        y: this.keyLight.position.y,
        z: this.keyLight.position.z,
      },
      fillLight: {
        intensity: this.fillLight.intensity,
        x: this.fillLight.position.x,
        y: this.fillLight.position.y,
        z: this.fillLight.position.z,
      },
      rimLight: {
        intensity: this.rimLight.intensity,
        x: this.rimLight.position.x,
        y: this.rimLight.position.y,
        z: this.rimLight.position.z,
      },
      material: { metalness: 0.4, roughness: 0.2, emissiveIntensity: 0.15 },
    };
  }

  /** Update a single light property in real time */
  updateLight(lightName: string, property: string, value: number) {
    // Special: ship tilt (rotation.x on the ship mesh group, stored as radians)
    if (lightName === "shipTilt") {
      this.ship?.setTilt(value);
      return;
    }

    // Model rotation — live-tune the GLTF orientation
    if (lightName === "modelRotation") {
      if (property === "rx") this.shipModelRx = value;
      else if (property === "ry") this.shipModelRy = value;
      else if (property === "rz") this.shipModelRz = value;
      this.ship?.setModelRotation(this.shipModelRx, this.shipModelRy, this.shipModelRz);
      return;
    }

    // Background layer opacities
    if (lightName === "background") {
      if (property === "imageOpacity") this.nebulaBg?.setImageOpacity(value);
      if (property === "nebulaOpacity") this.nebulaBg?.setNebulaOpacity(value);
      return;
    }

    // Shield config (shared across all NPC ships)
    if (lightName === "scanOutline") {
      if (property === "shieldScale") NpcShip.shieldScale = value;
      if (property === "fresnelPow") NpcShip.fresnelPow = value;
      if (property === "dissipation") NpcShip.dissipation = value;
      if (property === "ovalX") NpcShip.ovalX = value;
      if (property === "ovalY") NpcShip.ovalY = value;
      if (property === "baseOpacity") NpcShip.baseOpacity = value;
      if (property === "hitOpacity") NpcShip.hitOpacity = value;
      if (property === "hitRadius") NpcShip.hitRadius = value;
      if (property === "colorR") NpcShip.colorR = value;
      if (property === "colorG") NpcShip.colorG = value;
      if (property === "colorB") NpcShip.colorB = value;
      return;
    }

    let light: THREE.Light | null = null;

    if (lightName === "ambient") light = this.ambientLight;
    else if (lightName === "hemisphere") light = this.hemiLight;
    else if (lightName === "keyLight") light = this.keyLight;
    else if (lightName === "fillLight") light = this.fillLight;
    else if (lightName === "rimLight") light = this.rimLight;

    if (!light) return;

    if (property === "intensity") {
      light.intensity = value;
    } else if (property === "x" || property === "y" || property === "z") {
      light.position[property] = value;
    }
  }

  /** Update ship material properties in real time */
  updateShipMaterial(property: string, value: number) {
    this.ship?.updateMaterial(property, value);
  }
}
