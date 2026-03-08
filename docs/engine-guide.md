[← Back to index](/README.md)

# Engine Guide

Deep-dive documentation for the EV 2090 3D engine layer.

---

## Mental Model

Think of the engine as a self-contained simulation. It knows nothing about React, DOM, or HTML. It takes a canvas element and runs a game loop on it. The engine produces a serialized `GameState` object every few frames and pushes it to a callback; React reads that state and renders the HUD. All Three.js scene management, physics, NPC AI, and audio live inside the engine. React never touches the scene graph directly.

**The one rule:** engine files (`frontend/src/engine/`) must never import React. React components must never import Three.js. When a component needs 3D rendering (ship wireframe, hangar detail view), the Three.js logic lives in an engine-side class instantiated from the component via `useEffect`. See the ShipPreview and ShipDetailRenderer patterns below.

---

## Engine.ts -- The Core

`Engine` is the single entry point. It owns the renderer, scene, camera system, all subsystems, and all entities.

### Constructor

`new Engine(canvas, container)` performs the full initialization sequence:

1. **WebGL2 context** -- creates a WebGL2 rendering context manually (to set `UNPACK_FLIP_Y_WEBGL` before Three.js touches it), then hands it to `THREE.WebGLRenderer`.
2. **Renderer** -- sized to the container, pixel ratio capped at 2, clear color `#05050a`.
3. **Scene** -- a single `THREE.Scene` shared by everything.
4. **LightingSetup** -- adds ambient, hemisphere, key, fill, rim, and FPV edge lights to the scene.
5. **CameraController** -- perspective camera with a 40-unit vertical view size (FOV computed to match orthographic at z=100). Supports FPV cockpit mode via smooth camera transition.
6. **InputManager** -- keyboard listener (`WASD` / arrows / space).
7. **Starfield** -- five parallax layers of point sprites plus an FPV star sphere.
8. **NebulaBg** -- two-layer deep-space background (CDN image + procedural nebula).
9. **Ship** (player) -- GLTF model loaded via `ModelCache`, tilted -22 degrees.
10. **NpcManager** -- spawns and updates NPC traffic.
11. **MissionEngine** -- JSON-driven quest state machine (early scaffolding).
12. **DebugBeam** -- optional scan-beam visualization.
13. **OrbitControls** -- mouse-driven orbit for the debug camera.
14. **PostProcessing** -- EffectComposer pipeline with bloom, vignette, and color correction. Always on (individual passes auto-disable at zero values).
15. **HeroCamera** -- cinematic camera for docking transitions and hero shot authoring.
16. **HardpointEditor** -- ship annotation and hardpoint placement dev tool.
17. **Planets** -- four planets (Nexara, Velkar, Zephyra, Arctis) with procedural or file textures.
18. **FPV light exclusions** -- registers planet and ship meshes with PostProcessing for two-pass FPV edge light isolation.
19. **Preloads** -- `ModelCache.preloadModels()` for all ship GLTFs; `SoundManager.preload()` for thruster and ping sounds.
20. **Event listeners** -- `resize`, debug keys (`B` = beam, `C` = FPV, `L` = dock), canvas click (comm mode), and canvas mousemove (hover cursor).
21. **Hardpoint restore** -- loads saved hardpoint edits from localStorage (dev only).
22. **Starts the loop** immediately.

### subscribe(callback)

React calls `engine.subscribe(fn)` once after construction. The engine stores the callback and invokes it with a fresh `GameState` snapshot every 3rd frame.

### loop(time)

The `requestAnimationFrame` loop runs at the display refresh rate (typically 60 fps). Each tick:

1. Compute `dt` (clamped to 50 ms to survive tab-away spikes).
2. Update FPS counter (resets every second).
3. `ship.update(dt, input.state)` -- physics and thruster visuals (skipped when docked, quest-locked, editor active, or in comm mode). FPV planet collision prevents the player from flying into planets when in cockpit view.
4. `planet.update(dt)` for each planet -- spin axis interpolation between top-down and FPV.
5. `npcManager.update(dt, ship, planets, fpvTransition)` -- NPC AI, scanner cone, ray-circle hit tests. Scanner suppressed during FPV.
6. `missionEngine.update(dt, ship, planets)` -- quest state. Plays mayday SFX on new incoming transmission.
7. `debugBeam.update(...)` -- renders the beam line and hit marker if visible.
8. `updateThrusterSound()` -- starts/stops the thruster audio loop.
9. `cameraController.setTarget(...)`, `setShipHeading(...)`, `update(dt)` -- smooth follow with FPV transition.
10. Comm mode choreography -- approach animation, rotation lerp, letterbox bars.
11. FPV feedback -- crossfade starfield, nebula, ship tilt, NPC/planet Z offsets, post-processing values, and lighting between gameplay and FPV targets using cubic ease-in-out.
12. Hero camera update -- applies zoom, pan, and post-processing effects when active.
13. Ship orientation animation -- smooth heading/tilt/roll/scale transitions for hero enter/exit.
14. Hardpoint editor update -- orbit camera and thrust arrow sync.
15. Determine active camera (hardpoint editor has its own; otherwise CameraController).
16. `starfield.update(...)` -- parallax repositioning based on active camera.
17. `nebulaBg.update(...)` -- keeps layers centered on active camera.
18. `postProcessing.setCamera(activeCamera)` then `postProcessing.render()` -- always renders through EffectComposer (individual passes auto-disable at zero values).
19. Every 3rd frame: serialize `GameState` and invoke the subscriber callback.

### State Push

`getGameState()` builds a plain object containing:

- `ship` -- spread copy of `ShipState` (position, velocity, rotation, heading, thrust, shields, armor, fuel).
- `navigation` -- system name, rounded coordinates, nearest planet name and distance.
- `radarContacts` -- combined list of planets + NPC ships + quest NPC.
- `dockable` -- planet info when player is close enough (< radius * 2.5) and slow (speed < 3).
- `docked` -- boolean dock state.
- `fps`, `currentShipId`, `currentShipColor`.
- `heroLetterbox` -- driven by hero camera or comm mode.
- `shipModelLoaded` -- true once the GLTF model has finished loading.
- `fpv`, `fpvTransition` -- FPV cockpit state and transition progress (0-1).
- `commViewTarget` -- NPC name in comm view (null when not in comm).
- `questComms`, `questRescueCta` -- mission system state.
- `screenState` -- `"gameplay"` or `"planet_docking"`.

### dispose()

Tears down everything in reverse order: cancels `requestAnimationFrame`, removes event listeners, disposes orbit controls, input manager, starfield, nebula, ship, each planet, NPC manager, debug beam, sound manager, post-processing, hero camera, hardpoint editor, and the WebGL renderer.

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

**Purpose:** Creates and manages all scene lights (ambient, hemisphere, key, fill, rim, and FPV edge light) and acts as a router for the config panel, dispatching property updates to lights, ship tilt, model rotation, background opacity, and NPC shield parameters.

**Key public API:**
- `setShip(ship)`, `setNebulaBg(nebulaBg)` -- wires references after construction.
- `getLightConfig()` -- returns a `LightConfig` snapshot for the debug panel.
- `updateLight(lightName, property, value)` -- routes updates. Special handlers for `"shipTilt"`, `"modelRotation"`, `"background"`, `"scanOutline"`, and `"fpvLight"`.
- `updateShipMaterial(property, value)` -- forwards metalness/roughness/emissive changes to the ship.
- `getFpvLight()` -- returns the FPV edge light (used by PostProcessing for two-pass rendering).

**Dependencies:** `THREE.Scene`, references to `Ship` and `NebulaBg`.

### 3. NpcManager

**Purpose:** Spawns NPC ships that fly to planets, dock, wait, depart, and despawn. Runs scanner-cone detection and ray-circle hit-point math for the shield shader. Supports NPC freezing for comm mode.

**Key public API:**
- `update(dt, ship, planets, fpvTransition)` -- main tick. Returns `{ fwdX, fwdY, px, py }` for the debug beam. Scanner is suppressed when `fpvTransition > 0`.
- `getNpcs()` -- read-only list of active `NpcShip` instances.
- `getNpc(id)` -- find a specific NPC by id.
- `getRadarContacts()` -- returns radar-friendly summaries.
- `findNearestNpc(x, y, maxDist)` -- world-space proximity search for click targeting.
- `freezeNpc(id)`, `unfreezeNpc(id)` -- pause/resume NPC state machine (comm mode).
- `spawnTestShip(ship)`, `spawnTestRing(ship)`, `clearTestShips()` -- debug helpers.
- `dispose()` -- cleans up all NPCs.

**Dependencies:** `THREE.Scene`, `NpcShip`, `SoundManager`, `ShipCatalog`.

**Key constants:** `RADAR_RANGE = 300`, `SCANNER_HALF_ANGLE = 30 deg`, `MAX_NPCS = 4`, `NPC_SPAWN_INTERVAL = 6s`.

### 4. CameraController

**Purpose:** Manages a perspective camera for the entire game. The base FOV is computed to match a 40-unit vertical view at z=0 (distance 100), which looks virtually identical to orthographic. Supports smooth top-down follow, five debug views, orbit mode, zoom, sidebar offset, and a full FPV cockpit mode with smooth transition.

The FPV transition reuses the same perspective camera -- no projection switch, no visual pop. The camera smoothly swoops from top-down (z=100, narrow FOV) to behind the ship (z~12.5, wide FOV=70) while blending the up vector and lookAt target.

**Key public API:**
- `getActiveCamera()` -- returns the main or debug perspective camera.
- `setTarget(x, y)`, `update(dt)` -- smooth follow each frame (tracked position persists through FPV for seamless exit).
- `setDebugView(view)` -- switches between `"normal"`, `"side"`, `"iso"`, `"iso-r"`, `"orbit"`, `"fpv"`.
- `setSidebarOffset(worldUnits)` -- shifts camera to center the ship in the playable area.
- `setZoom(factor)`, `setManualOffset(x, y)` -- debug tuning.
- `toggleFpv()`, `isFpvActive()`, `getFpvTransition()` -- FPV cockpit mode (0 = top-down, 1 = fully FPV).
- `setShipHeading(radians)` -- receives the ship's physics heading each frame for FPV forward direction.
- `getFpvPlanetZOffset()`, `getFpvNpcZOffset()` -- Z displacement values during FPV transition.
- `setCameraRoll(radians)` -- subtle counter-roll for FPV banking feel.
- `handleOrbitDrag(dx, dy)`, `handleOrbitZoom(delta)` -- orbit mode input.
- `resize(width, height)` -- recalculates frustum.

**Dependencies:** None (standalone Three.js cameras).

### 5. Starfield

**Purpose:** Five-layer parallax starfield plus an FPV star sphere. Each layer has different point counts, sizes, speeds, and colors -- from dense distant dust (3000 points, speed 0.10) to rare bright stars (40 points, speed 0.65). The FPV star sphere surrounds the camera during cockpit view, hidden by default for zero GPU cost.

**Key public API:**
- `update(cameraX, cameraY, cameraZ)` -- repositions all stars with parallax wrapping.
- `setFpvTransition(t)` -- crossfades between 2D parallax layers and 3D star sphere.
- `dispose()` -- removes all layers from the scene.

**Dependencies:** `THREE.Scene`.

### 6. NebulaBg

**Purpose:** Two-layer deep-space background. Layer 1 is a CDN image (Eve Online-style nebula photo, opacity 0.13). Layer 2 is a procedural noise nebula generated on an HTML Canvas (2048x2048, opacity 0.10, slight parallax at 0.08). Both layers use `depthTest: true` so planets properly occlude them.

**Key public API:**
- `group` (readonly) -- add this to the scene.
- `update(cameraX, cameraY, cameraZ)` -- keeps layers centered on camera. Z-tracking maintains constant distance so perspective does not change apparent size.
- `setImageOpacity(v)`, `setNebulaOpacity(v)`, `getImageOpacity()`, `getNebulaOpacity()`.
- `setFpvFade(v)` -- fade out during FPV transition.
- `dispose()`.

**Dependencies:** None (standalone).

### 7. PlanetTextureGen

**Purpose:** Generates procedural equirectangular planet textures (512x256 px) using multi-octave value noise on an HTML Canvas. Supports four planet types: `mars`, `neptune`, `luna`, `terran`.

**Key public API:**
- `generatePlanetTexture(type)` -- returns an `HTMLCanvasElement` ready to be used as a Three.js `CanvasTexture`.

**Dependencies:** None (pure function, no Three.js imports).

### 8. ModelCache

**Purpose:** Singleton cache for GLTF models and textures. Prevents re-parsing GLTFs and re-compiling shaders on every ship spawn. Models are loaded once, then cloned with independent materials for each instance.

**Key public API:**
- `preloadModels(paths)` -- batch preload, returns a Promise.
- `getClone(modelPath)` -- instant clone from cache (null if not loaded).
- `getCloneAsync(modelPath, callback, errorCallback?)` -- loads if needed, then clones.
- `loadTexture(path)` -- cached texture loading with GLTF-compatible settings.
- `getTexture(path)` -- synchronous access to a previously loaded texture.
- `applyTexture(model, texturePath, opts)` -- loads a texture and applies it with PBR settings.

**Dependencies:** `THREE`, `GLTFLoader`.

### 9. SoundManager

**Purpose:** Lightweight audio manager using `HTMLAudioElement` (no Web Audio API). Supports one-shot sounds with cooldown and looping sounds. Handles preloading and failure tracking.

**Key public API:**
- `preload(url)` -- download into browser cache.
- `playOnce(url, volume, cooldownMs)` -- one-shot with de-duplication.
- `startLoop(url, volume)`, `stopLoop(url)` -- looping playback.
- `isLooping(url)`.
- `dispose()` -- pauses and releases all audio elements.

**Dependencies:** None (browser `Audio` API).

### 10. PostProcessing

**Purpose:** Cinematic post-processing pipeline wrapping Three.js `EffectComposer`. Always on in the engine -- there is never a rendering-pipeline switch between EffectComposer and direct `renderer.render()`. Individual passes (bloom, vignette, color correction) stay enabled at all times; zero-valued uniforms produce a near-zero GPU cost equivalent to a single extra texture copy.

The pipeline chain is: **RenderPass** -> **UnrealBloomPass** -> **VignettePass** (custom shader) -> **ColorCorrectionPass** (custom shader).

When the FPV edge light is active, `render()` automatically splits into a two-pass scene draw to isolate the light to ship meshes only (planets stay in shadow). This works around Three.js layers not providing per-object light filtering.

**Key public API:**
- `enabled` -- boolean (always true in production; kept for legacy compatibility).
- `setCamera(camera)` -- switch the camera used by the render pass.
- `render()` -- called from Engine.loop() every frame. Handles single-pass or two-pass rendering automatically.
- `setBloomStrength(v)`, `setBloomRadius(v)`, `setBloomThreshold(v)` -- UnrealBloomPass tuning.
- `setVignetteIntensity(v)`, `setVignetteSoftness(v)` -- custom vignette pass.
- `setBrightness(v)`, `setContrast(v)`, `setExposure(v)` -- custom color correction pass.
- `setFpvLightExclusions(light, getShipMeshes, planetMeshes)` -- register meshes for two-pass FPV edge light isolation. Ship meshes use a callback because NPCs spawn/despawn dynamically.
- `resize(width, height)` -- resize internal render targets.
- `dispose()` -- clean up EffectComposer.

**Dependencies:** `THREE.WebGLRenderer`, `THREE.Scene`, `THREE.Camera`, custom shaders (`vignette.glsl`, `colorCorrection.glsl`).

---

## Standalone Renderers

These are self-contained Three.js renderers instantiated from React components via `useEffect`. They have their own scene, camera, and animation loop -- completely independent of the main engine. This pattern keeps Three.js imports out of React components while providing 3D visuals.

### ShipPreview

**Purpose:** Rotating wireframe ship preview for the intro screen carousel and sidebar diagnostic panel.

Instantiated from React via `useEffect` on a canvas ref. Disposed on cleanup.

Creates its own `WebGLRenderer`, `Scene`, `PerspectiveCamera`, and `AmbientLight`. Loads the GLTF model, applies wireframe + solid-fill materials, auto-scales to fit, and spins at a constant rate. Handles WebGL context limits gracefully (logs a warning and returns a no-op instance).

**Key public API:**
- `constructor(canvas, shipId, opts?)` -- creates the renderer, loads the ship, starts animating.
- `dispose()` -- cancels animation, disposes geometry/materials/renderer.

### ShipDetailRenderer

**Purpose:** Full-material spinning ship for the hangar detail panel. Renders with PBR materials (ACES filmic tone mapping), PCFSoft shadow maps, a cinematic three-light rig (warm key + cool fill + cyan rim), and a shadow-receiving floor plane.

Supports both built-in ships (separate UV texture) and community ships (embedded PBR in GLB with reduced normal maps). Models are auto-scaled and centered for consistent display.

**Key public API:**
- `constructor(canvas, shipId, shipDef?)` -- creates the full renderer and lighting rig.
- `getLightConfig()`, `setLightConfig(cfg)` -- read/write the three-light rig + camera position.
- `getMaterialConfig()`, `setMaterialConfig(cfg)` -- read/write surface properties (metalness, roughness, emissive).
- `getFullConfig()` -- combined light + material snapshot for COPY CONFIG.
- `setHeroMode(hero)` -- switch between centered hero camera and corner preview camera.
- `setPaused(paused)` -- stop/start spinning.
- `setInteractive(interactive)` -- enable pointer drag to manually rotate.
- `captureScreenshot()` -- renders a single frame to base64 PNG on a grey background (used for AI input).
- `resize(w, h)` -- resize the renderer.
- `dispose()` -- full cleanup.

### ShipShowcase

**Purpose:** Full-material rotating ship renderer for the station panel. Renders the player's ship with PBR materials and a hero-shot lighting rig, spinning slowly at the game's default -22 degree tilt angle. Background is fully transparent so it overlays the 3D hero shot.

Instantiated from React via `useEffect` on a canvas ref. Disposed on cleanup.

**Key public API:**
- `constructor(canvas, shipId)` -- creates the renderer, loads the ship, starts animating.
- `dispose()` -- cancels animation, disposes geometry/materials/renderer.

---

## Entities (entities/)

### Ship.ts -- Player Ship

The player ship is a GLTF model loaded via `ModelCache` with UV-mapped color textures (built-in ships) or embedded PBR materials (community ships).

**Mesh hierarchy:**

mesh (THREE.Group) -- top-level, owns position/tilt/rotation/heroScale
  bankGroup (THREE.Group) -- isolated FPV banking rotation (X/Y/Z bank axes)
    visualGroup (THREE.Group) -- heading correction (modelHeadingRad on Z)
      modelGroup (THREE.Group) -- GLTF model (scale = modelScale, rotation for orientation)
  thruster[0].group (THREE.Group) -- positioned at thruster point, rotated by thrustAngleDeg
    core (PlaneGeometry mesh) -- inner flame
    outer (PlaneGeometry mesh) -- outer flame
    light (PointLight) -- glow
  thruster[1].group ...
  thruster[N].group ...

**Critical detail:** Thrusters are direct children of `mesh` (NOT `visualGroup` or `bankGroup`). This prevents heading correction and banking from displacing the flames -- they always trail behind the direction of travel regardless of the model's visual orientation.

**Physics model:**
- `SHIP_THRUST = 30`, `SHIP_ROTATION_SPEED = 3.5 rad/s`, `SHIP_MAX_SPEED = 80`, `SHIP_DRAG = 0.005`, `SHIP_BRAKE_FACTOR = 0.03`.
- Thrust direction = `mesh rotation + thrustForwardAngle`. The `thrustForwardAngle` is derived from the average `thrustAngleDeg` of all configured thrusters. Ships with `thrustAngleDeg=0` (default) move +Y as before. Ships with angled thrusters move in the direction opposite the average flame direction.
- Speed is hard-capped at 80. Fuel depletes slowly during thrust.

**Multi-thruster system:** Ships support one or more thruster flame sets. Each thruster is a `THREE.Group` containing core flame, outer flame, and point light meshes. The group is positioned at the thruster's XYZ coordinates and rotated by `thrustAngleDeg` on Z, so flames can point in any direction. Shared `PlaneGeometry` and canvas-generated radial-gradient textures avoid per-instance GC.

**Banking:** The `bankGroup` provides isolated FPV banking rotation. Three configurable axis weights (`bankAxisX`, `bankAxisY`, `bankAxisZ`) map the roll angle to rotation. X and Y use `|roll|` (non-directional, always same visual pitch) while Z uses signed roll (directional, lean into turns). This prevents Euler cross-coupling artifacts during turns.

**GLTF orientation:** `Rx(+PI/2) * Ry(PI)` maps Blender's Z-forward/Y-up to the game's XY plane.

**Community ship handling:** Ships with `source: "community"` or no `texturePath` use embedded PBR materials. MeshyAI-generated GLBs have heavy normal maps that are reduced (not stripped) to `normalScale 0.35` for a cleaner look. Per-ship `materialConfig` overrides control metalness, roughness, and emissive values.

**Key public API:**
- `update(dt, input)` -- physics + visual sync.
- `syncMesh()` -- sync mesh transform and thruster visuals from current state without running physics. Used by comm mode, hero mode, and FPV transitions.
- `setTilt(radians)` -- perspective tilt on X axis (lerped to 0 during FPV).
- `setRoll(radians)` -- banking angle (applied on bankGroup).
- `setHeroScale(s)` -- hero shot scale multiplier.
- `setModelScale(scale)` -- per-ship model scale (targets the GLTF model group only).
- `setThrusterPosition(x, y, z, index?)` -- move a specific thruster.
- `setThrusterOffsetY(offset)` -- shift all thrusters on Y from original positions.
- `getThrustForwardAngle()` -- physics thrust direction offset in radians.
- `getHeading()` -- current heading (rotation + thrustForwardAngle).
- `getThrusterCount()` -- number of configured thrusters.
- `changeTexture(texturePath)` -- hot-swap color without reloading the model.
- `updateMaterial(property, value)` -- debug tuning of metalness/roughness/emissive.
- `position` (getter), `speed` (getter).
- `dispose()` -- disposes cloned materials only.

### Planet.ts -- Planets

Each planet is a `THREE.SphereGeometry` with either a file texture, a procedurally generated canvas texture, or a solid color fallback. All geometry uses 64x48 segments for smooth spheres.

**Atmosphere:** A slightly larger sphere (radius * 1.12) with a custom Fresnel shader. The vertex shader computes the view direction; the fragment shader raises `(1 - dot(viewDir, normal))` to the 3rd power and multiplies by a configurable color and intensity. Uses additive blending. A `PointLight` adds local glow to nearby objects.

**Spin axis interpolation:** Planets smoothly change their rotation axis direction during FPV transitions. In top-down view, they spin around local Z (equator appears horizontal). In FPV view, they spin around a tilted axis so they look like spinning globes from behind the ship. The spin angle accumulates continuously and never resets -- only the axis direction changes, so there is no visible texture jump during transitions.

**Key public API:**
- `update(dt)` -- accumulates spin angle and applies quaternion rotation with interpolated axis.
- `setFpvTransition(t)` -- smoothly changes the spin axis direction (0 = top-down, 1 = FPV).
- `distanceTo(point)` -- Euclidean distance from a world position to the planet center.
- `dispose()`.

**Data:** `name`, `position` (Vec2), `radius`.

### NpcShip.ts -- NPC Ships

NPC ships follow a five-state machine: `APPROACHING -> DOCKING -> DOCKED -> DEPARTING -> DONE`.

**APPROACHING:** Flies toward a randomly chosen planet with curved approach (perpendicular drift for natural flight lines). Speed decelerates as it nears the planet. Heading smoothly lerps toward the target. Avoidance steering pushes the NPC away from non-target planets to prevent visual clipping in FPV.

**DOCKING:** Smooth deceleration to zero using smoothstep easing. Snaps to the planet surface at sub-pixel threshold (0.01 units).

**DOCKED:** Timer runs for 3-10 seconds (random).

**DEPARTING:** Picks a random departure angle, rotates toward it over 2 seconds, accelerates to 30 units/s with avoidance steering. Marked DONE when 200 units from spawn.

**Frozen mode:** When `frozen = true`, the NPC pauses its state machine but continues to sync tilt and animate the scan outline. Used during comm mode to keep the NPC visually alive but stationary.

**Tilt override:** A static `tiltOverride` is shared across all NPCs. Engine lerps this from -22 degrees (gameplay) to 0 (FPV) during the cockpit transition so all ships appear level.

**Planet avoidance:** NPCs steer away from non-target planets (2.5x radius avoidance zone, strength proportional to proximity).

**Shield shader:** Each NPC has a clone of the ship model rendered with the Fresnel shield `ShaderMaterial`. The shield is only visible when the scan beam ray-circle intersection hits this NPC (not just when in the scanner cone). Opacity fades in at 6.0/s and fades out at 3.3/s.

**Static config (shared across all NPCs, tunable via config panel):**
- `shieldScale`, `fresnelPow`, `dissipation`, `ovalX`, `ovalY`, `baseOpacity`, `hitOpacity`, `hitRadius`, `colorR/G/B`.

### Bridge.ts -- Bridge Interior

Under development. See [dev-tools.md](./dev-tools.md) for details.

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

### vignette.glsl.ts -- Screen-Edge Darkening

A screen-space post-processing shader that darkens the edges of the viewport for cinematic framing. Used as a `ShaderPass` in the PostProcessing EffectComposer pipeline.

**Vertex shader:**
- Standard fullscreen quad: passes through UV coordinates to the fragment shader.

**Fragment shader:**
- Computes distance from the UV center (0.5, 0.5).
- Applies a `smoothstep` falloff between a configurable inner radius and a soft outer edge.
- Multiplies the scene color's RGB by `(1.0 - vignette * intensity)` to darken edges while preserving the center.

**Key uniforms:**

| Uniform | Type | Purpose |
|---------|------|---------|
| `tDiffuse` | sampler2D | Input texture from previous pass |
| `u_intensity` | float | 0-1, how dark the edges get |
| `u_softness` | float | 0-1, how gradual the falloff is |

### colorCorrection.glsl.ts -- Brightness/Contrast/Exposure

A screen-space post-processing shader for global color grading. The final pass in the EffectComposer pipeline, compensating for the subtle contrast shift that EffectComposer introduces versus direct `renderer.render()`.

**Vertex shader:**
- Standard fullscreen quad: passes through UV coordinates.

**Fragment shader:**
- **Brightness:** simple RGB multiply (`color.rgb *= u_brightness`).
- **Contrast:** expand/compress around midpoint 0.5 (`(color - 0.5) * contrast + 0.5`).
- **Exposure:** gamma-style power curve (`pow(color, 1.0 / exposure)`). Higher values brighten midtones.

**Key uniforms:**

| Uniform | Type | Default | Purpose |
|---------|------|---------|---------|
| `tDiffuse` | sampler2D | -- | Input texture from previous pass |
| `u_brightness` | float | 1.34 | Multiplicative brightness (1.0 = no change) |
| `u_contrast` | float | 0.98 | Contrast around midpoint (1.0 = no change) |
| `u_exposure` | float | 1.16 | Gamma-style power curve (1.0 = no change) |

---

## ShipCatalog.ts

A two-part ship catalog: 11 built-in `ShipDef` objects plus a dynamic registry of community ships generated by the Ship Forge AI pipeline.

### Built-in Ships

Each definition contains:
- `id` -- unique key (e.g. `"striker"`, `"bob"`, `"challenger"`).
- `name` -- display name (matches the GLTF filename).
- `class` -- ship class (INTERCEPTOR, UTILITY, ASSAULT, COURIER, FRIGATE, CAPITAL, RAIDER, RECON, PATROL, FIGHTER, EXPLORER).
- `modelPath` -- path to the GLTF file on the R2 CDN.
- `texturePath` -- default Blue texture path.
- `stats` -- `{ speed, armor, cargo, firepower }` each 1-10.
- `lore` -- one-sentence flavor text.
- `extraTextures` (optional) -- custom skins beyond the standard 5 colors.
- `modelScale` (optional) -- per-ship model scale in the hardpoint editor (default 0.4).
- `defaultHeadingDeg` (optional) -- heading correction in degrees.
- `defaultHardpoints` (optional) -- per-ship hardpoint definitions (thruster positions, etc.).
- `thrusterPos` (optional) -- visual thruster position in gameplay mesh space.
- `materialConfig` (optional) -- per-ship material overrides.

### Community Ships

Community ships are AI-generated via the Ship Forge (Grok + Gemini + MeshyAI pipeline). They differ from built-in ships in several ways:

- `source: "community"` -- identifies them as forge-generated.
- Use embedded PBR materials in GLB format -- no separate texture files.
- Have no color variants (always use the embedded materials).
- Include `thumbnailUrl`, `heroUrl`, `creator`, and `prompt` metadata.
- Stored in a mutable `COMMUNITY_SHIPS` array, persisted to localStorage.

**Key functions:**
- `getShipDef(id)` -- returns a definition from either catalog.
- `getAllShips()` -- returns built-in + community ships combined.
- `getCommunityShips()` -- returns community ships only.
- `registerCommunityShip(def)` -- add or update a community ship.
- `setCommunityShips(defs)` -- bulk replace all community ships (from catalog API).
- `updateShipConfig(shipId, updates)` -- update hardpoints, scale, or material config. Persists community ships to localStorage.
- `getShipTexturePath(shipId, shipName, color)` -- resolve texture path for a specific color variant.

---

## Related Docs

- [dev-tools.md](./dev-tools.md) -- Debug panels, authoring tools, and dev-only systems (DebugBeam, OrbitControls, HeroCamera, HardpointEditor)
- [recipes.md](./recipes.md) -- Step-by-step how-tos for adding systems, entities, shaders, ships, and standalone renderers
- [ui-guide.md](./ui-guide.md) -- React component architecture, HUD panels, station UI, and responsive layout
- [architecture.md](./architecture.md) -- High-level system overview, data flow, and deployment
