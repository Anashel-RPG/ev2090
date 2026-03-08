import * as THREE from "three";

/**
 * Camera controller that smoothly follows the player ship.
 *
 * Uses a PERSPECTIVE camera for the entire game. The base FOV is computed
 * to match a 40-unit vertical view at z=0 (distance 100 from camera at z=100).
 * At that distance, perspective looks virtually identical to orthographic —
 * objects at different Z levels differ by ~10% in apparent size (imperceptible).
 *
 * FPV mode reuses the SAME camera — no projection switch, no visual pop.
 * The camera smoothly swoops from top-down (z=100, narrow FOV) to behind the
 * ship (z~12.5, wide FOV=70°) while blending the up vector and lookAt target.
 *
 * Debug views are FIXED in world space — they follow the ship's XY position
 * but do NOT rotate with the ship. The debug camera up vector is set to (0,0,1)
 * so that world Z = screen vertical.
 */

export type DebugView = "normal" | "side" | "iso" | "iso-r" | "orbit" | "fpv";

export class CameraController {
  camera: THREE.PerspectiveCamera;
  /** Perspective camera used for angled debug views */
  debugCamera: THREE.PerspectiveCamera;
  /** Which camera is currently active */
  private debugView: DebugView = "normal";

  private smoothing = 0.08; // lower = smoother/slower follow
  private targetX = 0;
  private targetY = 0;
  /** World-unit offset applied to camera X so ship centers in playable area */
  private sidebarOffsetX = 0;

  // Smooth-tracked position (persists through FPV for seamless exit)
  private trackedX = 0;
  private trackedY = 0;

  // Orbit mode state (spherical coordinates around a center point)
  private orbitAzimuth = 0; // horizontal angle around Z axis
  private orbitElevation = Math.PI / 5; // ~36° above horizon
  private orbitDistance = 20;
  private orbitCenterX = 0;
  private orbitCenterY = 0;

  // Zoom & manual offset for debug panel
  private zoomFactor = 1;
  private manualOffsetX = 0;
  private manualOffsetY = 0;

  // FPV mode state
  private fpvActive = false;
  private fpvTransition = 0; // 0 = top-down, 1 = fully FPV
  private fpvTransitionSpeed = 0.8; // complete transition in ~1.25s
  /** Ship physics heading in radians (rotation + thrustForwardAngle).
   *  Single source of truth for FPV forward direction — set by engine each frame. */
  private shipHeading = 0;
  // FPV camera tunables (exposed via config panel)
  private fpvHeightAbove = 8.1;
  private fpvLookUpOffset = -4.5;
  private fpvBehindDist = 0.8; // how far behind ship center (negative = in front)
  private fpvNpcOffset = 6.5; // vertical offset for NPC ships during FPV
  private fpvPlanetOffset = 8.5; // vertical offset for planets during FPV
  private cameraRoll = 0; // subtle camera roll for banking feel

  // ── Bridge / COMM mode state (Phase 2, chains after FPV) ──
  private bridgeActive = false;
  private bridgeTransition = 0; // 0 = FPV behind-ship, 1 = inside bridge
  bridgeTransitionSpeed = 1.2; // ~0.8s to enter bridge
  // Bridge camera look-at offset: during bridge mode, the view transitions from
  // the FPV down-angle (fpvLookUpOffset = -4.5, looking down at ship for flight)
  // to a more horizontal cockpit view matching the Blender camera orientation.
  // At bridgeTransition=1, fpvLookUpOffset is lerped to this value.
  bridgeLookUpOffset = 3.0; // more horizontal cockpit view (positive = look up)
  bridgeFov = 65; // wider FOV to show more cockpit interior

  // Bridge transition speed (how fast the bridge model slides into position)
  // No camera movement — camera stays in FPV position.
  // The bridge model animates around the camera instead.

  /** How many world units are visible vertically at the reference plane (z=0) */
  readonly viewSize = 40;

  /** Base vertical FOV (degrees) matching viewSize at camera distance */
  readonly baseFov: number;

  /** Camera Z height for top-down view */
  private readonly cameraZ = 100;

  constructor(width: number, height: number) {
    const aspect = width / height;

    // Compute FOV to match the ortho-equivalent viewSize at the reference distance.
    // FOV = 2 * atan(halfViewSize / cameraZ)
    // At z=0 (distance=100), perspective shows exactly viewSize (40) world units vertically.
    // At z=10 (ships, distance=90), objects appear ~11% larger — imperceptible.
    const halfV = this.viewSize / 2;
    this.baseFov = 2 * Math.atan(halfV / this.cameraZ) * (180 / Math.PI);

    this.camera = new THREE.PerspectiveCamera(
      this.baseFov,
      aspect,
      0.1,
      1000,
    );
    this.camera.position.set(0, 0, this.cameraZ);
    this.camera.lookAt(0, 0, 0);

    // Debug perspective camera for angled views.
    // up = (0,0,1) so world Z is always vertical on screen.
    this.debugCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.debugCamera.up.set(0, 0, 1);
    this.debugCamera.position.set(0, 0, this.cameraZ);
    this.debugCamera.lookAt(0, 0, 0);
  }

  /** Get the currently active camera */
  getActiveCamera(): THREE.Camera {
    return this.debugView === "normal" ? this.camera : this.debugCamera;
  }

  /** Set the debug view mode */
  setDebugView(view: DebugView) {
    this.debugView = view;
  }

  getDebugView(): DebugView {
    return this.debugView;
  }

  /** Set the target position for the camera to follow */
  setTarget(x: number, y: number) {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Shift the camera right by worldUnits so the ship appears at the center
   * of the playable area (to the left of the sidebar) rather than the full canvas.
   * Pass 0 to disable (mobile / no sidebar).
   */
  setSidebarOffset(worldUnits: number) {
    this.sidebarOffsetX = worldUnits;
  }

  /** Set the center point for orbit mode */
  setOrbitCenter(x: number, y: number) {
    this.orbitCenterX = x;
    this.orbitCenterY = y;
  }

  /** Handle mouse drag for orbit rotation */
  handleOrbitDrag(deltaX: number, deltaY: number) {
    this.orbitAzimuth += deltaX * 0.008;
    // Full vertical range: just above -90° (below ship) to just below +90° (above ship)
    this.orbitElevation = Math.max(
      -Math.PI / 2 + 0.05,
      Math.min(Math.PI / 2 - 0.05, this.orbitElevation - deltaY * 0.008),
    );
  }

  /** Handle scroll wheel for orbit zoom */
  handleOrbitZoom(delta: number) {
    this.orbitDistance = Math.max(5, Math.min(60, this.orbitDistance + delta * 0.02));
  }

  // ─── FPV Mode ───

  /** Toggle FPV cockpit camera on/off */
  toggleFpv() {
    this.fpvActive = !this.fpvActive;
  }

  isFpvActive(): boolean {
    return this.fpvActive;
  }

  /** Get current FPV transition value (0 = top-down, 1 = fully FPV) */
  getFpvTransition(): number {
    return this.fpvTransition;
  }

  /** Set the ship's physics heading (rotation + thrust offset).
   *  Called by Engine each frame. This is the direction the ship actually moves. */
  setShipHeading(radians: number) {
    this.shipHeading = radians;
  }

  // ─── Bridge / COMM Mode ───

  /** Activate bridge interior mode (chains after FPV) */
  toggleBridge() {
    this.bridgeActive = !this.bridgeActive;
  }

  setBridgeActive(active: boolean) {
    this.bridgeActive = active;
  }

  isBridgeActive(): boolean {
    return this.bridgeActive;
  }

  /** Get current bridge transition value (0 = FPV behind-ship, 1 = inside bridge) */
  getBridgeTransition(): number {
    return this.bridgeTransition;
  }

  // ─── Bridge Config (exposed for tuning panel) ───

  getBridgeCameraConfig(): Record<string, number> {
    return {
      bridgeSpeed: this.bridgeTransitionSpeed,
    };
  }

  setBridgeCameraParam(key: string, value: number) {
    if (key === "bridgeSpeed") this.bridgeTransitionSpeed = value;
  }

  /** Update camera position with smooth interpolation */
  update(dt = 0.016) {
    // Always accumulate the smooth-tracked top-down position.
    // This runs even during FPV so exiting FPV returns smoothly.
    const topDownTargetX = this.targetX + this.sidebarOffsetX + this.manualOffsetX;
    const topDownTargetY = this.targetY + this.manualOffsetY;
    this.trackedX += (topDownTargetX - this.trackedX) * this.smoothing;
    this.trackedY += (topDownTargetY - this.trackedY) * this.smoothing;

    // Handle FPV transition timing
    if (this.fpvActive && this.fpvTransition < 1) {
      this.fpvTransition = Math.min(1, this.fpvTransition + dt * this.fpvTransitionSpeed);
    } else if (!this.fpvActive && this.bridgeTransition <= 0 && this.fpvTransition > 0) {
      // Only exit FPV once bridge has fully exited (prevents camera jump)
      this.fpvTransition = Math.max(0, this.fpvTransition - dt * this.fpvTransitionSpeed);
    }

    // Handle Bridge transition timing — only animates when FPV is fully settled
    if (this.bridgeActive && this.fpvTransition >= 1 && this.bridgeTransition < 1) {
      this.bridgeTransition = Math.min(1, this.bridgeTransition + dt * this.bridgeTransitionSpeed);
    } else if (!this.bridgeActive && this.bridgeTransition > 0) {
      this.bridgeTransition = Math.max(0, this.bridgeTransition - dt * this.bridgeTransitionSpeed);
    }

    if (this.fpvTransition > 0) {
      // FPV transitioning or fully active — camera stays in FPV position even during bridge.
      // The bridge MODEL animates around the camera, not the other way around.
      this.updateFpvCamera(dt);
    } else {
      // Normal top-down mode — apply tracked position
      this.camera.position.x = this.trackedX;
      this.camera.position.y = this.trackedY;
      this.camera.position.z = this.cameraZ;

      // Ensure top-down orientation
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.trackedX, this.trackedY, 0);

      // Apply zoom via FOV
      const targetFov = this.baseFov / this.zoomFactor;
      if (Math.abs(this.camera.fov - targetFov) > 0.01) {
        this.camera.fov = targetFov;
        this.camera.updateProjectionMatrix();
      }
    }

    if (this.debugView !== "normal") {
      this.updateDebugCamera();
    }
  }

  private updateDebugCamera() {
    const tx = this.targetX;
    const ty = this.targetY;
    const shipZ = 10; // ships live at z=10

    // All debug cameras are FIXED in world space.
    // up = (0,0,1): Z is vertical on screen, XY plane is horizontal.
    // Ship at rot=0 faces +Y → appears pointing RIGHT on screen in side view.

    switch (this.debugView) {
      case "side": {
        // SIDE: camera on the -Y side of the ship (in front in top-down),
        // looking at the ship. Ship appears horizontal on screen.
        // Slightly elevated (+2 Z) so we're not perfectly edge-on.
        const camX = tx;
        const camY = ty - 24;
        const camZ = shipZ + 2;
        this.debugCamera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.1);
        this.debugCamera.lookAt(tx, ty, shipZ);
        break;
      }
      case "iso": {
        // ISO: elevated isometric from front-right of the ship.
        // High enough to see the shield glow above the ship surface.
        const camX = tx + 14;
        const camY = ty - 14;
        const camZ = shipZ + 20;
        this.debugCamera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.1);
        this.debugCamera.lookAt(tx, ty, shipZ);
        break;
      }
      case "iso-r": {
        // ISO-R: elevated isometric from front-left.
        // Same angle, opposite side.
        const camX = tx - 14;
        const camY = ty - 14;
        const camZ = shipZ + 20;
        this.debugCamera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.1);
        this.debugCamera.lookAt(tx, ty, shipZ);
        break;
      }
      case "orbit": {
        // ORBIT: mouse-controlled spherical orbit around target (NPC or player).
        // Uses spherical coordinates → cartesian, with Z = up.
        // No lerp — immediate response to mouse drag.
        const cx = this.orbitCenterX;
        const cy = this.orbitCenterY;
        const cz = shipZ;
        const camX = cx + this.orbitDistance * Math.cos(this.orbitElevation) * Math.sin(this.orbitAzimuth);
        const camY = cy - this.orbitDistance * Math.cos(this.orbitElevation) * Math.cos(this.orbitAzimuth);
        const camZ = cz + this.orbitDistance * Math.sin(this.orbitElevation);
        this.debugCamera.position.set(camX, camY, camZ);
        this.debugCamera.lookAt(cx, cy, cz);
        break;
      }
    }
  }

  // ─── FPV Camera Config (exposed for tuning panel) ───

  getFpvCameraConfig(): Record<string, number> {
    return {
      fpvHeight: this.fpvHeightAbove,
      fpvLookUp: this.fpvLookUpOffset,
      fpvBehind: this.fpvBehindDist,
      fpvNpcZ: this.fpvNpcOffset,
      fpvPlanetZ: this.fpvPlanetOffset,
      bridgeLookUp: this.bridgeLookUpOffset,
      bridgeFov: this.bridgeFov,
    };
  }

  setFpvCameraParam(key: string, value: number) {
    if (key === "fpvHeight") this.fpvHeightAbove = value;
    else if (key === "fpvLookUp") this.fpvLookUpOffset = value;
    else if (key === "fpvBehind") this.fpvBehindDist = value;
    else if (key === "fpvNpcZ") this.fpvNpcOffset = value;
    else if (key === "fpvPlanetZ") this.fpvPlanetOffset = value;
    else if (key === "bridgeLookUp") this.bridgeLookUpOffset = value;
    else if (key === "bridgeFov") this.bridgeFov = value;
  }

  /** Get the planet Z offset for current FPV transition state */
  getFpvPlanetZOffset(): number {
    return this.fpvPlanetOffset * this.fpvTransition;
  }

  /** Get the NPC Z offset for current FPV transition state */
  getFpvNpcZOffset(): number {
    return this.fpvNpcOffset * this.fpvTransition;
  }

  /**
   * Snap the tracked position to specific coordinates.
   * Used when exiting hero mode to prevent camera jump.
   */
  setTrackedPosition(x: number, y: number) {
    this.trackedX = x;
    this.trackedY = y;
  }

  /** Set subtle camera roll for banking feel (radians). */
  setCameraRoll(angle: number) {
    this.cameraRoll = angle;
  }

  private updateFpvCamera(_dt: number) {
    const shipZ = 10;
    const tx = this.targetX;
    const ty = this.targetY;

    // Two-phase easing for a swooping arc transition:
    // Camera descends toward ship altitude first, then curves behind it.
    const t = this.fpvTransition;
    const baseCubic = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

    // Z descends early (camera drops toward ship first)
    const zEase = Math.pow(baseCubic, 0.6);
    // XY sweeps late (horizontal positioning curves behind ship)
    const xyEase = Math.pow(baseCubic, 1.8);
    // Look-at tracks moderately (eyes follow slightly ahead of body)
    const lookEase = Math.pow(baseCubic, 1.4);

    // Ship forward direction (heading 0 = facing +Y).
    // shipHeading already includes the thrust offset — single source of truth.
    const fpvHeading = this.shipHeading;
    const fwdX = -Math.sin(fpvHeading);
    const fwdY = Math.cos(fpvHeading);
    // Perpendicular (right of ship): rotate forward 90° CW
    const perpX = fwdY;
    const perpY = -fwdX;

    // FPV camera parameters — "bridge" position relative to ship.
    // behindDist: positive = behind ship, negative = in front.
    // heightAbove: camera elevation above ship plane.
    const behindDist = this.fpvBehindDist;
    const heightAbove = this.fpvHeightAbove;
    const lookAheadDist = 30;

    // During transition, add extra behind distance so the ship stays in frame
    // as the camera tilts from top-down to behind-ship. Peaks mid-transition.
    const transitionBehindBoost = Math.sin(baseCubic * Math.PI) * 20;
    const effectiveBehind = behindDist + transitionBehindBoost;

    // ── Lateral arc: prevent 180° camera flip ──
    // When the ship faces -Y (downward), the camera path from top-down to FPV
    // becomes degenerate (straight-line 180° reversal). We add a lateral offset
    // perpendicular to the ship's forward direction, peaking mid-transition.
    // The amount is proportional to how "bad" the heading is (worst at heading ≈ PI,
    // where fwdY ≈ -1 → the ship forward opposes the top-down up vector).
    // badness: 0 when ship faces +Y (easy), 1 when ship faces -Y (hard).
    const badness = Math.max(0, -fwdY);
    const lateralArc = Math.sin(baseCubic * Math.PI) * 25 * badness;

    // FPV position: on/near the ship, elevated to bridge level (no sway)
    const fpvX = tx - fwdX * effectiveBehind + perpX * lateralArc;
    const fpvY = ty - fwdY * effectiveBehind + perpY * lateralArc;
    const fpvZ = shipZ + heightAbove;

    // FPV look-at: ahead of the ship along heading.
    // During bridge transition, smoothly tilt the view from the flight down-angle
    // to a more horizontal cockpit view (matching Blender camera orientation).
    const bridgeEase = this.bridgeTransition < 0.5
      ? 4 * this.bridgeTransition * this.bridgeTransition * this.bridgeTransition
      : 1 - (-2 * this.bridgeTransition + 2) ** 3 / 2;
    const effectiveLookUpOffset = this.fpvLookUpOffset
      + (this.bridgeLookUpOffset - this.fpvLookUpOffset) * bridgeEase;
    const fpvLookX = tx + fwdX * lookAheadDist;
    const fpvLookY = ty + fwdY * lookAheadDist;
    const fpvLookZ = shipZ + 1.5 + effectiveLookUpOffset;

    // Top-down state (use smooth-tracked position)
    const topX = this.trackedX;
    const topY = this.trackedY;
    const topZ = this.cameraZ;
    const topLookX = this.trackedX;
    const topLookY = this.trackedY;
    const topLookZ = 0;

    // Blend position: Z drops early, XY sweeps late → swooping arc
    this.camera.position.set(
      topX + (fpvX - topX) * xyEase,
      topY + (fpvY - topY) * xyEase,
      topZ + (fpvZ - topZ) * zEase,
    );

    // Blend look-at target (moderate tracking)
    const lookX = topLookX + (fpvLookX - topLookX) * lookEase;
    const lookY = topLookY + (fpvLookY - topLookY) * lookEase;
    const lookZ = topLookZ + (fpvLookZ - topLookZ) * lookEase;

    // Blend up vector: (0,1,0) for top-down → (0,0,1) for FPV
    this.camera.up.set(0, 1 - lookEase, lookEase).normalize();
    this.camera.lookAt(lookX, lookY, lookZ);

    // Subtle camera roll for banking feel (applied after lookAt)
    if (this.cameraRoll !== 0 && lookEase > 0) {
      this.camera.rotateZ(this.cameraRoll * lookEase);
    }

    // Blend FOV: narrow (top-down) → moderate FPV → wider bridge cockpit view
    const normalFov = this.baseFov / this.zoomFactor;
    const fpvFov = 55;
    const effectiveFpvFov = fpvFov + (this.bridgeFov - fpvFov) * bridgeEase;
    this.camera.fov = normalFov + (effectiveFpvFov - normalFov) * lookEase;
    this.camera.updateProjectionMatrix();
  }

  /** Set zoom factor (1 = default). Higher = zoomed in (narrower FOV). */
  setZoom(factor: number) {
    this.zoomFactor = Math.max(0.1, factor);
    this.applyZoom();
  }

  getZoom(): number {
    return this.zoomFactor;
  }

  /** Store a manual offset added to the camera position */
  setManualOffset(x: number, y: number) {
    this.manualOffsetX = x;
    this.manualOffsetY = y;
  }

  getManualOffset(): { x: number; y: number } {
    return { x: this.manualOffsetX, y: this.manualOffsetY };
  }

  private applyZoom() {
    if (this.fpvTransition > 0) return; // FPV controls its own FOV
    this.camera.fov = this.baseFov / this.zoomFactor;
    this.camera.updateProjectionMatrix();
  }

  /** Resize the camera when the window changes size */
  resize(width: number, height: number) {
    const aspect = width / height;

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.debugCamera.aspect = aspect;
    this.debugCamera.updateProjectionMatrix();
  }
}
