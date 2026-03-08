import * as THREE from "three";
import { NpcShip } from "../entities/NpcShip";
import { getShipDef, getShipTexturePath } from "../ShipCatalog";
import type { Ship } from "../entities/Ship";
import type { Planet } from "../entities/Planet";
import type {
  MissionDef,
  MissionPhaseDef,
  MissionDialogueLine,
  QuestCommsState,
  QuestDialogueLine,
  RadarContact,
  Vec2,
} from "@/types/game";

/**
 * MissionEngine — JSON-driven mission interpreter.
 *
 * Reads a MissionDef and runs it through a generic phase machine:
 *   - Evaluates exit conditions each frame (timer, proximity, action, animation-complete)
 *   - Queues dialogue with timing
 *   - Spawns / manages NPC
 *   - Runs named animation scripts (rescue-sequence, fade-out-npc)
 *   - Exposes the same getCommsState() API as the old QuestManager
 *
 * Pattern: constructor(scene) + loadMission(def) + start() + update(dt, ship, planets)
 */

// ─── Angle Helpers ───

function angleDelta(from: number, to: number): number {
  return ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * Math.min(t, 1);
}

// ─── Rescue Animation Constants ───

const RESCUE_APPROACH_SPEED = 5;
const RESCUE_APPROACH_STOP_DIST = 3;
const RESCUE_DEPART_ACCEL = 1.5;
const RESCUE_DEPART_MAX_SPEED = 8;
const RESCUE_WATCH_DIST = 15;
const RESCUE_DEPART_BRAKE_RANGE = 5;

type RescueStep = "APPROACH_CONTACT" | "TRANSFER" | "DEPART_CURVE" | "WATCH";

const SIGNAL_DETECT_RANGE = 120;
const WEAK_THRESHOLD = 0.3;

export class MissionEngine {
  private scene: THREE.Scene;
  private mission: MissionDef | null = null;
  private phaseIndex = -1;
  private phase: MissionPhaseDef | null = null;
  private phaseTimer = 0;
  private started = false;
  private finished = false;

  // NPC
  private npc: NpcShip | null = null;
  private npcSpawned = false;

  // Transcript + message queue
  private transcript: QuestDialogueLine[] = [];
  private messageQueue: Array<{ line: MissionDialogueLine; fireAt: number }> = [];
  private queueClock = 0;
  private msgIdCounter = 0;

  // Timed messages (pre-spawn phase messages)
  private timedMessagesSent = new Set<number>();

  // Incoming transmission flag
  private hasIncoming = false;
  private maydayTriggered = false;

  // Distance tracking
  private lastDistance = Infinity;

  // Rescue animation state
  private rescueStep: RescueStep = "APPROACH_CONTACT";
  private rescueTimer = 0;
  private nearestPlanetPos: Vec2 | null = null;
  private rescueDepartSpeed = 0;
  private animationComplete = false;

  // Fade animation state
  private fadeTimer = 0;

  // Complete linger
  private completeTimer = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Load a mission definition. Call before start(). */
  loadMission(def: MissionDef) {
    this.mission = def;

    // Check localStorage for completion
    try {
      if (localStorage.getItem(def.storageKey) === "complete") {
        this.finished = true;
      }
    } catch { /* storage unavailable */ }
  }

  /** Start the mission (called when intro screen is dismissed). */
  start() {
    this.started = true;
    if (!this.finished && this.mission && this.phaseIndex === -1) {
      this.enterPhase(0);
    }
  }

  /** Main update — call every frame. */
  update(dt: number, ship: Ship, planets: Planet[]) {
    if (!this.mission || !this.started || this.finished) return;
    if (!this.phase) return;

    this.phaseTimer += dt;

    // Process dialogue queue → transcript
    this.queueClock += dt;
    while (this.messageQueue.length > 0 && this.messageQueue[0]!.fireAt <= this.queueClock) {
      const entry = this.messageQueue.shift()!;
      this.transcript.push({
        id: `quest-${this.msgIdCounter++}`,
        sender: entry.line.sender,
        text: entry.line.text,
        type: entry.line.type,
        timestamp: Date.now(),
      });
    }

    // Process timed messages (fire-and-forget at absolute times within phase)
    if (this.phase.timedMessages) {
      for (let i = 0; i < this.phase.timedMessages.length; i++) {
        if (!this.timedMessagesSent.has(i) && this.phaseTimer >= this.phase.timedMessages[i]!.at) {
          this.timedMessagesSent.add(i);
          const msg = this.phase.timedMessages[i]!;
          this.transcript.push({
            id: `quest-${this.msgIdCounter++}`,
            sender: msg.sender,
            text: msg.text,
            type: msg.type,
            timestamp: Date.now(),
          });
        }
      }
    }

    // Spawn NPC at specified time within phase
    if (this.phase.spawnNpcAt != null && !this.npcSpawned && this.phaseTimer >= this.phase.spawnNpcAt) {
      this.spawnNpc(planets);
    }

    // Update NPC
    if (this.npc) {
      this.npc.update(dt);
      this.lastDistance = this.distanceToNpc(ship);
    }

    // Run animations
    if (this.phase.animation === "rescue-sequence") {
      this.updateRescueAnimation(dt, ship, planets);
    }
    if (this.phase.npcFadeOut) {
      this.updateFadeOut(dt, ship);
    }

    // Evaluate exit condition
    this.evaluateExit(ship);
  }

  // ─── Public API (drop-in for QuestManager) ───

  getCommsState(): QuestCommsState | null {
    if (!this.started || !this.mission) return null;
    if (!this.phase && !this.finished) return null;

    // Before any meaningful phase
    if (this.phaseIndex === 0 && this.phaseTimer < 0.1 && this.transcript.length === 0) return null;

    if (this.finished) {
      this.completeTimer += 1 / 60;
      const completePhase = this.mission.phases[this.mission.phases.length - 1];
      const linger = completePhase?.lingerDuration ?? 10;
      if (this.completeTimer > linger) return null;
      return {
        phase: "COMPLETE",
        hasIncomingTransmission: false,
        signalStrength: 0,
        distanceToTarget: Infinity,
        transcript: this.transcript.slice(),
        signalWeak: false,
        targetName: this.mission.npc.name,
        objective: completePhase?.objective ?? "",
        rescuable: false,
        controlsLocked: false,
      };
    }

    if (!this.phase) return null;

    const strength = this.computeSignalStrength(this.lastDistance);
    const phaseId = this.phase.id as QuestCommsState["phase"];

    return {
      phase: phaseId,
      hasIncomingTransmission: this.hasIncoming,
      signalStrength: strength,
      distanceToTarget: this.lastDistance,
      transcript: this.transcript.slice(),
      signalWeak: strength < WEAK_THRESHOLD && this.phase.id !== "IDLE",
      targetName: this.mission.npc.name,
      objective: this.phase.objective,
      rescuable: this.phase.rescuable ?? false,
      controlsLocked: this.phase.lockControls ?? false,
    };
  }

  /** Player clicked the rescue CTA. */
  triggerRescue() {
    if (!this.phase || !this.phase.rescuable) return;
    if (this.phase.exit.trigger !== "action" || this.phase.exit.action !== "rescue") return;
    this.advancePhase();
    // Initialize rescue animation state
    this.rescueStep = "APPROACH_CONTACT";
    this.rescueTimer = 0;
    this.rescueDepartSpeed = 0;
    this.nearestPlanetPos = null;
    this.animationComplete = false;
    // Freeze NPC
    if (this.npc) {
      (this.npc as any).npcState = "DOCKED";
    }
  }

  getNpcPosition(): { x: number; y: number } | null {
    if (!this.npc) return null;
    return { x: this.npc.position.x, y: this.npc.position.y };
  }

  isRescuable(): boolean {
    return this.phase?.rescuable ?? false;
  }

  isControlsLocked(): boolean {
    return this.phase?.lockControls ?? false;
  }

  getRadarContact(): RadarContact | null {
    if (!this.npc || !this.mission) return null;
    if (!this.phase || this.phase.id === "IDLE" || this.finished) return null;
    return {
      id: this.npc.id,
      position: this.npc.position,
      type: "ship" as const,
      name: this.mission.npc.name,
      hostile: false,
    };
  }

  isActive(): boolean {
    return this.npc !== null && !this.finished && this.phase?.id !== "IDLE";
  }

  dispose() {
    if (this.npc) {
      this.scene.remove(this.npc.mesh);
      this.npc.dispose();
      this.npc = null;
    }
    this.messageQueue = [];
    this.transcript = [];
  }

  // ─── Phase Machine ───

  private enterPhase(index: number) {
    if (!this.mission) return;
    if (index >= this.mission.phases.length) {
      // Mission complete
      this.finish();
      return;
    }

    this.phaseIndex = index;
    this.phase = this.mission.phases[index]!;
    this.phaseTimer = 0;
    this.timedMessagesSent.clear();
    this.animationComplete = false;
    this.fadeTimer = 0;

    // Queue dialogue for this phase
    if (this.phase.dialogue) {
      this.enqueueLines(this.phase.dialogue);
    }

    // Trigger incoming transmission
    if (this.phase.incomingTransmission && !this.maydayTriggered) {
      this.hasIncoming = true;
      this.maydayTriggered = true;
    }
  }

  private advancePhase() {
    this.enterPhase(this.phaseIndex + 1);
  }

  private evaluateExit(_ship: Ship) {
    if (!this.phase) return;
    const exit = this.phase.exit;

    switch (exit.trigger) {
      case "timer":
        if (this.phaseTimer >= (exit.delay ?? 0)) {
          this.advancePhase();
        }
        break;

      case "proximity":
        if (this.npc && this.lastDistance <= (exit.range ?? 0)) {
          this.advancePhase();
        }
        break;

      case "action":
        // Handled by triggerRescue() or similar action methods
        break;

      case "animation-complete":
        if (this.animationComplete) {
          this.advancePhase();
        }
        break;
    }
  }

  private finish() {
    this.finished = true;
    this.phase = null;
    this.hasIncoming = false;
    this.completeTimer = 0;
    if (this.mission) {
      try {
        localStorage.setItem(this.mission.storageKey, "complete");
      } catch { /* storage unavailable */ }
    }
  }

  // ─── NPC Spawning ───

  private spawnNpc(planets: Planet[]) {
    if (!this.mission || this.npcSpawned) return;
    this.npcSpawned = true;

    const npcDef = this.mission.npc;
    const planet = planets[Math.floor(Math.random() * planets.length)]!;
    const angle = Math.random() * Math.PI * 2;
    const dist = npcDef.spawnDistance;
    const spawnPos = {
      x: planet.position.x + Math.cos(angle) * dist,
      y: planet.position.y + Math.sin(angle) * dist,
    };

    const shipDef = getShipDef(npcDef.shipId);
    if (!shipDef) return;

    const texturePath = getShipTexturePath(npcDef.shipId, shipDef.name, npcDef.color);
    const fakeTarget = { position: { x: 99999, y: 99999 }, radius: 1 };
    this.npc = new NpcShip(
      npcDef.id,
      npcDef.name,
      fakeTarget,
      spawnPos,
      shipDef.modelPath,
      texturePath,
    );

    // Keep NPC stationary
    (this.npc as any).npcState = "DOCKED";
    (this.npc as any).dockDuration = 999999;
    (this.npc as any).dockTimer = 0;

    this.scene.add(this.npc.mesh);
  }

  // ─── Animation: Rescue Sequence ───

  private updateRescueAnimation(dt: number, ship: Ship, planets: Planet[]) {
    switch (this.rescueStep) {
      case "APPROACH_CONTACT": {
        if (!this.npc) break;
        const dx = this.npc.position.x - ship.state.position.x;
        const dy = this.npc.position.y - ship.state.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const targetRot = Math.atan2(-dx, dy);
        ship.state.rotation = lerpAngle(ship.state.rotation, targetRot, dt * 1.8);

        if (dist > RESCUE_APPROACH_STOP_DIST) {
          const t = Math.max(0, Math.min(1, (dist - RESCUE_APPROACH_STOP_DIST) / 8));
          const ease = t * t * (3 - 2 * t);
          const speed = Math.max(0.3, RESCUE_APPROACH_SPEED * ease);
          ship.state.position.x += (dx / dist) * speed * dt;
          ship.state.position.y += (dy / dist) * speed * dt;
          ship.state.thrust = Math.min(1, speed / RESCUE_APPROACH_SPEED) * 0.4;
        } else {
          this.rescueStep = "TRANSFER";
          this.rescueTimer = 0;
          ship.state.thrust = 0;
        }
        ship.syncMesh();
        break;
      }

      case "TRANSFER": {
        if (!this.npc) break;
        this.rescueTimer += dt;

        const dx = this.npc.position.x - ship.state.position.x;
        const dy = this.npc.position.y - ship.state.position.y;
        const towardRot = Math.atan2(-dx, dy);
        const awayRot = towardRot + Math.PI;
        ship.state.rotation = lerpAngle(ship.state.rotation, awayRot, dt * 1.2);
        ship.state.thrust = 0;
        ship.syncMesh();

        if (this.messageQueue.length === 0 && this.rescueTimer > 2) {
          this.rescueStep = "DEPART_CURVE";
          this.rescueTimer = 0;
          this.rescueDepartSpeed = 0;
          this.findNearestPlanet(ship, planets);
        }
        break;
      }

      case "DEPART_CURVE": {
        this.rescueTimer += dt;

        if (this.nearestPlanetPos) {
          const dx = this.nearestPlanetPos.x - ship.state.position.x;
          const dy = this.nearestPlanetPos.y - ship.state.position.y;
          const targetRot = Math.atan2(-dx, dy);
          ship.state.rotation = lerpAngle(ship.state.rotation, targetRot, dt * 1.5);
        }

        let mDist = 0;
        if (this.npc) {
          const mdx = this.npc.position.x - ship.state.position.x;
          const mdy = this.npc.position.y - ship.state.position.y;
          mDist = Math.sqrt(mdx * mdx + mdy * mdy);
        }

        const distToStop = RESCUE_WATCH_DIST - mDist;
        if (distToStop > RESCUE_DEPART_BRAKE_RANGE) {
          this.rescueDepartSpeed = Math.min(
            RESCUE_DEPART_MAX_SPEED,
            this.rescueDepartSpeed + RESCUE_DEPART_ACCEL * dt,
          );
        } else if (distToStop > 0) {
          const brakeT = Math.max(0, distToStop / RESCUE_DEPART_BRAKE_RANGE);
          const brakeEase = brakeT * brakeT;
          this.rescueDepartSpeed = Math.max(0.3, RESCUE_DEPART_MAX_SPEED * brakeEase);
        }

        ship.state.position.x += -Math.sin(ship.state.rotation) * this.rescueDepartSpeed * dt;
        ship.state.position.y += Math.cos(ship.state.rotation) * this.rescueDepartSpeed * dt;
        ship.state.thrust = Math.min(1, this.rescueDepartSpeed / RESCUE_DEPART_MAX_SPEED) * 0.6;
        ship.syncMesh();

        if (mDist > RESCUE_WATCH_DIST || this.rescueTimer > 8) {
          this.rescueStep = "WATCH";
          this.rescueTimer = 0;
          ship.state.thrust = 0;
          ship.state.velocity = { x: 0, y: 0 };
          ship.syncMesh();
        }
        break;
      }

      case "WATCH": {
        this.rescueTimer += dt;

        if (this.npc) {
          const dx = this.npc.position.x - ship.state.position.x;
          const dy = this.npc.position.y - ship.state.position.y;
          const targetRot = Math.atan2(-dx, dy);
          ship.state.rotation = lerpAngle(ship.state.rotation, targetRot, dt * 2);
          ship.state.thrust = 0;
          ship.syncMesh();
        }

        if (this.rescueTimer > 1.5) {
          this.animationComplete = true;
        }
        break;
      }
    }
  }

  // ─── Animation: NPC Fade Out ───

  private updateFadeOut(dt: number, ship: Ship) {
    if (!this.npc) return;
    const fadeDuration = this.phase?.animationParams?.fadeDuration ?? 2;

    this.fadeTimer += dt;
    const fadeProgress = Math.min(1, this.fadeTimer / fadeDuration);

    // Player ship watches
    const dx = this.npc.position.x - ship.state.position.x;
    const dy = this.npc.position.y - ship.state.position.y;
    const targetRot = Math.atan2(-dx, dy);
    ship.state.rotation = lerpAngle(ship.state.rotation, targetRot, dt * 2);
    ship.state.thrust = 0;
    ship.syncMesh();

    // Fade out NPC mesh
    this.npc.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.Material;
        mat.transparent = true;
        mat.opacity = 1 - fadeProgress;
      }
    });

    if (fadeProgress >= 1) {
      this.scene.remove(this.npc.mesh);
      this.npc.dispose();
      this.npc = null;
      this.lastDistance = Infinity;
      // Zero player velocity for clean handoff
      ship.state.velocity = { x: 0, y: 0 };
      ship.state.thrust = 0;
      ship.syncMesh();
      this.animationComplete = true;
    }
  }

  // ─── Helpers ───

  private distanceToNpc(ship: Ship): number {
    if (!this.npc) return Infinity;
    const dx = this.npc.position.x - ship.position.x;
    const dy = this.npc.position.y - ship.position.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private computeSignalStrength(dist: number): number {
    if (!this.phase) return 0;
    const id = this.phase.id;
    if (id === "ARRIVED" || id === "RESCUED" || id === "FADING") return 1;
    if (id === "IDLE") return 0;
    if (dist >= SIGNAL_DETECT_RANGE) return 0;
    return Math.max(0, 1 - (dist - 8) / (SIGNAL_DETECT_RANGE - 8));
  }

  private enqueueLines(lines: MissionDialogueLine[]) {
    let cumDelay = 0;
    for (const line of lines) {
      cumDelay += line.delay;
      this.messageQueue.push({
        line,
        fireAt: this.queueClock + cumDelay,
      });
    }
  }

  private findNearestPlanet(ship: Ship, planets: Planet[]) {
    let nearest: Planet | null = null;
    let nearestDist = Infinity;
    for (const planet of planets) {
      const dx = planet.position.x - ship.state.position.x;
      const dy = planet.position.y - ship.state.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = planet;
      }
    }
    this.nearestPlanetPos = nearest ? { x: nearest.position.x, y: nearest.position.y } : null;
  }
}
