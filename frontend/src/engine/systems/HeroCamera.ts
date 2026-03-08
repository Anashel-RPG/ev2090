import * as THREE from "three";
import type { HeroSubject, HeroShotConfig } from "@/types/game";

/**
 * Hero shot authoring tool — controls the main perspective camera directly.
 *
 * NO projection change. NO camera switch. The gameplay perspective camera
 * is the only camera used. This system just lets you reposition it
 * (zoom, pan) and add post-processing effects (bloom, vignette).
 *
 * Zoom is implemented via FOV changes on the perspective camera:
 *   effectiveFov = baseFov / zoomFactor
 *
 * On activation, params are captured from the current gameplay state.
 * Panel shows live values. Any change via slider, mouse, or keyboard
 * directly moves the camera. Zero visual change on activation.
 *
 * Includes animation support: can smoothly tween all params from
 * gameplay → composed shot and back, so you can preview the transition.
 *
 * Mouse controls:
 *   Left-drag  → Pan camera XY
 *   Wheel      → Zoom in/out
 *   Left-drag  → Rotate ship heading (when ship-rotate toggle is ON)
 *
 * Keyboard (when active):
 *   Arrow keys / WASD → Nudge camera pan
 *   +/- → Zoom in/out
 *
 * Pattern: constructor() + activate/deactivate + update(dt) + dispose()
 */

export interface HeroEffects {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  vignetteIntensity: number;
  vignetteSoftness: number;
  letterbox: number;
  brightness: number;
  contrast: number;
  exposure: number;
}

export class HeroCamera {
  private active = false;
  private subject: HeroSubject | null = null;
  private subjectWorldPos = new THREE.Vector3();

  // Current live params
  private params: HeroShotConfig = {
    zoom: 1,
    panX: 0,
    panY: 0,
    bloomStrength: 0,
    bloomRadius: 0,
    bloomThreshold: 1,
    vignetteIntensity: 0,
    vignetteSoftness: 0.5,
    letterbox: 0,
    brightness: 1.34,
    contrast: 0.98,
    exposure: 1.16,
  };

  // Snapshot of gameplay state at activation (for preview animation)
  private gameplayParams: HeroShotConfig = { ...this.params };

  // Animation state
  private animating = false;
  private animFrom: HeroShotConfig | null = null;
  private animTo: HeroShotConfig | null = null;
  private animElapsed = 0;
  private animDuration = 1.5;
  private animOnComplete: (() => void) | null = null;

  // Mouse interaction
  private canvas: HTMLCanvasElement | null = null;
  private dragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private shipRotateMode = false;
  private shipRotateCallback: ((delta: number) => void) | null = null;

  // Keyboard state
  private keysDown = new Set<string>();
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyUpHandler: ((e: KeyboardEvent) => void) | null = null;

  // Reference to the perspective camera (set on activation)
  private cam: THREE.PerspectiveCamera | null = null;
  private viewSize = 40;
  /** Base FOV computed from viewSize, used for zoom → FOV conversion */
  private baseFov = 22.6;

  constructor() {
    // No camera created — we control the gameplay camera directly
  }

  // ─── Activation ───

  /**
   * Enter hero mode. Captures current camera state as initial params.
   * Zero visual change — params match the live camera exactly.
   */
  activate(
    subject: HeroSubject,
    subjectWorldPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    viewSize: number,
    gameplayZoom: number,
    gameplayCamPos: THREE.Vector3,
    colorCorrection?: { brightness: number; contrast: number; exposure: number },
    postFx?: { bloomStrength: number; bloomRadius: number; bloomThreshold: number; vignetteIntensity: number; vignetteSoftness: number },
  ) {
    this.active = true;
    this.subject = subject;
    this.subjectWorldPos.copy(subjectWorldPos);
    this.cam = camera;
    this.viewSize = viewSize;
    // Compute baseFov from viewSize (same formula as CameraController)
    this.baseFov = 2 * Math.atan((viewSize / 2) / 100) * (180 / Math.PI);
    this.animating = false;

    // Capture EXACT current state — zero visual change
    const cc = colorCorrection ?? { brightness: 1.34, contrast: 0.98, exposure: 1.16 };
    const fx = postFx ?? { bloomStrength: 0, bloomRadius: 0, bloomThreshold: 1, vignetteIntensity: 0, vignetteSoftness: 0.5 };
    this.params = {
      zoom: gameplayZoom,
      panX: gameplayCamPos.x - subjectWorldPos.x,
      panY: gameplayCamPos.y - subjectWorldPos.y,
      bloomStrength: fx.bloomStrength,
      bloomRadius: fx.bloomRadius,
      bloomThreshold: fx.bloomThreshold,
      vignetteIntensity: fx.vignetteIntensity,
      vignetteSoftness: fx.vignetteSoftness,
      letterbox: 0,
      brightness: cc.brightness,
      contrast: cc.contrast,
      exposure: cc.exposure,
    };

    // Save gameplay snapshot for preview animation
    this.gameplayParams = { ...this.params };
  }

  deactivate() {
    this.active = false;
    this.subject = null;
    this.animating = false;
    this.cam = null;
    this.detachCanvas();
    this.detachKeyboard();
  }

  isActive(): boolean { return this.active; }
  getSubject(): HeroSubject | null { return this.subject; }

  // ─── Params ───

  setParam(key: keyof HeroShotConfig, value: number) {
    this.params[key] = value;
    this.applyToCamera();
  }

  getParams(): HeroShotConfig { return { ...this.params }; }

  getEffects(): HeroEffects {
    return {
      bloomStrength: this.params.bloomStrength,
      bloomRadius: this.params.bloomRadius,
      bloomThreshold: this.params.bloomThreshold,
      vignetteIntensity: this.params.vignetteIntensity,
      vignetteSoftness: this.params.vignetteSoftness,
      letterbox: this.params.letterbox,
      brightness: this.params.brightness,
      contrast: this.params.contrast,
      exposure: this.params.exposure,
    };
  }

  // ─── Preview Animation ───

  /**
   * Animate from current params to gameplay params (or vice versa).
   * Call once to go to gameplay, call again to go back to composed shot.
   */
  previewToGameplay(duration = 1.5, onComplete?: () => void) {
    this.animFrom = { ...this.params };
    this.animTo = { ...this.gameplayParams };
    this.animElapsed = 0;
    this.animDuration = duration;
    this.animOnComplete = onComplete ?? null;
    this.animating = true;
  }

  previewToComposed(duration = 1.5, onComplete?: () => void) {
    this.animFrom = { ...this.params };
    this.animTo = { ...this.getLastComposed() };
    this.animElapsed = 0;
    this.animDuration = duration;
    this.animOnComplete = onComplete ?? null;
    this.animating = true;
  }

  /** Save current params as the "composed" target for preview toggle */
  private composedParams: HeroShotConfig | null = null;

  saveComposed() {
    this.composedParams = { ...this.params };
  }

  /** Load a preset as the composed target (without changing current params) */
  setComposed(config: HeroShotConfig) {
    this.composedParams = { ...config };
  }

  private getLastComposed(): HeroShotConfig {
    return this.composedParams ?? { ...this.params };
  }

  isAnimating(): boolean { return this.animating; }

  // ─── Update ───

  update(dt: number) {
    if (!this.active) return;

    // Keyboard nudge
    this.processKeys(dt);

    // Animation — camera params animate over full duration,
    // effects (bloom, vignette, letterbox) are delayed to avoid
    // jarring bloom recoloring during the early camera movement.
    if (this.animating && this.animFrom && this.animTo) {
      this.animElapsed += dt;
      const rawT = Math.min(1, this.animElapsed / this.animDuration);
      const cameraT = this.easeInOutCubic(rawT);

      const from = this.animFrom;
      const to = this.animTo;

      // All params use the same smooth easeInOutCubic curve.
      // The pipeline flicker was caused by PostProcessing pass enable/disable
      // toggling, not by the curve shape — now that passes stay always enabled,
      // a single smooth curve works perfectly for everything.
      this.params.zoom = from.zoom + (to.zoom - from.zoom) * cameraT;
      this.params.panX = from.panX + (to.panX - from.panX) * cameraT;
      this.params.panY = from.panY + (to.panY - from.panY) * cameraT;
      this.params.bloomStrength = from.bloomStrength + (to.bloomStrength - from.bloomStrength) * cameraT;
      this.params.bloomRadius = from.bloomRadius + (to.bloomRadius - from.bloomRadius) * cameraT;
      this.params.bloomThreshold = from.bloomThreshold + (to.bloomThreshold - from.bloomThreshold) * cameraT;
      this.params.vignetteIntensity = from.vignetteIntensity + (to.vignetteIntensity - from.vignetteIntensity) * cameraT;
      this.params.vignetteSoftness = from.vignetteSoftness + (to.vignetteSoftness - from.vignetteSoftness) * cameraT;
      this.params.letterbox = from.letterbox + (to.letterbox - from.letterbox) * cameraT;

      if (rawT >= 1) {
        this.animating = false;
        const cb = this.animOnComplete;
        this.animOnComplete = null;
        cb?.();
      }
    }

    this.applyToCamera();
  }

  // ─── Perspective Camera Control ───

  private applyToCamera() {
    if (!this.cam) return;

    // Apply zoom via FOV on the perspective camera
    this.cam.fov = this.baseFov / this.params.zoom;
    this.cam.updateProjectionMatrix();

    // Apply pan — position the camera over subject + offset
    this.cam.position.x = this.subjectWorldPos.x + this.params.panX;
    this.cam.position.y = this.subjectWorldPos.y + this.params.panY;
    // Z stays at 100 (unchanged)
  }

  // ─── Mouse Controls ───

  attachCanvas(canvas: HTMLCanvasElement) {
    this.detachCanvas();
    this.canvas = canvas;
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  detachCanvas() {
    if (!this.canvas) return;
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas = null;
    this.dragging = false;
  }

  // ─── Keyboard Controls ───

  attachKeyboard() {
    this.detachKeyboard();
    this.keyHandler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright",
           "w", "a", "s", "d", "+", "-", "="].includes(key)) {
        e.preventDefault();
        this.keysDown.add(key);
      }
    };
    this.keyUpHandler = (e: KeyboardEvent) => {
      this.keysDown.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", this.keyHandler);
    window.addEventListener("keyup", this.keyUpHandler);
  }

  detachKeyboard() {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    if (this.keyUpHandler) {
      window.removeEventListener("keyup", this.keyUpHandler);
      this.keyUpHandler = null;
    }
    this.keysDown.clear();
  }

  private processKeys(dt: number) {
    if (this.keysDown.size === 0 || this.animating) return;

    const panSpeed = (this.viewSize / this.params.zoom) * 0.5 * dt;
    const zoomSpeed = 1.5 * dt;

    if (this.keysDown.has("arrowleft") || this.keysDown.has("a")) {
      this.params.panX -= panSpeed;
    }
    if (this.keysDown.has("arrowright") || this.keysDown.has("d")) {
      this.params.panX += panSpeed;
    }
    if (this.keysDown.has("arrowup") || this.keysDown.has("w")) {
      this.params.panY += panSpeed;
    }
    if (this.keysDown.has("arrowdown") || this.keysDown.has("s")) {
      this.params.panY -= panSpeed;
    }
    if (this.keysDown.has("+") || this.keysDown.has("=")) {
      this.params.zoom = Math.min(10, this.params.zoom + zoomSpeed);
    }
    if (this.keysDown.has("-")) {
      this.params.zoom = Math.max(0.1, this.params.zoom - zoomSpeed);
    }
  }

  setShipRotateCallback(cb: ((delta: number) => void) | null) {
    this.shipRotateCallback = cb;
  }

  setShipRotateMode(on: boolean) { this.shipRotateMode = on; }
  isShipRotateMode(): boolean { return this.shipRotateMode; }

  private onMouseDown = (e: MouseEvent) => {
    this.dragging = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging || this.animating) return;

    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;

    if (this.shipRotateMode && this.shipRotateCallback) {
      this.shipRotateCallback(dx * 0.01);
    } else {
      // Pan: convert pixel drag to world units based on current zoom
      const effectiveViewSize = this.viewSize / this.params.zoom;
      const canvasH = this.canvas?.clientHeight ?? 800;
      const scale = effectiveViewSize / canvasH;
      this.params.panX -= dx * scale;
      this.params.panY += dy * scale;
    }

    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  };

  private onMouseUp = () => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.animating) return;
    const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
    this.params.zoom = Math.max(0.1, Math.min(10, this.params.zoom + zoomDelta));
  };

  private onContextMenu = (e: MouseEvent) => { e.preventDefault(); };

  /**
   * Adjust the gameplay animation target by a world-space offset.
   * Used to bake in the sidebar shift that will be applied after exit,
   * so the camera animates to the correct final position without a jump.
   */
  adjustGameplayTarget(dx: number, dy: number) {
    this.gameplayParams.panX += dx;
    this.gameplayParams.panY += dy;
  }

  // ─── Subject Position ───

  setSubjectPosition(pos: THREE.Vector3) {
    this.subjectWorldPos.copy(pos);
  }

  // ─── No separate camera — we control the main camera directly ───

  /** Not used — the main camera is always active. Kept for Engine compat. */
  getCamera(): THREE.Camera {
    return this.cam!;
  }

  /** Not used — camera is resized by CameraController */
  resize(_aspect: number) {}

  dispose() {
    this.detachCanvas();
    this.detachKeyboard();
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}
