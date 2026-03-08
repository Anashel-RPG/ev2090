[← Back to index](/README.md)

# Recipes

> **Temporary.** These step-by-step recipes will be replaced by better tooling as the project matures. They document current patterns that are likely to change.

These recipes describe how to add common things to the codebase. They reference files by path -- read the actual source for implementation details. No code templates are provided here because the best template is always the most recent working example in the codebase.

---

## Add a New Engine System

1. Create `frontend/src/engine/systems/MySystem.ts`
2. Follow the pattern: `constructor(scene, ...)`, `update(dt)`, `dispose()`
3. Import and instantiate in `Engine.ts` constructor
4. Call `update(dt)` at the appropriate point in `Engine.loop()`
5. Call `dispose()` in `Engine.dispose()`
6. If the system needs to push state to React, add fields to `getGameState()` and extend `GameState` in `types/game.ts`

**Reference:** Any existing system in `engine/systems/` (e.g., `Starfield.ts` for a simple one, `NpcManager.ts` for a complex one).

---

## Add a New Entity

1. Create `frontend/src/engine/entities/MyEntity.ts`
2. Follow the pattern: `constructor(config)`, `update(dt)`, `dispose()`
3. The entity should own a `THREE.Group` as its root mesh
4. In `Engine.ts`: instantiate, `scene.add(entity.mesh)`, call `update(dt)` in the loop
5. In `Engine.dispose()`: `scene.remove(entity.mesh)` and `entity.dispose()`
6. All Three.js objects (geometry, materials) **must** be disposed in `dispose()`
7. If React needs the entity's data, include it in `getGameState()`

**Reference:** `Ship.ts` (complex, with mesh hierarchy), `Planet.ts` (simpler).

---

## Add a Standalone Renderer (ShipPreview Pattern)

When a React component needs 3D rendering, create a self-contained renderer class in `engine/` with its own scene, camera, and animation loop. Instantiate from React via `useEffect`, dispose on cleanup.

1. Create `frontend/src/engine/MyPreview.ts`
2. Own a `WebGLRenderer`, `Scene`, `PerspectiveCamera`, and RAF loop
3. Handle WebGL context limits gracefully (log warning, return no-op)
4. In the React component: `useEffect(() => { const p = new MyPreview(canvas); return () => p.dispose(); }, []);`

This keeps Three.js imports in `engine/` and React components clean.

**Reference:** `ShipPreview.ts` (wireframe preview), `ShipDetailRenderer.ts` (full PBR renderer).

---

## Add a New Shader

1. Create `frontend/src/engine/shaders/myeffect.glsl.ts`
2. Export vertex and fragment shaders as template literal strings
3. In your entity or system, create a `THREE.ShaderMaterial` using the imports
4. Update uniforms each frame in `update()` to drive animation
5. If tunable, add parameters to `LightingSetup.updateLight()` and expose in the config panel

**Reference:** `shield.glsl.ts` (entity shader), `vignette.glsl.ts` (post-processing shader).

---

## Add a New Ship

1. Add a `ShipDef` entry to `SHIP_CATALOG` in `ShipCatalog.ts`
2. Place GLTF model + texture PNGs in `public/models/{id}/` (or upload to R2 CDN)
3. Follow naming: `{Name}_Blue.png`, `{Name}_Green.png`, etc.
4. Optionally define `defaultHardpoints` for thruster positions
5. Optionally set `modelScale` and `defaultHeadingDeg` for model tuning
6. Ship appears automatically in the selector and NPC traffic

For community ships (AI-generated via Forge), use `registerCommunityShip()`. Community ships use embedded PBR in GLB format with `source: "community"`.

---

## Add a New Durable Object

1. Create the class in `worker/src/my-object.ts` following the DO pattern: constructor loads state, `fetch()` routes requests, optional `alarm()` for periodic work
2. Export it from `worker/src/index.ts`
3. Add binding + migration to `worker/wrangler.toml` (next tag number, append-only)
4. Add to the `Env` interface in `index.ts`
5. Add route in the `fetch()` handler using the existing prefix-stripping pattern
6. Deploy: `cd worker && npx wrangler deploy`

**Reference:** `chat-room.ts` (simplest DO), `economy-region.ts` (most complex with SQLite).

**Critical:** Migration tags are **append-only**. Never reorder, rename, or delete migration entries.

---

## Add a New Admin Endpoint

1. Add the handler in `worker/src/admin.ts` inside `handleAdminRoute()`, before the 404 return
2. Auth is automatic -- `requireAdminAuth()` runs before your handler
3. To forward to a DO, use the existing `forwardToRegion()` helper

**Reference:** Existing handlers in `admin.ts`.

---

## Add a New Route Family

1. Add a routing block in `index.ts` (before the health check) using the prefix-stripping pattern
2. Update the header comment to document the new route
3. Follow "Add a New Durable Object" above if the route targets a new DO

**Reference:** Any existing route block in `index.ts`.

---

## Add a New MCP Tool

1. In `worker-mcp/src/tools/index.ts`, add your tool to the category map and definitions array
2. Implement the handler in the appropriate tool module
3. Choose the right verb prefix for access control: `query_*`/`inspect_*` = read-only, `set_*`/`create_*` = read-write, `delete_*`/`mutate_*` = full-access only
4. Deploy: `cd worker-mcp && npx wrangler deploy`

**Reference:** Any tool in `worker-mcp/src/tools/` (e.g., `economy-intel.ts` for read tools, `market-ops.ts` for write tools).

---

## Add a Config Panel Slider

1. Add a default to `DEFAULTS` in `LightDebugPanel.tsx`
2. Create a `useConfigSlider({ initial, onChange })` instance
3. Add a slider row inside the appropriate `<CollapsibleSection>` (or create a new one)
4. Wire up the section's reset handler
5. Include in the COPY CONFIG output object

**Reference:** Existing sliders in `LightDebugPanel.tsx`, the `useConfigSlider` hook in `hooks/useConfigSlider.ts`.

---

## Add a New React Component

1. Create `MyComponent.tsx` + `MyComponent.css` in `components/`
2. Add to `Game.tsx` render tree
3. Read engine state from the `gameState` prop passed down from Game
4. To call engine methods, add to `GameCanvasHandle` interface and implementation
5. **Never** import Three.js directly -- extract 3D logic to `engine/` (see ShipPreview pattern)

**Reference:** Any sidebar panel for simple display, `StationPanel.tsx` for complex interactive UI.

---

## Related Docs

- **[engine-guide.md](./engine-guide.md)** -- Engine system and entity architecture
- **[ui-guide.md](./ui-guide.md)** -- React component architecture
- **[backend-guide.md](./backend-guide.md)** -- Worker and Durable Object architecture
- **[mcp-guide.md](./mcp-guide.md)** -- MCP tool reference
- **[dev-tools.md](./dev-tools.md)** -- Debug and tuning tools
