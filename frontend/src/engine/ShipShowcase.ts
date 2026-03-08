/**
 * ShipShowcase — full-material rotating ship renderer for the station panel.
 *
 * Renders the player's ship with PBR materials and a hero-shot lighting rig,
 * spinning slowly at the game's default -22° tilt angle.
 * Background is fully transparent so it overlays the 3D hero shot.
 *
 * Usage (from a React component via useEffect):
 *   const showcase = new ShipShowcase(canvas, shipId);
 *   return () => showcase.dispose();
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getShipDef } from "./ShipCatalog";

export class ShipShowcase {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  /** Wrapper group that spins around world-Y */
  private spinGroup: THREE.Group;
  /** Child group that applies the -22° forward tilt */
  private tiltGroup: THREE.Group;
  private model: THREE.Group | null = null;
  private animId = 0;

  constructor(canvas: HTMLCanvasElement, shipId: string) {
    const w = canvas.offsetWidth || 400;
    const h = canvas.offsetHeight || 400;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;

    this.scene = new THREE.Scene();

    // Front-elevated view matching the game's hero-shot feel
    this.camera = new THREE.PerspectiveCamera(26, w / h, 0.1, 100);
    this.camera.position.set(1.5, 3, 7);
    this.camera.lookAt(0, 0, 0);

    // Lighting rig: warm key + cool fill + cyan rim
    this.scene.add(new THREE.AmbientLight(0xc8d8ff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 5, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x4488ff, 0.5);
    fill.position.set(-5, 1, 3);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0x00ccff, 0.45);
    rim.position.set(-2, -1, -5);
    this.scene.add(rim);

    // spinGroup spins around world-Y; tiltGroup applies -22° X tilt inside it.
    // This keeps the forward lean constant as the ship rotates.
    this.spinGroup = new THREE.Group();
    this.tiltGroup = new THREE.Group();
    this.tiltGroup.rotation.x = (-22 * Math.PI) / 180;
    this.spinGroup.add(this.tiltGroup);
    this.scene.add(this.spinGroup);

    this.loadShip(shipId);
    this.animate();
  }

  private loadShip(shipId: string): void {
    const shipDef = getShipDef(shipId);
    if (!shipDef) return;

    const loader = new GLTFLoader();
    loader.load(shipDef.modelPath, (gltf) => {
      this.model = gltf.scene;

      // Built-in ships: apply the Blue texture. Community ships have embedded PBR.
      if (shipDef.source !== "community" && shipDef.texturePath) {
        new THREE.TextureLoader().load(shipDef.texturePath, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          this.model?.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.material = new THREE.MeshStandardMaterial({
                map: tex,
                metalness: 0.5,
                roughness: 0.38,
              });
            }
          });
        });
      }

      // Normalize to a consistent display size
      const box = new THREE.Box3().setFromObject(this.model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetScale = 3.0 / maxDim;
      this.model.scale.setScalar(targetScale);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(targetScale);
      this.model.position.sub(center);

      this.tiltGroup.add(this.model);
    });
  }

  private animate = (): void => {
    this.animId = requestAnimationFrame(this.animate);
    this.spinGroup.rotation.y += 0.005;
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
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
