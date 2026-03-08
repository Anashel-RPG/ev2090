/**
 * BridgeEditor — Visual 3D editor for bridge interior lighting & positioning.
 *
 * Dev tool: toggled via `bridgeedit()` console command.
 * Uses Three.js TransformControls for drag-to-position, PointLightHelper for
 * light visualization, and a free orbit camera for spatial navigation.
 *
 * Two modes:
 *   "edit"  — orbit camera + gizmos + helpers (position lights visually)
 *   "game"  — player's cockpit FPV (preview the lighting result)
 *
 * Isolation: this file + BridgeEditor.css are the only additions.
 * Remove: delete both files + ~10 lines of glue in Engine.ts.
 */

import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { Bridge } from "../entities/Bridge";
import type { CameraController } from "./CameraController";
import "./BridgeEditor.css";

// ─── Types ───

interface EditableObject {
  id: string;
  name: string;
  type: "light" | "dirlight" | "bridge";
  object3D: THREE.Object3D;
  helper: THREE.Object3D | null;
  color: string; // CSS color for the object list dot
}

// ─── BridgeEditor ───

export class BridgeEditor {
  private scene: THREE.Scene;
  private canvas: HTMLCanvasElement;
  private bridge: Bridge;
  private cameraController: CameraController;

  private _active = false;
  private _mode: "game" | "edit" = "edit";

  // ── Edit camera (orbit) ──
  private editCamera: THREE.PerspectiveCamera;
  private azimuth = Math.PI / 4;
  private elevation = Math.PI / 6;
  private orbitDistance = 12;
  private orbitCenter = new THREE.Vector3();
  private orbitTargetCenter = new THREE.Vector3();

  // ── Orbit mouse state ──
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private wasDragged = false;     // true if mouse moved >3px during a press (orbit drag)
  private wasGizmoDrag = false;   // true if TransformControls just finished a drag
  private orbitEnabled = true;    // disabled during gizmo drag

  // ── TransformControls ──
  private transformControls: TransformControls | null = null;
  private transformMode: "translate" | "rotate" | "scale" = "translate";

  // ── Editable objects ──
  private editables: EditableObject[] = [];
  private selectedId: string | null = null;

  // ── Fill lights (owned by editor) ──
  private fillLight2: THREE.PointLight;
  private fillLight3: THREE.PointLight;

  // ── Exterior light (simulates planet/star light through windows — no helper bubble) ──
  private exteriorLight: THREE.DirectionalLight;

  // ── Raycasting ──
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // ── DOM panel ──
  private panel: HTMLDivElement | null = null;

  // ── Bound handlers (for removal) ──
  private _onMouseDown: (e: MouseEvent) => void;
  private _onMouseMove: (e: MouseEvent) => void;
  private _onMouseUp: (e: MouseEvent) => void;
  private _onWheel: (e: WheelEvent) => void;
  private _onClick: (e: MouseEvent) => void;
  private _onKeyDown: (e: KeyboardEvent) => void;

  constructor(
    scene: THREE.Scene,
    canvas: HTMLCanvasElement,
    bridge: Bridge,
    cameraController: CameraController,
  ) {
    this.scene = scene;
    this.canvas = canvas;
    this.bridge = bridge;
    this.cameraController = cameraController;

    // Edit camera
    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.editCamera = new THREE.PerspectiveCamera(55, aspect, 0.1, 2000);

    // Fill lights (start off, positioned near bridge center)
    this.fillLight2 = new THREE.PointLight(0x88bbff, 0, 30, 2);
    this.fillLight2.position.set(-3, 1, 2);
    this.fillLight3 = new THREE.PointLight(0xffaa66, 0, 30, 2);
    this.fillLight3.position.set(3, -1, -2);

    // Exterior directional light (simulates planet/star light through windows)
    this.exteriorLight = new THREE.DirectionalLight(0xaaccff, 0);
    this.exteriorLight.position.set(5, 3, -10); // angled from "outside"
    this.exteriorLight.castShadow = true;
    this.exteriorLight.shadow.mapSize.set(1024, 1024);
    this.exteriorLight.shadow.camera.near = 0.1;
    this.exteriorLight.shadow.camera.far = 50;
    this.exteriorLight.shadow.camera.left = -10;
    this.exteriorLight.shadow.camera.right = 10;
    this.exteriorLight.shadow.camera.top = 10;
    this.exteriorLight.shadow.camera.bottom = -10;

    // Bind event handlers
    this._onMouseDown = this.handleMouseDown.bind(this);
    this._onMouseMove = this.handleMouseMove.bind(this);
    this._onMouseUp = this.handleMouseUp.bind(this);
    this._onWheel = this.handleWheel.bind(this);
    this._onClick = this.handleClick.bind(this);
    this._onKeyDown = this.handleKeyDown.bind(this);
  }

  // ─── Public API ───

  toggle() {
    if (this._active) this.deactivate();
    else this.activate();
  }

  activate() {
    if (this._active) return;
    this._active = true;

    // Force bridge visible at settled position
    this.bridge.setVisible(true);
    this.bridge.updateTransition(1);

    // Add fill lights and exterior light to bridge group
    this.bridge.group.add(this.fillLight2);
    this.bridge.group.add(this.fillLight3);
    this.bridge.group.add(this.exteriorLight);

    // Enable shadow casting/receiving on bridge meshes
    this.bridge.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Build editables registry
    this.buildEditables();

    // Create TransformControls
    this.transformControls = new TransformControls(this.editCamera, this.canvas);
    this.transformControls.setMode(this.transformMode);
    this.transformControls.setSize(0.7);
    this.scene.add(this.transformControls.getHelper());

    // Disable orbit while gizmo is being dragged
    this.transformControls.addEventListener("dragging-changed", (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      this.orbitEnabled = !dragging;
      // Mark gizmo drag so the subsequent click event doesn't re-select
      if (!dragging) this.wasGizmoDrag = true;
    });

    // Sync config when gizmo moves an object
    this.transformControls.addEventListener("change", () => {
      this.syncSelectedToConfig();
      this.updatePanel();
    });

    // Initialize orbit camera from the game camera's current perspective.
    // This gives the edit view the same look direction the player just had,
    // just pulled back to orbit distance — no disorienting upside-down flip.
    const gameCamera = this.cameraController.getActiveCamera();
    this.bridge.group.getWorldPosition(this.orbitCenter);
    this.orbitTargetCenter.copy(this.orbitCenter);

    // Camera looks at -Z in local space, so +Z is backward (from camera toward behind it)
    const backDir = new THREE.Vector3(0, 0, 1);
    backDir.applyQuaternion(gameCamera.quaternion);

    // Convert backward direction to spherical coordinates for the orbit camera
    this.azimuth = Math.atan2(backDir.x, backDir.z);
    this.elevation = Math.asin(Math.max(-1, Math.min(1, backDir.y)));
    this.orbitDistance = 8;

    this.updateOrbitCamera();

    // Attach events
    this.canvas.addEventListener("mousedown", this._onMouseDown);
    this.canvas.addEventListener("mousemove", this._onMouseMove);
    this.canvas.addEventListener("mouseup", this._onMouseUp);
    this.canvas.addEventListener("wheel", this._onWheel, { passive: false });
    this.canvas.addEventListener("click", this._onClick);
    window.addEventListener("keydown", this._onKeyDown);

    // Build DOM panel
    this.buildPanel();

    // Auto-select main light
    this.selectEditable("main-light");

    // Set to edit mode
    this.setMode("edit");

  }

  deactivate() {
    if (!this._active) return;
    this._active = false;

    // Detach gizmo
    if (this.transformControls) {
      this.transformControls.detach();
      this.scene.remove(this.transformControls.getHelper());
      this.transformControls.dispose();
      this.transformControls = null;
    }

    // Remove helpers from scene
    for (const e of this.editables) {
      if (e.helper) {
        this.scene.remove(e.helper);
        if ((e.helper as THREE.PointLightHelper).dispose) {
          (e.helper as THREE.PointLightHelper).dispose();
        }
      }
    }
    this.editables = [];
    this.selectedId = null;

    // Remove fill lights and exterior light from bridge
    this.bridge.group.remove(this.fillLight2);
    this.bridge.group.remove(this.fillLight3);
    this.bridge.group.remove(this.exteriorLight);

    // Remove events
    this.canvas.removeEventListener("mousedown", this._onMouseDown);
    this.canvas.removeEventListener("mousemove", this._onMouseMove);
    this.canvas.removeEventListener("mouseup", this._onMouseUp);
    this.canvas.removeEventListener("wheel", this._onWheel);
    this.canvas.removeEventListener("click", this._onClick);
    window.removeEventListener("keydown", this._onKeyDown);

    // Remove DOM panel
    this.destroyPanel();

  }

  isActive(): boolean {
    return this._active;
  }

  getCamera(): THREE.PerspectiveCamera | null {
    return this._mode === "edit" ? this.editCamera : null;
  }

  getMode(): "game" | "edit" {
    return this._mode;
  }

  setMode(mode: "game" | "edit") {
    this._mode = mode;
    const isEdit = mode === "edit";

    // Show/hide helpers
    for (const e of this.editables) {
      if (e.helper) e.helper.visible = isEdit;
    }

    // Show/hide gizmo
    if (this.transformControls) {
      if (isEdit && this.selectedId) {
        const sel = this.editables.find(e => e.id === this.selectedId);
        if (sel) this.transformControls.attach(sel.object3D);
      } else {
        this.transformControls.detach();
      }
      this.transformControls.getHelper().visible = isEdit;
    }

    this.updatePanel();
  }

  update() {
    if (!this._active) return;

    if (this._mode === "edit") {
      // Smooth lerp orbit center toward target (selected object)
      this.orbitCenter.lerp(this.orbitTargetCenter, 0.08);
      this.updateOrbitCamera();

      // Update light helpers (PointLightHelper + DirectionalLightHelper)
      for (const e of this.editables) {
        if (e.helper && "update" in e.helper) {
          (e.helper as unknown as { update: () => void }).update();
        }
      }
    }
  }

  resize(aspect: number) {
    this.editCamera.aspect = aspect;
    this.editCamera.updateProjectionMatrix();
  }

  dispose() {
    this.deactivate();
    this.fillLight2.dispose();
    this.fillLight3.dispose();
    this.exteriorLight.dispose();
  }

  // ─── Editables Registry ───

  private buildEditables() {
    this.editables = [];

    // Main light
    const mainHelper = new THREE.PointLightHelper(this.bridge.bridgeLight, 0.5);
    this.scene.add(mainHelper);
    this.editables.push({
      id: "main-light",
      name: "Main Light",
      type: "light",
      object3D: this.bridge.bridgeLight,
      helper: mainHelper,
      color: "#" + this.bridge.bridgeLight.color.getHexString(),
    });

    // Fill light 2
    const fill2Helper = new THREE.PointLightHelper(this.fillLight2, 0.5);
    this.scene.add(fill2Helper);
    this.editables.push({
      id: "fill-light-2",
      name: "Fill 2",
      type: "light",
      object3D: this.fillLight2,
      helper: fill2Helper,
      color: "#" + this.fillLight2.color.getHexString(),
    });

    // Fill light 3
    const fill3Helper = new THREE.PointLightHelper(this.fillLight3, 0.5);
    this.scene.add(fill3Helper);
    this.editables.push({
      id: "fill-light-3",
      name: "Fill 3",
      type: "light",
      object3D: this.fillLight3,
      helper: fill3Helper,
      color: "#" + this.fillLight3.color.getHexString(),
    });

    // Exterior directional light (no bubble, small arrow helper)
    const extHelper = new THREE.DirectionalLightHelper(this.exteriorLight, 1, 0xaaccff);
    this.scene.add(extHelper);
    this.editables.push({
      id: "exterior-light",
      name: "Exterior",
      type: "dirlight",
      object3D: this.exteriorLight,
      helper: extHelper,
      color: "#aaccff",
    });

    // Bridge group
    const bridgeAxes = new THREE.AxesHelper(3);
    this.bridge.group.getWorldPosition(bridgeAxes.position);
    this.scene.add(bridgeAxes);
    this.editables.push({
      id: "bridge-group",
      name: "Bridge",
      type: "bridge",
      object3D: this.bridge.group,
      helper: bridgeAxes,
      color: "#ffffff",
    });
  }

  // ─── Selection ───

  private selectEditable(id: string | null) {
    this.selectedId = id;

    if (id && this.transformControls && this._mode === "edit") {
      const sel = this.editables.find(e => e.id === id);
      if (sel) {
        this.transformControls.attach(sel.object3D);
        // Focus orbit on selected object
        sel.object3D.getWorldPosition(this.orbitTargetCenter);
      }
    } else if (this.transformControls) {
      this.transformControls.detach();
    }

    this.updatePanel();
  }

  private cycleSelection() {
    if (this.editables.length === 0) return;
    const idx = this.editables.findIndex(e => e.id === this.selectedId);
    const next = (idx + 1) % this.editables.length;
    this.selectEditable(this.editables[next]!.id);
  }

  // ─── Orbit Camera ───

  private updateOrbitCamera() {
    const x = this.orbitCenter.x + this.orbitDistance * Math.cos(this.elevation) * Math.sin(this.azimuth);
    const y = this.orbitCenter.y + this.orbitDistance * Math.sin(this.elevation);
    const z = this.orbitCenter.z + this.orbitDistance * Math.cos(this.elevation) * Math.cos(this.azimuth);
    this.editCamera.position.set(x, y, z);
    this.editCamera.lookAt(this.orbitCenter);
  }

  // ─── Event Handlers ───

  private handleMouseDown(e: MouseEvent) {
    if (this._mode !== "edit" || !this.orbitEnabled) return;
    if (e.button !== 0) return;
    e.stopPropagation(); // Don't leak to CameraController / InputManager
    this.isDragging = true;
    this.wasDragged = false;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.canvas.style.cursor = "grabbing";
  }

  private handleMouseMove(e: MouseEvent) {
    if (!this.isDragging || this._mode !== "edit") return;
    e.stopPropagation(); // Don't leak orbit drags to game camera
    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    // Track total movement to distinguish drags from clicks
    if (Math.abs(e.clientX - this.dragStartX) > 3 || Math.abs(e.clientY - this.dragStartY) > 3) {
      this.wasDragged = true;
    }

    this.azimuth -= dx * 0.005;
    this.elevation += dy * 0.005;
    this.elevation = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.elevation));
  }

  private handleMouseUp(e: MouseEvent) {
    if (this._mode === "edit") e.stopPropagation();
    this.isDragging = false;
    this.canvas.style.cursor = this._mode === "edit" ? "grab" : "";
  }

  private handleWheel(e: WheelEvent) {
    if (this._mode !== "edit") return;
    e.preventDefault();
    e.stopPropagation();
    this.orbitDistance *= e.deltaY > 0 ? 1.08 : 0.92;
    this.orbitDistance = Math.max(2, Math.min(50, this.orbitDistance));
  }

  private handleClick(e: MouseEvent) {
    if (this._mode !== "edit") return;
    e.stopPropagation(); // Prevent any game-side click handling

    // Ignore clicks that were actually orbit drags (mouse moved >3px)
    if (this.wasDragged) return;

    // Ignore clicks that ended a gizmo drag (TransformControls "dragging-changed")
    if (this.wasGizmoDrag) {
      this.wasGizmoDrag = false;
      return;
    }

    // Still in gizmo drag — shouldn't happen, but guard
    if (!this.orbitEnabled) return;

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.editCamera);

    // Raycast against light helpers only (not bridge mesh — it's too large
    // and steals selection on nearly every click). Use the panel object list
    // or Tab key to select the bridge instead.
    const helpers = this.editables
      .filter(e => e.helper && e.type === "light")
      .map(e => e.helper!);

    const hits = this.raycaster.intersectObjects(helpers, true);
    if (hits.length > 0) {
      const hitObj = hits[0]!.object;
      for (const editable of this.editables) {
        if (!editable.helper) continue;
        let current: THREE.Object3D | null = hitObj;
        while (current) {
          if (current === editable.helper) {
            this.selectEditable(editable.id);
            return;
          }
          current = current.parent;
        }
      }
    }

    // Don't deselect on empty clicks — use Escape for that.
    // This prevents accidental deselection while working.
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (!this._active) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    // Consume all editor keys so they don't leak to InputManager
    // (W = thrust, E/R = strafe, etc.)
    switch (e.code) {
      case "KeyW":
        e.preventDefault(); e.stopPropagation();
        this.transformMode = "translate";
        this.transformControls?.setMode("translate");
        this.updatePanel();
        break;
      case "KeyE":
        e.preventDefault(); e.stopPropagation();
        this.transformMode = "rotate";
        this.transformControls?.setMode("rotate");
        this.updatePanel();
        break;
      case "KeyR":
        e.preventDefault(); e.stopPropagation();
        this.transformMode = "scale";
        this.transformControls?.setMode("scale");
        this.updatePanel();
        break;
      case "Tab":
        e.preventDefault(); e.stopPropagation();
        this.cycleSelection();
        break;
      case "KeyG":
        e.preventDefault(); e.stopPropagation();
        this.setMode(this._mode === "game" ? "edit" : "game");
        break;
      case "Escape":
        e.stopPropagation();
        this.selectEditable(null);
        break;
    }
  }

  // ─── Config Sync ───

  private syncSelectedToConfig() {
    const sel = this.editables.find(e => e.id === this.selectedId);
    if (!sel) return;

    if (sel.type === "light" && sel.id === "main-light") {
      // Sync main light position back to bridge entity
      const p = this.bridge.bridgeLight.position;
      this.bridge.lightX = p.x;
      this.bridge.lightY = p.y;
      this.bridge.lightZ = p.z;
    }
    // Fill lights 2 & 3 position stays on the PointLight object directly (no bridge sync needed)

    if (sel.type === "bridge") {
      // Sync bridge group position back to entity
      const p = this.bridge.group.position;
      this.bridge.settledX = p.x;
      this.bridge.settledY = p.y;
      this.bridge.settledZ = p.z;
    }
  }

  private exportConfig() {
    const mainPos = this.bridge.bridgeLight.position;
    const fill2Pos = this.fillLight2.position;
    const fill3Pos = this.fillLight3.position;

    const config = {
      bridge: {
        x: this.bridge.settledX,
        y: this.bridge.settledY,
        z: this.bridge.settledZ,
        scale: this.bridge.settledScale,
        rotY: this.bridge.settledRotY,
        slideZ: this.bridge.slideOffsetZ,
      },
      mainLight: {
        intensity: this.bridge.bridgeLight.intensity,
        color: "#" + this.bridge.bridgeLight.color.getHexString(),
        x: mainPos.x, y: mainPos.y, z: mainPos.z,
        distance: this.bridge.bridgeLight.distance,
      },
      fillLight2: {
        intensity: this.fillLight2.intensity,
        color: "#" + this.fillLight2.color.getHexString(),
        x: fill2Pos.x, y: fill2Pos.y, z: fill2Pos.z,
        distance: this.fillLight2.distance,
      },
      fillLight3: {
        intensity: this.fillLight3.intensity,
        color: "#" + this.fillLight3.color.getHexString(),
        x: fill3Pos.x, y: fill3Pos.y, z: fill3Pos.z,
        distance: this.fillLight3.distance,
      },
      exteriorLight: {
        intensity: this.exteriorLight.intensity,
        color: "#" + this.exteriorLight.color.getHexString(),
        x: this.exteriorLight.position.x,
        y: this.exteriorLight.position.y,
        z: this.exteriorLight.position.z,
      },
      material: {
        emissiveIntensity: this.bridge.emissiveIntensity,
      },
      camera: {
        lookUp: this.cameraController.bridgeLookUpOffset,
        fov: this.cameraController.bridgeFov,
        speed: this.cameraController.bridgeTransitionSpeed,
      },
    };

    const json = JSON.stringify(config, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json);
    }
  }

  // ─── DOM Panel ───

  private buildPanel() {
    this.destroyPanel();

    const panel = document.createElement("div");
    panel.className = "bridge-editor-panel";
    panel.id = "bridge-editor-panel";

    // Prevent clicks on panel from propagating to canvas
    panel.addEventListener("mousedown", e => e.stopPropagation());
    panel.addEventListener("click", e => e.stopPropagation());

    panel.innerHTML = this.renderPanelHTML();
    document.body.appendChild(panel);
    this.panel = panel;

    this.attachPanelEvents();
  }

  private destroyPanel() {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
  }

  private updatePanel() {
    if (!this.panel) return;
    this.panel.innerHTML = this.renderPanelHTML();
    this.attachPanelEvents();
  }

  private renderPanelHTML(): string {
    const sel = this.editables.find(e => e.id === this.selectedId);
    const isEdit = this._mode === "edit";

    let html = "";

    // Header
    html += `<div class="be-header">
      <span>BRIDGE EDITOR</span>
      <span class="be-close" data-action="close">✕</span>
    </div>`;

    // Mode toggle
    html += `<div class="be-mode-row">
      <button class="be-mode-btn ${isEdit ? "active" : ""}" data-action="mode-edit">EDIT</button>
      <button class="be-mode-btn ${!isEdit ? "active" : ""}" data-action="mode-game">GAME</button>
    </div>`;

    // Object list
    html += `<div class="be-object-list">`;
    for (const e of this.editables) {
      const isSelected = e.id === this.selectedId;
      html += `<div class="be-object-item ${isSelected ? "selected" : ""}" data-select="${e.id}">
        <span class="be-color-dot" style="background:${e.color}"></span>
        <span>${e.name}</span>
      </div>`;
    }
    html += `</div>`;

    // Transform mode (edit mode only)
    if (isEdit) {
      html += `<div class="be-transform-row">
        <button class="be-transform-btn ${this.transformMode === "translate" ? "active" : ""}" data-action="mode-translate">W Move</button>
        <button class="be-transform-btn ${this.transformMode === "rotate" ? "active" : ""}" data-action="mode-rotate">E Rot</button>
        <button class="be-transform-btn ${this.transformMode === "scale" ? "active" : ""}" data-action="mode-scale">R Scale</button>
      </div>`;
    }

    // Selected object properties
    html += `<div class="be-props">`;
    if (sel) {
      if (sel.type === "light") {
        const light = sel.object3D as THREE.PointLight;
        html += this.renderSlider("Intensity", "intensity", light.intensity, 0, 200, 0.5);
        html += this.renderColorInput("Color", "color", "#" + light.color.getHexString());
        html += this.renderSlider("Falloff", "distance", light.distance, 1, 200, 0.5);
        html += this.renderSlider("Decay", "decay", light.decay, 0, 5, 0.1);
        html += `<div class="be-section-label">Position</div>`;
        html += this.renderSlider("X", "posX", light.position.x, -20, 20, 0.1);
        html += this.renderSlider("Y", "posY", light.position.y, -20, 20, 0.1);
        html += this.renderSlider("Z", "posZ", light.position.z, -20, 20, 0.1);
      } else if (sel.type === "dirlight") {
        const light = sel.object3D as THREE.DirectionalLight;
        html += this.renderSlider("Intensity", "intensity", light.intensity, 0, 50, 0.1);
        html += this.renderColorInput("Color", "color", "#" + light.color.getHexString());
        html += `<div class="be-section-label">Direction (position)</div>`;
        html += this.renderSlider("X", "posX", light.position.x, -20, 20, 0.1);
        html += this.renderSlider("Y", "posY", light.position.y, -20, 20, 0.1);
        html += this.renderSlider("Z", "posZ", light.position.z, -20, 20, 0.1);
      } else if (sel.type === "bridge") {
        html += this.renderSlider("Scale", "scale", this.bridge.settledScale, 0.1, 3, 0.05);
        html += this.renderSlider("Heading", "heading", this.bridge.settledRotY, -Math.PI, Math.PI, 0.01);
        html += `<div class="be-section-label">Position</div>`;
        html += this.renderSlider("X", "posX", this.bridge.settledX, -20, 20, 0.1);
        html += this.renderSlider("Y", "posY", this.bridge.settledY, -20, 20, 0.1);
        html += this.renderSlider("Z", "posZ", this.bridge.settledZ, -20, 20, 0.1);
      }
    } else {
      html += `<div style="color:#4a5a68;padding:8px 0;text-align:center">Click an object to select</div>`;
    }

    // Material section (always visible)
    html += `<div class="be-section-label">Material</div>`;
    html += this.renderSlider("Glow", "emissive", this.bridge.emissiveIntensity, 0, 2, 0.05);

    html += `</div>`; // end be-props

    // Export
    html += `<div class="be-footer">
      <button class="be-export-btn" data-action="export">EXPORT JSON</button>
    </div>`;

    // Key hints
    html += `<div class="be-hints">
      <span class="be-hint-key">G</span> toggle view
      <span class="be-hint-key">Tab</span> cycle
      <span class="be-hint-key">Esc</span> deselect
    </div>`;

    return html;
  }

  private renderSlider(label: string, key: string, value: number, min: number, max: number, step: number): string {
    return `<div class="be-prop-row">
      <span class="be-prop-label">${label}</span>
      <input type="range" class="be-prop-slider" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}">
      <span class="be-prop-value">${value.toFixed(step < 0.1 ? 2 : 1)}</span>
    </div>`;
  }

  private renderColorInput(label: string, key: string, value: string): string {
    return `<div class="be-prop-row">
      <span class="be-prop-label">${label}</span>
      <input type="color" class="be-prop-color" data-key="${key}" value="${value}">
      <span class="be-prop-value">${value}</span>
    </div>`;
  }

  private attachPanelEvents() {
    if (!this.panel) return;

    // Action buttons
    this.panel.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = (el as HTMLElement).dataset.action;
        switch (action) {
          case "close": this.deactivate(); break;
          case "mode-edit": this.setMode("edit"); break;
          case "mode-game": this.setMode("game"); break;
          case "mode-translate":
            this.transformMode = "translate";
            this.transformControls?.setMode("translate");
            this.updatePanel();
            break;
          case "mode-rotate":
            this.transformMode = "rotate";
            this.transformControls?.setMode("rotate");
            this.updatePanel();
            break;
          case "mode-scale":
            this.transformMode = "scale";
            this.transformControls?.setMode("scale");
            this.updatePanel();
            break;
          case "export": this.exportConfig(); break;
        }
      });
    });

    // Object selection
    this.panel.querySelectorAll("[data-select]").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.select!;
        this.selectEditable(id);
      });
    });

    // Sliders
    this.panel.querySelectorAll(".be-prop-slider").forEach(el => {
      el.addEventListener("input", (e) => {
        e.stopPropagation();
        const input = e.target as HTMLInputElement;
        const key = input.dataset.key!;
        const value = parseFloat(input.value);
        this.handleSliderChange(key, value);
        // Update value display
        const valueSpan = input.nextElementSibling;
        if (valueSpan) {
          const step = parseFloat(input.step);
          valueSpan.textContent = value.toFixed(step < 0.1 ? 2 : 1);
        }
      });
    });

    // Color inputs
    this.panel.querySelectorAll(".be-prop-color").forEach(el => {
      el.addEventListener("input", (e) => {
        e.stopPropagation();
        const input = e.target as HTMLInputElement;
        const key = input.dataset.key!;
        this.handleColorChange(key, input.value);
        const valueSpan = input.nextElementSibling;
        if (valueSpan) valueSpan.textContent = input.value;
      });
    });
  }

  private handleSliderChange(key: string, value: number) {
    const sel = this.editables.find(e => e.id === this.selectedId);

    if (key === "emissive") {
      // Baked brightness — with MeshBasicMaterial, we use material.color as a multiplier.
      // White (1,1,1) = full bake brightness. Lower = dimmer. Higher = overexposed.
      this.bridge.emissiveIntensity = value;
      for (const mat of this.bridge.bakedMaterials) {
        if ("color" in mat && (mat as THREE.MeshBasicMaterial).color) {
          (mat as THREE.MeshBasicMaterial).color.setScalar(value);
        }
      }
      return;
    }

    if (!sel) return;

    if (sel.type === "light") {
      const light = sel.object3D as THREE.PointLight;
      switch (key) {
        case "intensity": light.intensity = value; break;
        case "distance": light.distance = value; break;
        case "decay": light.decay = value; break;
        case "posX": light.position.x = value; break;
        case "posY": light.position.y = value; break;
        case "posZ": light.position.z = value; break;
      }
      // Sync main light back to bridge entity
      if (sel.id === "main-light") {
        this.bridge.lightIntensity = light.intensity;
        this.bridge.lightX = light.position.x;
        this.bridge.lightY = light.position.y;
        this.bridge.lightZ = light.position.z;
      }
    } else if (sel.type === "dirlight") {
      const light = sel.object3D as THREE.DirectionalLight;
      switch (key) {
        case "intensity": light.intensity = value; break;
        case "posX": light.position.x = value; break;
        case "posY": light.position.y = value; break;
        case "posZ": light.position.z = value; break;
      }
    } else if (sel.type === "bridge") {
      switch (key) {
        case "scale":
          this.bridge.settledScale = value;
          this.bridge.group.scale.setScalar(value);
          break;
        case "heading":
          this.bridge.settledRotY = value;
          this.bridge.group.rotation.set(this.bridge.settledRotX, value, 0);
          break;
        case "posX":
          this.bridge.settledX = value;
          this.bridge.group.position.x = value;
          break;
        case "posY":
          this.bridge.settledY = value;
          this.bridge.group.position.y = value;
          break;
        case "posZ":
          this.bridge.settledZ = value;
          this.bridge.group.position.z = value;
          break;
      }
    }
  }

  private handleColorChange(key: string, value: string) {
    if (key !== "color") return;
    const sel = this.editables.find(e => e.id === this.selectedId);
    if (!sel || (sel.type !== "light" && sel.type !== "dirlight")) return;
    const light = sel.object3D as THREE.PointLight | THREE.DirectionalLight;
    light.color.set(value);
    sel.color = value;
  }
}
