import * as THREE from "three";

/**
 * Camera controller that smoothly follows the player ship.
 *
 * Debug views are FIXED in world space — they follow the ship's XY position
 * but do NOT rotate with the ship. The camera up vector is set to (0,0,1)
 * so that world Z = screen vertical and the XY game plane maps to screen
 * horizontal, making the ship appear horizontal in side views.
 */

export type DebugView = "normal" | "side" | "iso" | "iso-r" | "orbit";

export class CameraController {
  camera: THREE.OrthographicCamera;
  /** Perspective camera used for angled debug views */
  debugCamera: THREE.PerspectiveCamera;
  /** Which camera is currently active */
  private debugView: DebugView = "normal";

  private smoothing = 0.08; // lower = smoother/slower follow
  private targetX = 0;
  private targetY = 0;
  /** World-unit offset applied to ortho camera X so ship centers in playable area */
  private sidebarOffsetX = 0;

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

  /** How many world units are visible vertically */
  readonly viewSize = 40;

  constructor(width: number, height: number) {
    const aspect = width / height;
    const halfV = this.viewSize / 2;
    const halfH = halfV * aspect;

    this.camera = new THREE.OrthographicCamera(
      -halfH,
      halfH,
      halfV,
      -halfV,
      0.1,
      1000,
    );
    this.camera.position.set(0, 0, 100);
    this.camera.lookAt(0, 0, 0);

    // Debug perspective camera for angled views.
    // up = (0,0,1) so world Z is always vertical on screen.
    this.debugCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.debugCamera.up.set(0, 0, 1);
    this.debugCamera.position.set(0, 0, 100);
    this.debugCamera.lookAt(0, 0, 0);
  }

  /** Get the currently active camera (ortho or perspective depending on debug view) */
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
   * Shift the ortho camera right by worldUnits so the ship appears at the center
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

  /** Update camera position with smooth interpolation */
  update() {
    // Ortho camera always tracks (used in normal mode).
    // sidebarOffsetX shifts the view right so the ship is centered in the
    // playable area (left of sidebar) rather than the raw canvas center.
    // manualOffset adds a user-controlled debug offset on top.
    this.camera.position.x +=
      (this.targetX + this.sidebarOffsetX + this.manualOffsetX - this.camera.position.x) * this.smoothing;
    this.camera.position.y +=
      (this.targetY + this.manualOffsetY - this.camera.position.y) * this.smoothing;

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

  /** Set zoom factor (1 = default). Multiplies the base viewSize by 1/factor. */
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
    const effectiveViewSize = this.viewSize / this.zoomFactor;
    const aspect = (this.camera.right - this.camera.left) / (this.camera.top - this.camera.bottom) || 1;
    // Recalculate aspect from renderer dimensions stored in current frustum
    const halfV = effectiveViewSize / 2;
    const halfH = halfV * aspect;

    this.camera.left = -halfH;
    this.camera.right = halfH;
    this.camera.top = halfV;
    this.camera.bottom = -halfV;
    this.camera.updateProjectionMatrix();
  }

  /** Resize the camera frustum when the window changes size */
  resize(width: number, height: number) {
    const aspect = width / height;
    const effectiveViewSize = this.viewSize / this.zoomFactor;
    const halfV = effectiveViewSize / 2;
    const halfH = halfV * aspect;

    this.camera.left = -halfH;
    this.camera.right = halfH;
    this.camera.top = halfV;
    this.camera.bottom = -halfV;
    this.camera.updateProjectionMatrix();

    this.debugCamera.aspect = aspect;
    this.debugCamera.updateProjectionMatrix();
  }
}
