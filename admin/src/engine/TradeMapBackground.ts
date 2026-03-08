/**
 * Minimal starfield + grid background for the trade map.
 * Holographic war-room aesthetic.
 */
import * as THREE from "three";

export class TradeMapBackground {
  private stars: THREE.Points;
  private grid: THREE.GridHelper;

  constructor(scene: THREE.Scene) {
    // ── Starfield: 400 faint points ──
    const count = 400;
    const spread = 200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = -2 + Math.random() * -8; // below planet plane
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x667799,
      size: 0.3,
      transparent: true,
      opacity: 0.25,
      sizeAttenuation: true,
    });
    this.stars = new THREE.Points(geo, mat);
    scene.add(this.stars);

    // ── Grid plane: faint holographic table lines ──
    this.grid = new THREE.GridHelper(120, 40, 0x1a1a3e, 0x0c0c22);
    this.grid.position.y = -0.1;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.3;
    scene.add(this.grid);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.stars);
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    scene.remove(this.grid);
    (this.grid.material as THREE.Material).dispose();
  }
}
