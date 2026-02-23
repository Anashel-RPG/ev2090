# Engine Guide

Deep-dive documentation for the EV · 2090 3D engine layer.

---

## Mental Model

Think of the engine as a self-contained simulation. It knows nothing about React, DOM, or HTML. It takes a canvas element and runs a game loop on it. The engine produces a serialized `GameState` object every few frames and pushes it to a callback; React reads that state and renders the HUD. All Three.js scene management, physics, NPC AI, and audio live inside the engine. React never touches the scene graph directly.

---

## Engine.ts -- The Core

`Engine` is the single entry point. It owns the renderer, scene, camera system, all 11 subsystems, and all entities.

### Constructor

`new Engine(canvas, container)` performs the full initialization sequence:

1. **WebGL2 context** -- creates a WebGL2 rendering context manually (to set `UNPACK_FLIP_Y_WEBGL` before Three.js touches it), then hands it to `THREE.WebGLRenderer`.
2. **Renderer** -- sized to the container, pixel ratio capped at 2, clear color `#05050a`.
3. **Scene** -- a single `THREE.Scene` shared by everything.
4. **LightingSetup** -- adds ambient, hemisphere, key, fill, and rim lights to the scene.
5. **CameraController** -- orthographic camera with a 40-unit vertical view size.
6. **InputManager** -- keyboard listener (`WASD` / arrows / space).
7. **Starfield** -- five parallax layers of point sprites.
8. **NebulaBg** -- two-layer deep-space background (CDN image + procedural nebula).
9. **Ship** (player) -- GLTF model loaded via `ModelCache`, tilted -22 degrees.
10. **NpcManager** -- spawns and updates NPC traffic.
11. **DebugBeam** -- optional scan-beam visualization.
12. **OrbitControls** -- mouse-driven orbit for the debug camera.
13. **Planets** -- four planets (Nexara, Velkar, Zephyra, Arctis) with procedural or file textures.
14. **Preloads** -- `ModelCache.preloadModels()` for all ship GLTFs; `SoundManager.preload()` for thruster and ping sounds.
15. **Event listeners** -- `resize` and debug key (`B` toggles beam).
16. **Starts the loop** immediately.

### subscribe(callback)

React calls `engine.subscribe(fn)` once after construction. The engine stores the callback and invokes it with a fresh `GameState` snapshot every 3rd frame.

### loop(time)

The `requestAnimationFrame` loop runs at the display refresh rate (typically 60 fps). Each tick:

1. Compute `dt` (clamped to 50 ms to survive tab-away spikes).
2. Update FPS counter (resets every second).
3. `ship.update(dt, input.state)` -- physics and thruster visuals.
4. `planet.update(dt)` for each planet -- rotation.
5. `npcManager.update(dt, ship, planets)` -- NPC AI, scanner cone, ray-circle hit tests. Returns player forward direction and position.
6. `debugBeam.update(...)` -- renders the beam line and hit marker if visible.
7. `updateThrusterSound()` -- starts/stops the thruster audio loop.
8. `cameraController.setTarget(...)` then `cameraController.update()` -- smooth follow.
9. If orbit mode: track the locked NPC or fall back to the player position.
10. `starfield.update(...)` -- parallax repositioning.
11. `nebulaBg.update(...)` -- keeps layers centered on camera.
12. `renderer.render(scene, camera)`.
13. Every 3rd frame: serialize `GameState` and invoke the subscriber callback.

### State Push

`getGameState()` builds a plain object containing:

- `ship` -- spread copy of `ShipState` (position, velocity, rotation, thrust, shields, armor, fuel).
- `navigation` -- system name, rounded coordinates, nearest planet name and distance.
- `radarContacts` -- combined list of planets + NPC ships.
- `fps`, `currentShipId`, `currentShipColor`.

### dispose()

Tears down everything in reverse order: cancels `requestAnimationFrame`, removes event listeners, disposes orbit controls, input manager, starfield, nebula, ship, each planet, NPC manager, debug beam, sound manager, and the WebGL renderer.

---

## Subsystems (systems/)

### 1. InputManager

**Purpose:** Captures keyboard input and exposes a reactive `InputState` object consumed by `Ship.update()`.

**Key public API:**
- `state` (getter) -- returns `{ thrustForward, thrustReverse, rotateLeft, rotateRight, fire, target, map }`.
- `enabled` (setter) -- disables capture and clears pressed keys.
- `dispose()` -- removes all window event listeners.

**Dependencies:** None (standalone, listens to `window`).

### 2. LightingSetup

**Purpose:** Creates and manages all scene lights (ambient, hemisphere, key, fill, rim) and acts as a router for the config panel, dispatching property updates to lights, ship tilt, model rotation, background opacity, and NPC shield parameters.

**Key public API:**
- `setShip(ship)`, `setNebulaBg(nebulaBg)` -- wires references after construction.
- `getLightConfig()` -- returns a `LightConfig` snapshot for the debug panel.
- `updateLight(lightName, property, value)` -- routes updates. Special handlers for `"shipTilt"`, `"modelRotation"`, `"background"`, and `"scanOutline"`.
- `updateShipMaterial(property, value)` -- forwards metalness/roughness/emissive changes to the ship.

**Dependencies:** `THREE.Scene`, references to `Ship` and `NebulaBg`.

### 3. NpcManager

**Purpose:** Spawns NPC ships that fly to planets, dock, wait, depart, and despawn. Runs scanner-cone detection and ray-circle hit-point math for the shield shader.

**Key public API:**
- `update(dt, ship, planets)` -- main tick. Returns `{ fwdX, fwdY, px, py }` for the debug beam.
- `getNpcs()` -- read-only list of active `NpcShip` instances.
- `getRadarContacts()` -- returns radar-friendly summaries.
- `spawnTestShip(ship)`, `spawnTestRing(ship)`, `clearTestShips()` -- debug helpers.
- `dispose()` -- cleans up all NPCs.

**Dependencies:** `THREE.Scene`, `NpcShip`, `SoundManager`, `ShipCatalog`.

**Key constants:** `RADAR_RANGE = 300`, `SCANNER_HALF_ANGLE = 30 deg`, `MAX_NPCS = 4`, `NPC_SPAWN_INTERVAL = 6s`.

### 4. DebugBeam

**Purpose:** Renders a visible red ray from the player ship in the forward direction, with a hit-marker sphere and a yellow hit-radius circle around the nearest scanned NPC. Toggled with the `B` key or the config panel.

**Key public API:**
- `setVisible(visible)`, `isVisible()`.
- `update(playerX, playerY, fwdX, fwdY, npcs)` -- finds nearest scanned NPC hit, draws beam and markers.
- `removeVisuals()` -- disposes all Three.js objects.

**Dependencies:** `THREE.Scene`, reads `NpcShip.hitRadius` static.

### 5. CameraController

**Purpose:** Manages an orthographic camera (normal gameplay) and a perspective camera (debug views). Smoothly interpolates toward the player ship with configurable smoothing, sidebar offset, zoom, and manual offset.

**Key public API:**
- `getActiveCamera()` -- returns ortho or perspective depending on debug view.
- `setTarget(x, y)`, `update()` -- smooth follow each frame.
- `setDebugView(view)` -- switches between `"normal"`, `"side"`, `"iso"`, `"iso-r"`, `"orbit"`.
- `setSidebarOffset(worldUnits)` -- shifts ortho camera to center the ship in the playable area.
- `setZoom(factor)`, `setManualOffset(x, y)` -- debug tuning.
- `handleOrbitDrag(dx, dy)`, `handleOrbitZoom(delta)` -- orbit mode input.
- `resize(width, height)` -- recalculates frustum.

**Dependencies:** None (standalone Three.js cameras).

### 6. OrbitControls

**Purpose:** Mouse-driven orbit controls for the debug orbit camera view. Handles drag-to-rotate and scroll-to-zoom, delegating to `CameraController`.

**Key public API:**
- `attach()` -- binds mouse/wheel listeners to the canvas.
- `dispose()` -- removes all listeners.
- `getTargetId()`, `setTargetId(id)` -- which NPC to orbit around (null = player).

**Dependencies:** `HTMLCanvasElement`, `CameraController`.

### 7. Starfield

**Purpose:** Five-layer parallax starfield. Each layer has different point counts, sizes, speeds, and colors -- from dense distant dust (3000 points, speed 0.10) to rare bright stars (40 points, speed 0.65).

**Key public API:**
- `update(cameraX, cameraY)` -- repositions all stars with parallax wrapping.
- `dispose()` -- removes all layers from the scene.

**Dependencies:** `THREE.Scene`.

### 8. NebulaBg

**Purpose:** Two-layer deep-space background. Layer 1 is a CDN image (Eve Online-style nebula photo, opacity 0.13). Layer 2 is a procedural noise nebula generated on an HTML Canvas (2048x2048, opacity 0.10, slight parallax at 0.08).

**Key public API:**
- `group` (readonly) -- add this to the scene.
- `update(cameraX, cameraY)` -- keeps layers centered/near-centered on camera.
- `setImageOpacity(v)`, `setNebulaOpacity(v)`, `getImageOpacity()`, `getNebulaOpacity()`.
- `dispose()`.

**Dependencies:** None (standalone).

### 9. PlanetTextureGen

**Purpose:** Generates procedural equirectangular planet textures (512x256 px) using multi-octave value noise on an HTML Canvas. Supports four planet types: `mars`, `neptune`, `luna`, `terran`.

**Key public API:**
- `generatePlanetTexture(type)` -- returns an `HTMLCanvasElement` ready to be used as a Three.js `CanvasTexture`.

**Dependencies:** None (pure function, no Three.js imports).

### 10. ModelCache

**Purpose:** Singleton cache for GLTF models and textures. Prevents re-parsing GLTFs and re-compiling shaders on every ship spawn. Models are loaded once, then cloned with independent materials for each instance.

**Key public API:**
- `preloadModels(paths)` -- batch preload, returns a Promise.
- `getClone(modelPath)` -- instant clone from cache (null if not loaded).
- `getCloneAsync(modelPath, callback, errorCallback?)` -- loads if needed, then clones.
- `loadTexture(path)` -- cached texture loading with GLTF-compatible settings.
- `applyTexture(model, texturePath, opts)` -- loads a texture and applies it with PBR settings.

**Dependencies:** `THREE`, `GLTFLoader`.

### 11. SoundManager

**Purpose:** Lightweight audio manager using `HTMLAudioElement` (no Web Audio API). Supports one-shot sounds with cooldown and looping sounds. Handles preloading and failure tracking.

**Key public API:**
- `preload(url)` -- download into browser cache.
- `playOnce(url, volume, cooldownMs)` -- one-shot with de-duplication.
- `startLoop(url, volume)`, `stopLoop(url)` -- looping playback.
- `isLooping(url)`.
- `dispose()` -- pauses and releases all audio elements.

**Dependencies:** None (browser `Audio` API).

---

## Entities (entities/)

### Ship.ts -- Player Ship

The player ship is a GLTF model (Quaternius spaceship pack) loaded via `ModelCache` with a UV-mapped color texture.

**Physics model:**
- `SHIP_THRUST = 30`, `SHIP_ROTATION_SPEED = 3.5 rad/s`, `SHIP_MAX_SPEED = 80`, `SHIP_DRAG = 0.005`, `SHIP_BRAKE_FACTOR = 0.03`.
- Thrust applies acceleration in the ship's forward direction. Drag is constant (not proportional to speed). Braking multiplies velocity by `(1 - 0.03)` per frame.
- Speed is hard-capped at 80. Fuel depletes slowly during thrust.

**Thruster visuals:** Two `PlaneGeometry` meshes (core and outer flame) with canvas-generated radial-gradient textures and additive blending. A `PointLight` adds glow. Opacity and scale animate based on thrust intensity with random flicker.

**GLTF orientation:** `Rx(+PI/2) * Ry(PI)` maps Blender's Z-forward/Y-up to the game's XY plane.

**Key public API:**
- `update(dt, input)` -- physics + visual sync.
- `setTilt(radians)` -- perspective tilt on X axis.
- `changeTexture(texturePath)` -- hot-swap color without reloading the model.
- `updateMaterial(property, value)` -- debug tuning of metalness/roughness/emissive.
- `position` (getter), `speed` (getter).
- `dispose()` -- disposes cloned materials only.

### Planet.ts -- Planets

Each planet is a `THREE.SphereGeometry` with either a file texture, a procedurally generated canvas texture, or a solid color fallback.

**Atmosphere:** A slightly larger sphere (radius * 1.12) with a custom Fresnel shader. The vertex shader computes the view direction; the fragment shader raises `(1 - dot(viewDir, normal))` to the 3rd power and multiplies by a configurable color and intensity. Uses additive blending.

**Key public API:**
- `update(dt)` -- rotates the sphere on its Z axis.
- `distanceTo(point)` -- Euclidean distance from a world position to the planet center.
- `dispose()`.

**Data:** `name`, `position` (Vec2), `radius`.

### NpcShip.ts -- NPC Ships

NPC ships follow a five-state machine: `APPROACHING -> DOCKING -> DOCKED -> DEPARTING -> DONE`.

**APPROACHING:** Flies toward a randomly chosen planet with curved approach (perpendicular drift for natural flight lines). Speed decelerates as it nears the planet. Heading smoothly lerps toward the target.

**DOCKING:** Smooth deceleration to zero using smoothstep easing. Snaps to the planet surface at sub-pixel threshold (0.01 units).

**DOCKED:** Timer runs for 3-10 seconds (random).

**DEPARTING:** Picks a random departure angle, rotates toward it over 2 seconds, accelerates to 30 units/s. Marked DONE when 200 units from spawn.

**Shield shader:** Each NPC has a clone of the ship model rendered with the Fresnel shield `ShaderMaterial`. The shield is only visible when the scan beam ray-circle intersection hits this NPC (not just when in the scanner cone). Opacity fades in at 6.0/s and fades out at 3.3/s.

**Static config (shared across all NPCs, tunable via config panel):**
- `shieldScale`, `fresnelPow`, `dissipation`, `ovalX`, `ovalY`, `baseOpacity`, `hitOpacity`, `hitRadius`, `colorR/G/B`.

---

## Shaders (shaders/)

### shield.glsl.ts -- Fresnel Shield

A slightly-larger clone of the ship mesh rendered as a transparent energy shell.

**Vertex shader:**
- Expands each vertex by `(1.0 + u_scale)` to form the shell.
- Computes world position, world normal, and view direction (camera to fragment).

**Fragment shader:**
- Fresnel: `pow(1.0 - abs(dot(viewDir, normal)), u_fresnelPow)`. Edges glow bright; flat faces are nearly invisible.
- Hit-point dissipation: `exp(-length(delta) * u_dissipation)` where `delta` is the oval-stretched distance from the fragment to the hit point.
- Combines: `intensity = u_baseOpacity + hitFactor * u_hitOpacity`. Final alpha = `fresnel * intensity * u_opacity`.

**Key uniforms:**

| Uniform | Type | Purpose |
|---------|------|---------|
| `u_scale` | float | Shield expansion factor (0.315 default) |
| `u_fresnelPow` | float | Fresnel exponent (0.1 default, higher = thinner edge) |
| `u_opacity` | float | Overall opacity, animated by scan fade |
| `u_color` | vec3 | Shield RGB color |
| `u_hitPoint` | vec2 | World XY where beam hits the shield |
| `u_dissipation` | float | Falloff rate from hit point |
| `u_ovalX` | float | Horizontal stretch of dissipation |
| `u_ovalY` | float | Vertical stretch of dissipation |
| `u_baseOpacity` | float | Subtle always-visible glow (0-0.5) |
| `u_hitOpacity` | float | Max brightness at hit location (0-1) |

---

## ShipCatalog.ts

An array of 11 `ShipDef` objects consumed by both the engine (NPC spawning, model loading) and React (ship selector UI, diagnostic panel).

Each definition contains:
- `id` -- unique key (e.g. `"striker"`, `"bob"`, `"challenger"`).
- `name` -- display name (matches the GLTF filename).
- `class` -- ship class (INTERCEPTOR, UTILITY, ASSAULT, COURIER, FRIGATE, CAPITAL, RAIDER, RECON, PATROL, FIGHTER, EXPLORER).
- `modelPath` -- path to the GLTF file.
- `texturePath` -- default Blue texture path.
- `stats` -- `{ speed, armor, cargo, firepower }` each 1-10.
- `extraTextures` (optional) -- custom skins beyond the standard 5 colors (e.g. Challenger has a "Fire" texture).

Helper: `getShipDef(id)` returns the definition by id.

---

## How-tos

### How to Add a New System

1. Create `frontend/src/engine/systems/MySystem.ts`:

```ts
import * as THREE from "three";

export class MySystem {
  constructor(scene: THREE.Scene) {
    // Add objects to the scene
  }

  update(dt: number) {
    // Called every frame from Engine.loop()
  }

  dispose() {
    // Remove objects and free resources
  }
}
```

2. In `Engine.ts`:
   - Import the system.
   - Add a private field: `private mySystem: MySystem;`.
   - Instantiate in the constructor: `this.mySystem = new MySystem(this.scene);`.
   - Call `this.mySystem.update(dt)` at the appropriate point in `loop()`.
   - Call `this.mySystem.dispose()` in `dispose()`.

3. If the system needs to communicate state to React, add its data to `getGameState()` and extend the `GameState` type in `types/game.ts`.

### How to Add a New Entity

1. Create `frontend/src/engine/entities/MyEntity.ts`:

```ts
import * as THREE from "three";
import type { Vec2 } from "@/types/game";

export class MyEntity {
  mesh: THREE.Group;
  position: Vec2;

  constructor(config: { /* ... */ }) {
    this.mesh = new THREE.Group();
    this.position = { x: 0, y: 0 };
    // Load model, create geometry, etc.
  }

  update(dt: number) {
    // Per-frame logic
    this.mesh.position.set(this.position.x, this.position.y, 10);
  }

  dispose() {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
  }
}
```

2. In `Engine.ts`:
   - Instantiate and `scene.add(entity.mesh)`.
   - Call `entity.update(dt)` in the loop.
   - Include entity data in `getGameState()` if React needs it.
   - Call `scene.remove(entity.mesh)` and `entity.dispose()` in `dispose()`.

### How to Add a New Shader

1. Create `frontend/src/engine/shaders/myeffect.glsl.ts`:

```ts
export const MY_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

export const MY_FRAGMENT = /* glsl */ `
uniform float u_intensity;
uniform vec3  u_color;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  float effect = /* your math here */;
  gl_FragColor = vec4(u_color, effect * u_intensity);
}
`;
```

2. In your entity or system, create a `THREE.ShaderMaterial`:

```ts
import { MY_VERTEX, MY_FRAGMENT } from "../shaders/myeffect.glsl";

const material = new THREE.ShaderMaterial({
  vertexShader: MY_VERTEX,
  fragmentShader: MY_FRAGMENT,
  uniforms: {
    u_intensity: { value: 1.0 },
    u_color: { value: new THREE.Vector3(1, 1, 1) },
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
```

3. Update uniforms each frame in your entity's `update()` method to drive the animation.

4. If the shader has tunable parameters, add them to `LightingSetup.updateLight()` with a new `lightName` case and expose sliders in the config panel.
