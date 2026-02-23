# Engine

The engine layer is a pure Three.js game engine with no React dependencies. It manages the 3D scene, game loop, entities, and all rendering subsystems.

## Architecture

`Engine.ts` is the central orchestrator. It creates the Three.js renderer, scene, and camera, then instantiates and coordinates all subsystems and entities. React interacts with the engine through a thin bridge (`GameCanvas.tsx`) that forwards commands and receives state updates.

### Subsystems (`systems/`)

Each subsystem is a standalone class instantiated by the Engine constructor:

| System              | File                  | Responsibility                                                         |
| ------------------- | --------------------- | ---------------------------------------------------------------------- |
| **LightingSetup**   | `LightingSetup.ts`    | Manages 5 scene lights (ambient, hemisphere, key, fill, rim) and delegates material/background config updates. |
| **NpcManager**      | `NpcManager.ts`       | Spawns NPC ships around planets, runs their AI state machines, performs scanner cone detection, triggers sound pings on new contacts. |
| **DebugBeam**       | `DebugBeam.ts`        | Renders a red ray from the player ship forward direction with a hit marker sphere and yellow hit-radius circle around the target NPC. Toggle with `B` key. |
| **OrbitControls**   | `OrbitControls.ts`    | Mouse-driven orbit controls for the debug orbit camera view. Handles drag rotation and scroll zoom. |
| **CameraController**| `CameraController.ts` | Manages multiple camera modes: top-down orthographic, side view, isometric, and a perspective orbit debug camera. |
| **InputManager**    | `InputManager.ts`     | Captures keyboard and pointer input. Tracks which keys are held, pointer position, and provides a clean API for the game loop. |
| **ModelCache**      | `ModelCache.ts`       | Loads and caches GLTF models and textures from CDN. Returns cloned meshes so multiple entities can share geometry without re-fetching. |
| **NebulaBg**        | `NebulaBg.ts`         | Layered background: a CDN starfield image plus a procedurally generated nebula overlay. Both render on quads behind the scene. |
| **PlanetTextureGen**| `PlanetTextureGen.ts` | Generates planet surface textures using Perlin noise on a canvas. Produces unique color palettes per planet. |
| **SoundManager**    | `SoundManager.ts`     | Handles audio playback for scanner ping and thruster sounds. Manages Web Audio API context. |
| **Starfield**       | `Starfield.ts`        | Renders a static field of point stars using Three.js Points geometry. |

### Entities (`entities/`)

| Entity    | File         | Description                                                                      |
| --------- | ------------ | -------------------------------------------------------------------------------- |
| **Ship**  | `Ship.ts`    | The player ship. Loads a GLTF model, applies physics (thrust, drag, rotation), renders a Fresnel energy shield, and exposes state for the HUD. |
| **Planet**| `Planet.ts`  | A procedurally textured sphere with an atmosphere shell. Placed at fixed positions in the scene. |
| **NpcShip**| `NpcShip.ts`| AI-controlled ships with a state machine: APPROACHING, DOCKING, DOCKED, DEPARTING, DONE. Each NPC has a Fresnel energy shield rendered with custom GLSL shaders. |

### Shaders (`shaders/`)

| Shader           | File              | Description                                                          |
| ---------------- | ----------------- | -------------------------------------------------------------------- |
| **Shield GLSL**  | `shield.glsl.ts`  | Fresnel energy shield with hit-point dissipation. Makes edges glow bright and flat faces nearly invisible. A "hit point" radiates energy outward with configurable oval shape and falloff. |

## Game Loop

The engine runs a `requestAnimationFrame` loop in `Engine.ts`:

1. **Compute delta time** from the previous frame.
2. **Update ship physics** -- apply thrust, drag, and rotation based on current input.
3. **Update planets** -- rotate each planet on its axis.
4. **Update NPCs** -- advance each NPC's state machine, update positions, remove completed NPCs, spawn new ones.
5. **Update camera** -- follow the player ship based on the active camera mode.
6. **Update starfield** -- reposition stars relative to the camera.
7. **Update nebula background** -- parallax offset based on camera position.
8. **Update debug beam** -- if enabled, cast a ray forward and visualize intersections.
9. **Render** the scene.
10. **Push state to React** -- at ~20fps (every 3 frames), serialize the current game state (position, speed, hull, shield, fuel, radar contacts, FPS) and invoke the subscribe callback so React can update the HUD.

## Ship Catalog

`ShipCatalog.ts` defines 5 playable ships, each with a unique GLTF model URL, display name, stats (speed, hull, shields), and color variants. The catalog is a plain TypeScript array consumed by both the engine (for model loading) and React (for the ship selector UI).

## Adding a New System

1. Create a new class in `systems/` (e.g., `systems/MySystem.ts`).
2. Import and instantiate it in the `Engine` constructor, passing whatever dependencies it needs (scene, ship, etc.).
3. Call its `update(dt)` method in the game loop at the appropriate point.
4. Add a `dispose()` method to clean up Three.js objects and event listeners.
5. Call `dispose()` from `Engine.dispose()`.

Example skeleton:

```typescript
import * as THREE from "three";

export class MySystem {
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(dt: number): void {
    // per-frame logic
  }

  dispose(): void {
    // remove meshes, listeners, etc.
  }
}
```
