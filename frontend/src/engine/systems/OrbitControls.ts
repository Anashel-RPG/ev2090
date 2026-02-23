import type { CameraController } from "./CameraController";

/**
 * Mouse-driven orbit controls for the debug orbit camera view.
 * Handles mousedown, mousemove, mouseup, and wheel events.
 */
export class OrbitControls {
  private canvas: HTMLCanvasElement;
  private cameraController: CameraController;

  private orbitDragging = false;
  private orbitLastX = 0;
  private orbitLastY = 0;
  private orbitTargetId: string | null = null;

  constructor(canvas: HTMLCanvasElement, cameraController: CameraController) {
    this.canvas = canvas;
    this.cameraController = cameraController;
  }

  /** Attach mouse/wheel event listeners to the canvas */
  attach() {
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  /** Remove all event listeners */
  dispose() {
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
  }

  getTargetId(): string | null {
    return this.orbitTargetId;
  }

  setTargetId(id: string | null) {
    this.orbitTargetId = id;
  }

  handleMouseDown = (e: MouseEvent) => {
    if (this.cameraController.getDebugView() !== "orbit") return;
    this.orbitDragging = true;
    this.orbitLastX = e.clientX;
    this.orbitLastY = e.clientY;
    this.canvas.style.cursor = "grabbing";
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    e.preventDefault();
  };

  handleMouseMove = (e: MouseEvent) => {
    if (!this.orbitDragging) return;
    const dx = e.clientX - this.orbitLastX;
    const dy = e.clientY - this.orbitLastY;
    this.orbitLastX = e.clientX;
    this.orbitLastY = e.clientY;
    this.cameraController.handleOrbitDrag(dx, dy);
  };

  handleMouseUp = () => {
    this.orbitDragging = false;
    this.canvas.style.cursor =
      this.cameraController.getDebugView() === "orbit" ? "grab" : "";
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
  };

  handleWheel = (e: WheelEvent) => {
    if (this.cameraController.getDebugView() !== "orbit") return;
    e.preventDefault();
    this.cameraController.handleOrbitZoom(e.deltaY);
  };
}
