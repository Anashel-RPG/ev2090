import * as THREE from "three";
import { NpcShip } from "../entities/NpcShip";

/**
 * Debug scan beam visualization: a red ray from the player ship forward,
 * with a hit marker sphere and a yellow hit-radius circle around the target NPC.
 */
export class DebugBeam {
  private scene: THREE.Scene;

  private debugBeamVisible = false;
  private debugBeamLine: THREE.Line | null = null;
  private debugBeamGeom: THREE.BufferGeometry | null = null;
  private debugHitMarker: THREE.Mesh | null = null;
  private debugHitCircle: THREE.LineLoop | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setVisible(visible: boolean) {
    this.debugBeamVisible = visible;
    if (!visible) {
      this.removeVisuals();
    }
  }

  isVisible(): boolean {
    return this.debugBeamVisible;
  }

  /**
   * Update the debug beam each frame.
   * Takes player position, forward direction, and the NPC list to find the nearest hit.
   */
  update(
    playerX: number,
    playerY: number,
    fwdX: number,
    fwdY: number,
    npcs: readonly NpcShip[],
  ) {
    if (!this.debugBeamVisible) return;

    const px = playerX;
    const py = playerY;

    // Find nearest scanned NPC with a valid ray hit
    let nearestHit: { x: number; y: number; dist: number; npcX: number; npcY: number } | null = null;
    for (const npc of npcs) {
      if (npc.scanned && npc.scanHitPoint) {
        const ddx = npc.scanHitPoint.x - px;
        const ddy = npc.scanHitPoint.y - py;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (!nearestHit || d < nearestHit.dist) {
          nearestHit = { x: npc.scanHitPoint.x, y: npc.scanHitPoint.y, dist: d, npcX: npc.position.x, npcY: npc.position.y };
        }
      }
    }

    if (nearestHit) {
      this.updateBeamLine(px, py, fwdX, fwdY, nearestHit.x, nearestHit.y, true);
      this.updateHitCircle(nearestHit.npcX, nearestHit.npcY);
    } else {
      // No target — show beam extending forward from ship
      this.updateBeamLine(px, py, fwdX, fwdY, 0, 0, false);
      this.hideHitCircle();
    }
  }

  /** Update debug beam line — from player ship to hit point (or extended in scan direction) */
  private updateBeamLine(
    playerX: number,
    playerY: number,
    scanDirX: number,
    scanDirY: number,
    hitX: number,
    hitY: number,
    hasTarget: boolean,
  ) {
    // Beam line: from player ship to hit point (or extended in scan direction)
    const beamEndX = hasTarget ? hitX : playerX + scanDirX * 30;
    const beamEndY = hasTarget ? hitY : playerY + scanDirY * 30;
    const shipZ = 10.5; // slightly above ships to be visible

    if (!this.debugBeamLine) {
      // Create beam line
      this.debugBeamGeom = new THREE.BufferGeometry();
      const positions = new Float32Array(6); // 2 points x 3 coords
      this.debugBeamGeom.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      const beamMat = new THREE.LineBasicMaterial({
        color: 0xff4444,
        linewidth: 2,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
      });
      this.debugBeamLine = new THREE.Line(this.debugBeamGeom, beamMat);
      this.debugBeamLine.renderOrder = 999;
      this.scene.add(this.debugBeamLine);
    }

    // Update beam positions
    const posAttr = this.debugBeamGeom!.getAttribute("position") as THREE.BufferAttribute;
    posAttr.setXYZ(0, playerX, playerY, shipZ);
    posAttr.setXYZ(1, beamEndX, beamEndY, shipZ);
    posAttr.needsUpdate = true;

    // Hit marker: small sphere at the hit point
    if (hasTarget) {
      if (!this.debugHitMarker) {
        const markerGeom = new THREE.SphereGeometry(0.3, 8, 8);
        const markerMat = new THREE.MeshBasicMaterial({
          color: 0xff0000,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        });
        this.debugHitMarker = new THREE.Mesh(markerGeom, markerMat);
        this.debugHitMarker.renderOrder = 999;
        this.scene.add(this.debugHitMarker);
      }
      this.debugHitMarker.position.set(hitX, hitY, shipZ);
      this.debugHitMarker.visible = true;
    } else if (this.debugHitMarker) {
      this.debugHitMarker.visible = false;
    }
  }

  /** Show a yellow circle around the NPC indicating the hit detection radius */
  private updateHitCircle(npcX: number, npcY: number) {
    const shipZ = 10.5;
    const r = NpcShip.hitRadius;

    if (!this.debugHitCircle) {
      const segments = 64;
      const positions = new Float32Array(segments * 3);
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        positions[i * 3] = Math.cos(angle);
        positions[i * 3 + 1] = Math.sin(angle);
        positions[i * 3 + 2] = 0;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
      });
      this.debugHitCircle = new THREE.LineLoop(geom, mat);
      this.debugHitCircle.renderOrder = 999;
      this.scene.add(this.debugHitCircle);
    }

    this.debugHitCircle.position.set(npcX, npcY, shipZ);
    this.debugHitCircle.scale.set(r, r, 1);
    this.debugHitCircle.visible = true;
  }

  private hideHitCircle() {
    if (this.debugHitCircle) {
      this.debugHitCircle.visible = false;
    }
  }

  removeVisuals() {
    if (this.debugBeamLine) {
      this.scene.remove(this.debugBeamLine);
      this.debugBeamGeom?.dispose();
      this.debugBeamLine = null;
      this.debugBeamGeom = null;
    }
    if (this.debugHitMarker) {
      this.scene.remove(this.debugHitMarker);
      this.debugHitMarker.geometry.dispose();
      (this.debugHitMarker.material as THREE.Material).dispose();
      this.debugHitMarker = null;
    }
    if (this.debugHitCircle) {
      this.scene.remove(this.debugHitCircle);
      this.debugHitCircle.geometry.dispose();
      (this.debugHitCircle.material as THREE.Material).dispose();
      this.debugHitCircle = null;
    }
  }

  /**
   * Ray-circle intersection: find where a ray from (ox,oy) in direction (dx,dy)
   * first hits the circle at (cx,cy) with radius r.
   * Returns the intersection point, or null if no hit.
   */
  static rayCircleIntersect(
    ox: number, oy: number, dx: number, dy: number,
    cx: number, cy: number, r: number,
  ): { x: number; y: number } | null {
    // Vector from ray origin to circle center
    const fx = ox - cx;
    const fy = oy - cy;

    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;

    let discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null; // no intersection

    discriminant = Math.sqrt(discriminant);

    // We want the nearest positive t (closest hit in front of ray origin)
    const t1 = (-b - discriminant) / (2 * a);
    const t2 = (-b + discriminant) / (2 * a);

    const t = t1 > 0 ? t1 : t2 > 0 ? t2 : -1;
    if (t < 0) return null; // intersection is behind the ray

    return { x: ox + dx * t, y: oy + dy * t };
  }
}
