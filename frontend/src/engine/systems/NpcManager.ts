import * as THREE from "three";
import { NpcShip } from "../entities/NpcShip";
import { SoundManager } from "./SoundManager";
import { getShipDef } from "../ShipCatalog";
import type { Ship } from "../entities/Ship";
import type { Planet } from "../entities/Planet";
import type { RadarContact } from "@/types/game";

/**
 * Manages NPC traffic: spawning, updating, scanner cone detection,
 * and sound pings for newly scanned contacts.
 */

// Scanner cone constants (must match RadarPanel)
const RADAR_RANGE = 300;
const SCANNER_HALF_ANGLE = (30 * Math.PI) / 180; // 60° total -> 30° half

// Sound URLs
const SFX_PING = "https://cdn.ev2090.com/sound/ping.mp3";

export class NpcManager {
  private scene: THREE.Scene;

  // NPC traffic
  private npcs: NpcShip[] = [];
  private npcSpawnTimer = 0;
  private npcIdCounter = 0;

  /** Track which NPCs were scanned last frame to fire ping only on new detections */
  private prevScannedIds = new Set<string>();

  // Static config
  private static readonly NPC_SPAWN_INTERVAL = 6; // seconds
  private static readonly MAX_NPCS = 4;
  private static readonly NPC_SHIP_IDS = [
    "bob",
    "dispatcher",
    "pancake",
    "spitfire",
    "omen",
  ];
  private static readonly NPC_COLORS = [
    "Blue",
    "Green",
    "Orange",
    "Purple",
    "Red",
  ];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Get the current list of NPCs (read-only access for other systems) */
  getNpcs(): readonly NpcShip[] {
    return this.npcs;
  }

  /**
   * Main NPC update: scanner detection, hit-point computation, spawning/removal.
   * Returns the forward direction (fwdX, fwdY) and player position for debug beam.
   */
  update(
    dt: number,
    ship: Ship,
    planets: Planet[],
  ): { fwdX: number; fwdY: number; px: number; py: number } {
    // Scanner heading: negate ship rotation (same convention as RadarPanel)
    const heading = -ship.state.rotation;
    const nowScannedIds = new Set<string>();

    // Scanner beam direction = player ship heading (flashlight effect)
    // Forward direction: (-sin(rot), cos(rot)); negate for "facing the beam" in shader
    const rot = ship.state.rotation;
    const scanDirX = Math.sin(rot);    // = -(-sin(rot)) = negate of forward X
    const scanDirY = -Math.cos(rot);   // = -(cos(rot))  = negate of forward Y

    // Update existing NPCs + scanner cone detection
    for (const npc of this.npcs) {
      npc.update(dt);

      // Scanner cone detection (world space)
      const dx = npc.position.x - ship.position.x;
      const dy = npc.position.y - ship.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < RADAR_RANGE && dist > 2) {
        // Contact angle using same convention as RadarPanel: atan2(dx, dy)
        const contactAngle = Math.atan2(dx, dy);
        let diff = contactAngle - heading;
        // Normalize to [-PI, PI]
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;

        const inCone = Math.abs(diff) < SCANNER_HALF_ANGLE;
        npc.scanned = inCone;

        // Scan direction = ship heading (flashlight beam), same for all NPCs
        npc.scanDirection = { x: scanDirX, y: scanDirY };

        if (inCone) {
          nowScannedIds.add(npc.id);
          // Play ping only when a new NPC enters the cone
          if (!this.prevScannedIds.has(npc.id)) {
            SoundManager.playOnce(SFX_PING, 0.12, 600);
          }
        }
      } else {
        npc.scanned = false;
        // Still update beam direction for fading out
        npc.scanDirection = { x: scanDirX, y: scanDirY };
      }
    }

    this.prevScannedIds = nowScannedIds;

    // -- Beam ray: straight line in the ship's forward direction --
    // Forward direction = actual heading the ship is facing
    const fwdX = -Math.sin(rot);
    const fwdY = Math.cos(rot);
    const px = ship.position.x;
    const py = ship.position.y;
    const shipRadius = NpcShip.hitRadius; // configurable via Hit Width slider

    // Compute ray-circle intersection for each scanned NPC
    // and set the hit point on the NPC for the shield shader
    for (const npc of this.npcs) {
      if (npc.scanned) {
        const hitPt = NpcManager.rayCircleIntersect(
          px, py, fwdX, fwdY,
          npc.position.x, npc.position.y, shipRadius,
        );
        npc.scanHitPoint = hitPt;
      } else {
        // Clear hit point when not scanned (let fade use last value)
        npc.scanHitPoint = null;
      }
    }

    // Remove completed NPCs
    const done = this.npcs.filter((n) => n.done);
    for (const npc of done) {
      this.scene.remove(npc.mesh);
      npc.dispose();
    }
    this.npcs = this.npcs.filter((n) => !n.done);

    // Spawn new NPCs
    this.npcSpawnTimer += dt;
    if (
      this.npcSpawnTimer >= NpcManager.NPC_SPAWN_INTERVAL &&
      this.npcs.length < NpcManager.MAX_NPCS
    ) {
      this.spawnNpc(planets, ship);
      this.npcSpawnTimer = 0;
    }

    return { fwdX, fwdY, px, py };
  }

  spawnNpc(planets: Planet[], _ship?: Ship) {
    if (planets.length === 0) return;

    // Pick a random target planet for the NPC to dock at
    const targetIdx = Math.floor(Math.random() * planets.length);
    const target = planets[targetIdx]!;

    // Pick random ship model and color
    const shipId =
      NpcManager.NPC_SHIP_IDS[
        Math.floor(Math.random() * NpcManager.NPC_SHIP_IDS.length)
      ];
    if (!shipId) return;
    const shipDef = getShipDef(shipId);
    if (!shipDef) return;

    const color =
      NpcManager.NPC_COLORS[Math.floor(Math.random() * NpcManager.NPC_COLORS.length)];
    const texturePath = `/models/${shipId}/${shipDef.name}_${color ?? "Blue"}.png`;

    // Spawn from a random direction, well outside the camera view
    const angle = Math.random() * Math.PI * 2;
    const spawnDist = 120;
    const spawnPos = {
      x: target.position.x + Math.cos(angle) * spawnDist,
      y: target.position.y + Math.sin(angle) * spawnDist,
    };

    const npc = new NpcShip(
      `npc-${this.npcIdCounter++}`,
      shipDef.name,
      { position: target.position, radius: target.radius },
      spawnPos,
      shipDef.modelPath,
      texturePath,
    );

    this.npcs.push(npc);
    this.scene.add(npc.mesh);
  }

  /** Spawn a frozen NPC near the player for testing scan outline settings */
  spawnTestShip(ship: Ship) {
    const shipId = NpcManager.NPC_SHIP_IDS[Math.floor(Math.random() * NpcManager.NPC_SHIP_IDS.length)];
    if (!shipId) return;
    const shipDef = getShipDef(shipId);
    if (!shipDef) return;

    const color = NpcManager.NPC_COLORS[Math.floor(Math.random() * NpcManager.NPC_COLORS.length)];
    const texturePath = `/models/${shipId}/${shipDef.name}_${color ?? "Blue"}.png`;

    // Place 12 units ahead of the player ship (in the direction it's facing)
    const heading = ship.state.rotation;
    const dist = 12;
    const spawnPos = {
      x: ship.position.x - Math.sin(heading) * dist,
      y: ship.position.y + Math.cos(heading) * dist,
    };

    // Use Earth as a fake target far away so the NPC stays put
    const fakeTarget = { position: { x: 99999, y: 99999 }, radius: 1 };

    const npc = new NpcShip(
      `test-${this.npcIdCounter++}`,
      shipDef.name,
      fakeTarget,
      spawnPos,
      shipDef.modelPath,
      texturePath,
    );

    // Freeze it: set state to DOCKED with a very long timer
    // Access private state via any cast — debug only
    (npc as any).npcState = "DOCKED";
    (npc as any).dockDuration = 999999;
    (npc as any).dockTimer = 0;

    this.npcs.push(npc);
    this.scene.add(npc.mesh);
  }

  /** Spawn 4 test ships in a ring around the player: ahead, left, right, behind.
   * Lets you just rotate in place to test beam hitting from all angles. */
  spawnTestRing(ship: Ship) {
    const heading = ship.state.rotation;
    const dist = 12;
    // Forward, left, right, behind (relative to ship heading)
    const offsets = [0, Math.PI / 2, -Math.PI / 2, Math.PI];

    for (const offset of offsets) {
      const angle = heading + offset;
      const shipId = NpcManager.NPC_SHIP_IDS[Math.floor(Math.random() * NpcManager.NPC_SHIP_IDS.length)];
      if (!shipId) continue;
      const shipDef = getShipDef(shipId);
      if (!shipDef) continue;

      const color = NpcManager.NPC_COLORS[Math.floor(Math.random() * NpcManager.NPC_COLORS.length)];
      const texturePath = `/models/${shipId}/${shipDef.name}_${color ?? "Blue"}.png`;

      const spawnPos = {
        x: ship.position.x - Math.sin(angle) * dist,
        y: ship.position.y + Math.cos(angle) * dist,
      };

      const fakeTarget = { position: { x: 99999, y: 99999 }, radius: 1 };
      const npc = new NpcShip(
        `test-${this.npcIdCounter++}`,
        shipDef.name,
        fakeTarget,
        spawnPos,
        shipDef.modelPath,
        texturePath,
      );

      // Freeze it
      (npc as any).npcState = "DOCKED";
      (npc as any).dockDuration = 999999;
      (npc as any).dockTimer = 0;

      this.npcs.push(npc);
      this.scene.add(npc.mesh);
    }
  }

  /** Remove all test ships (IDs starting with "test-") */
  clearTestShips() {
    const testShips = this.npcs.filter((n) => n.id.startsWith("test-"));
    for (const npc of testShips) {
      this.scene.remove(npc.mesh);
      npc.dispose();
    }
    this.npcs = this.npcs.filter((n) => !n.id.startsWith("test-"));
  }

  /** Get radar contacts for the game state */
  getRadarContacts(): RadarContact[] {
    return this.npcs.map((npc) => ({
      id: npc.id,
      position: npc.position,
      type: "ship" as const,
      name: npc.name,
      hostile: false,
    }));
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

  /** Dispose all NPC resources */
  dispose() {
    for (const npc of this.npcs) {
      npc.dispose();
    }
    this.npcs = [];
  }
}
