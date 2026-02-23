/** Keyboard input manager for the game */

export interface InputState {
  thrustForward: boolean;
  thrustReverse: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  fire: boolean;
  target: boolean;
  map: boolean;
}

export class InputManager {
  private keys = new Set<string>();
  private _enabled = true;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this._enabled) return;
    // Don't capture keys when typing in input fields
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    this.keys.add(e.code);
    // Prevent default for game keys to avoid page scrolling
    if (
      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
        e.code,
      )
    ) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
  };

  get state(): InputState {
    return {
      thrustForward: this.keys.has("ArrowUp") || this.keys.has("KeyW"),
      thrustReverse: this.keys.has("ArrowDown") || this.keys.has("KeyS"),
      rotateLeft: this.keys.has("ArrowLeft") || this.keys.has("KeyA"),
      rotateRight: this.keys.has("ArrowRight") || this.keys.has("KeyD"),
      fire: this.keys.has("Space"),
      target: this.keys.has("KeyT"),
      map: this.keys.has("KeyM"),
    };
  }

  set enabled(value: boolean) {
    this._enabled = value;
    if (!value) this.keys.clear();
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }
}
