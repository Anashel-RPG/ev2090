/**
 * Trade route visualization: bezier curves, in-flight cargo ships.
 * No flow particles — cargo ships are hoverable with tooltips.
 */
import * as THREE from "three";
import type { NpcTradeRoute, CommodityDef, CommodityCategory } from "../types";
import type { DimState } from "./TradeMapPlanets";

const CATEGORY_COLORS: Record<CommodityCategory, number> = {
  minerals: 0xff8844,
  food: 0x66cc44,
  tech: 0x4488ff,
  industrial: 0xaaaacc,
  luxury: 0xffaa44,
};

const CURVE_SEGMENTS = 64;

export interface RouteMeshData {
  routeId: string;
  route: NpcTradeRoute;
  group: THREE.Group;
  curve: THREE.QuadraticBezierCurve3;
  line: THREE.Line;
  cargoMesh: THREE.Mesh | null;
  category: CommodityCategory;
  commodityName: string;
  defaultOpacity: number;
  defaultColor: number;
  isDead: boolean;
}

export class TradeMapRoutes {
  routes: Map<string, RouteMeshData> = new Map();
  private scene: THREE.Scene;
  private visibleCategories: Set<CommodityCategory> = new Set([
    "minerals",
    "food",
    "tech",
    "industrial",
    "luxury",
  ]);
  private deadRouteMode = false;
  private deadRouteIds: Set<string> = new Set();
  private sharedCargoGeo = new THREE.OctahedronGeometry(0.35);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  build(
    routes: NpcTradeRoute[],
    commodityDefs: CommodityDef[],
    planetPositions: Map<string, THREE.Vector3>,
  ): void {
    this.dispose();

    const comMap = new Map<string, CommodityDef>();
    for (const c of commodityDefs) comMap.set(c.id, c);

    const pairCounts = new Map<string, number>();

    for (const route of routes) {
      const srcPos = planetPositions.get(route.sourcePlanet);
      const dstPos = planetPositions.get(route.destPlanet);
      if (!srcPos || !dstPos) continue;

      const comDef = comMap.get(route.commodityId);
      const category: CommodityCategory = comDef?.category ?? "industrial";
      const color = CATEGORY_COLORS[category];

      const pairKey = [route.sourcePlanet, route.destPlanet].sort().join("-");
      const pairIdx = pairCounts.get(pairKey) ?? 0;
      pairCounts.set(pairKey, pairIdx + 1);

      // Bezier curve with perpendicular offset
      const midX = (srcPos.x + dstPos.x) / 2;
      const midZ = (srcPos.z + dstPos.z) / 2;
      const dx = dstPos.x - srcPos.x;
      const dz = dstPos.z - srcPos.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const perpX = -dz / len;
      const perpZ = dx / len;
      const offset = (pairIdx - 0.5) * 2.5;

      const control = new THREE.Vector3(
        midX + perpX * offset,
        1.5 + pairIdx * 0.3,
        midZ + perpZ * offset,
      );

      const curve = new THREE.QuadraticBezierCurve3(
        srcPos.clone().setY(0.3),
        control,
        dstPos.clone().setY(0.3),
      );

      const group = new THREE.Group();
      group.userData = { type: "route", routeId: route.id };

      // ── Line ──
      const points = curve.getPoints(CURVE_SEGMENTS);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const isDead =
        !route.inTransit &&
        (Date.now() - route.lastDeparture > 7_200_000 || route.lastDeparture === 0);
      const defaultOpacity = route.inTransit ? 0.7 : !route.enabled ? 0.08 : isDead ? 0.08 : 0.2;
      const lineMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: defaultOpacity,
        linewidth: 1,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.userData = { type: "route", routeId: route.id };
      group.add(line);

      // ── In-flight cargo ship ──
      let cargoMesh: THREE.Mesh | null = null;
      if (route.inTransit && route.lastDeparture > 0) {
        const progress =
          (Date.now() - route.lastDeparture) / route.tripDurationMs;
        if (progress > 0 && progress < 1) {
          const cargoMat = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.3,
            metalness: 0.4,
            roughness: 0.3,
            transparent: true,
            opacity: 0.9,
          });
          cargoMesh = new THREE.Mesh(this.sharedCargoGeo, cargoMat);
          cargoMesh.userData = {
            type: "cargo",
            routeId: route.id,
            commodityName: comDef?.name ?? route.commodityId,
            volume: route.volumePerTrip,
            source: route.sourcePlanet,
            dest: route.destPlanet,
            tripDurationMs: route.tripDurationMs,
            lastDeparture: route.lastDeparture,
          };
          const cargoPos = curve.getPoint(Math.min(progress, 1));
          cargoMesh.position.copy(cargoPos);
          cargoMesh.position.y += 0.3;
          group.add(cargoMesh);
        }
      }

      this.scene.add(group);
      this.routes.set(route.id, {
        routeId: route.id,
        route,
        group,
        curve,
        line,
        cargoMesh,
        category,
        commodityName: comDef?.name ?? route.commodityId,
        defaultOpacity,
        defaultColor: color,
        isDead,
      });
    }

    this.applyFilter();
    // Re-apply dead route mode if active
    if (this.deadRouteMode) {
      this.applyDeadRouteMode();
    }
  }

  setFilter(categories: Set<CommodityCategory>): void {
    this.visibleCategories = categories;
    this.applyFilter();
  }

  animate(dt: number): void {
    // Update cargo positions
    for (const [, data] of this.routes) {
      if (data.cargoMesh && data.route.lastDeparture > 0) {
        const progress =
          (Date.now() - data.route.lastDeparture) / data.route.tripDurationMs;
        if (progress > 0 && progress < 1) {
          const cargoPos = data.curve.getPoint(progress);
          data.cargoMesh.position.set(cargoPos.x, cargoPos.y + 0.3, cargoPos.z);
          data.cargoMesh.visible = true;
        } else {
          data.cargoMesh.visible = false;
        }
      }
    }
    void dt; // cargo uses wall clock
  }

  /**
   * Dim/undim routes based on hover state.
   */
  setDimState(state: DimState): void {
    if (this.deadRouteMode) return; // dead route mode overrides

    for (const [routeId, data] of this.routes) {
      const lineMat = data.line.material as THREE.LineBasicMaterial;

      let factor = 1.0;
      if (state.active) {
        if (state.type === "planet") {
          // Routes connected to hovered planet stay full, others dim
          const connected =
            data.route.sourcePlanet === state.planetId ||
            data.route.destPlanet === state.planetId;
          factor = connected ? 1.0 : 0.15;
        } else {
          // The hovered route stays full, others dim
          factor = routeId === state.routeId ? 1.0 : 0.15;
        }
      }

      lineMat.opacity = data.defaultOpacity * factor;
      lineMat.color.setHex(data.defaultColor);

      if (data.cargoMesh) {
        const cargoMat = data.cargoMesh.material as THREE.MeshStandardMaterial;
        cargoMat.opacity = 0.9 * factor;
      }
    }
  }

  /**
   * Toggle dead-route highlight mode.
   */
  setDeadRouteMode(enabled: boolean, deadRouteIds: Set<string>): void {
    this.deadRouteMode = enabled;
    this.deadRouteIds = deadRouteIds;

    if (enabled) {
      this.applyDeadRouteMode();
    } else {
      // Restore defaults
      for (const [, data] of this.routes) {
        const lineMat = data.line.material as THREE.LineBasicMaterial;
        lineMat.opacity = data.defaultOpacity;
        lineMat.color.setHex(data.defaultColor);
      }
    }
  }

  getClickTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const [, data] of this.routes) {
      if (data.group.visible) {
        targets.push(data.line);
        if (data.cargoMesh) targets.push(data.cargoMesh);
      }
    }
    return targets;
  }

  /**
   * Get only cargo meshes for hover raycasting (higher priority than lines).
   */
  getCargoTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    for (const [, data] of this.routes) {
      if (data.group.visible && data.cargoMesh?.visible) {
        targets.push(data.cargoMesh);
      }
    }
    return targets;
  }

  /**
   * Get source/dest planet IDs for a route (for dim state).
   */
  getRouteEndpoints(routeId: string): [string, string] | null {
    const data = this.routes.get(routeId);
    if (!data) return null;
    return [data.route.sourcePlanet, data.route.destPlanet];
  }

  dispose(): void {
    for (const [, data] of this.routes) {
      this.scene.remove(data.group);
      data.line.geometry.dispose();
      (data.line.material as THREE.Material).dispose();
      if (data.cargoMesh) {
        // Don't dispose shared geometry
        (data.cargoMesh.material as THREE.Material).dispose();
      }
    }
    this.routes.clear();
  }

  private applyFilter(): void {
    for (const [routeId, data] of this.routes) {
      // In dead route mode, dead routes are always visible
      if (this.deadRouteMode && this.deadRouteIds.has(routeId)) {
        data.group.visible = true;
      } else {
        data.group.visible = this.visibleCategories.has(data.category);
      }
    }
  }

  private applyDeadRouteMode(): void {
    for (const [routeId, data] of this.routes) {
      const lineMat = data.line.material as THREE.LineBasicMaterial;
      if (this.deadRouteIds.has(routeId)) {
        lineMat.opacity = 1.0;
        lineMat.color.setHex(0xff4444);
        data.group.visible = true; // Force visible even if filtered
      } else {
        lineMat.opacity = 0.06;
        lineMat.color.setHex(data.defaultColor);
      }
    }
  }
}
