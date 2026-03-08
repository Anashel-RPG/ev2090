/**
 * ShipPreview — self-contained wireframe ship preview renderer.
 *
 * A standalone mini-renderer (separate scene, camera, WebGLRenderer) that
 * displays a rotating wireframe model on a <canvas> element.  It lives in
 * engine/ so React components stay free of Three.js imports, honouring the
 * architecture boundary.
 *
 * Used by:
 *   - IntroScreen (ship selection carousel)
 *   - ShipDiagnosticPanel (sidebar wireframe)
 *
 * Usage (from React via useEffect):
 *   const preview = new ShipPreview(canvas, shipId, { width: 210, height: 150 });
 *   return () => preview.dispose();
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getShipDef } from "./ShipCatalog";

export interface ShipPreviewOptions {
  width?: number;
  height?: number;
}

export class ShipPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private model: THREE.Group | null = null;
  private animId = 0;

  constructor(canvas: HTMLCanvasElement, shipId: string, opts?: ShipPreviewOptions) {
    const width = opts?.width ?? 280;
    const height = opts?.height ?? 220;

    // Guard against WebGL context limit — browser returns null when exhausted
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera();
      return;
    }
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    this.camera.position.set(5, 3, 5);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0x00ff88, 0.15));

    this.loadShip(shipId);
    this.animate();
  }

  private loadShip(shipId: string): void {
    const shipDef = getShipDef(shipId);
    if (!shipDef) return;

    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    const solidMat = new THREE.MeshBasicMaterial({
      color: 0x003322,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });

    const loader = new GLTFLoader();
    loader.load(shipDef.modelPath, (gltf) => {
      this.model = gltf.scene;
      this.model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = wireframeMat;
          const solidClone = new THREE.Mesh(child.geometry, solidMat);
          solidClone.position.copy(child.position);
          solidClone.rotation.copy(child.rotation);
          solidClone.scale.copy(child.scale);
          child.parent?.add(solidClone);
        }
      });

      const box = new THREE.Box3().setFromObject(this.model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetScale = 2.4 / maxDim;
      this.model.scale.setScalar(targetScale);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(targetScale);
      this.model.position.sub(center);
      this.model.position.y += 0.5;
      this.scene.add(this.model);
    });
  }

  private animate = (): void => {
    this.animId = requestAnimationFrame(this.animate);
    if (this.model) this.model.rotation.y += 0.008;
    this.renderer?.render(this.scene, this.camera);
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
    this.renderer?.dispose();
  }
}
