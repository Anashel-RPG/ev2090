# UI Guide

Deep-dive documentation for the EV · 2090 React UI layer.

---

## Mental Model

React owns the HUD, not the game. The 3D world lives in a `<canvas>` managed by the engine. React renders everything outside that canvas: the sidebar, radar, ship diagnostics, chat, config panel, loading screen, and touch controls. The engine pushes a `GameState` object to React every 3rd frame (~20 times per second); React reads it and re-renders the relevant panels. React never manipulates the Three.js scene directly -- it calls methods on the engine through a bridge component.

---

## Game.tsx -- The Orchestrator

`Game` is the top-level component. It manages all shared state, wires up callbacks, and decides what to render based on the viewport breakpoint.

### State Management

| State | Type | Purpose |
|-------|------|---------|
| `gameState` | `GameState` | Latest snapshot from engine (ship, nav, radar, fps, etc.) |
| `loadPhase` | `"loading" \| "bar-fading" \| "canvas-fading" \| "done"` | Controls loading overlay transitions |
| `loadProgress` | `number` | 0-100 progress bar value |
| `lightDebugOpen` | `boolean` | Config panel visibility (persisted to `localStorage`) |
| `nickname` | `string` | Player callsign (persisted to `localStorage`) |
| `sidebarOpen` | `boolean` | Mobile sidebar modal toggle |

### Loading Sequence

1. `loadPhase = "loading"` -- overlay visible, progress bar animating via `requestAnimationFrame`.
2. Progress simulates: 0-60% in 300ms, 60-85% in 400ms, then crawls toward 92%.
3. When `engineReady.current` is true AND progress >= 60%, jump to 100%.
4. `"bar-fading"` (100ms delay) -- bar and text fade out.
5. `"canvas-fading"` (700ms delay) -- overlay itself fades, canvas becomes visible.
6. `"done"` (2000ms delay) -- overlay removed from DOM.

The engine signals readiness via the `onReady` callback on `GameCanvasHandle`, which fires ~800ms after mount (enough time for models to begin loading).

### Console Globals

Two development helpers are exposed on `window`:

- `config()` -- toggles the LightDebugPanel.
- `testship()` -- spawns a frozen test NPC near the player.

### Breakpoint Logic

`Game` calls `useBreakpoint()` and branches on the result:

- **desktop** (>= 1024px): Sidebar always visible (240px wide), config panel available, chat and nickname editor shown, keyboard HUD hints visible.
- **ipad** (768-1023px): Sidebar always visible (200px wide), config panel available, chat shown.
- **mobile** (< 768px): No sidebar. Hamburger toggle opens a full-screen ship modal. Mini radar HUD in corner. Touch controls shown. Chat, nickname, config panel, and jump-back button hidden.

---

## GameCanvas.tsx -- The Bridge

`GameCanvas` is the React-to-engine bridge. It uses `forwardRef` + `useImperativeHandle` to expose engine methods to the parent `Game` component without ever passing the `Engine` instance directly.

### Bridge Pattern

`Game` holds a `ref` to `GameCanvas` and calls methods like `canvasRef.current?.changeShip(id)`. Each method on the handle simply delegates to `engineRef.current?.methodName()`.

### Bridge Methods (GameCanvasHandle)

| Method | Delegates to |
|--------|-------------|
| `changeShip(shipId)` | `engine.changeShip()` |
| `changeShipColor(color)` | `engine.changeShipColor()` |
| `getLightConfig()` | `engine.getLightConfig()` |
| `updateLight(light, prop, value)` | `engine.updateLight()` |
| `updateShipMaterial(prop, value)` | `engine.updateShipMaterial()` |
| `jumpBack()` | `engine.jumpToNearestPlanet()` |
| `onReady(cb)` | Stores callback, fired after ~800ms |
| `spawnTestShip()` | `engine.spawnTestShip()` |
| `spawnTestRing()` | `engine.spawnTestRing()` |
| `clearTestShips()` | `engine.clearTestShips()` |
| `setDebugView(view)` | `engine.setDebugView()` |
| `getDebugView()` | `engine.getDebugView()` |
| `setBeamVisible(visible)` | `engine.setBeamVisible()` |
| `isBeamVisible()` | `engine.isBeamVisible()` |
| `setSidebarWidthPx(px)` | `engine.setSidebarWidthPx()` |
| `setZoom(factor)` | `engine.setZoom()` |
| `getZoom()` | `engine.getZoom()` |
| `setCameraOffset(x, y)` | `engine.setCameraOffset()` |
| `getCameraOffset()` | `engine.getCameraOffset()` |

### Mount / Unmount

On mount: creates `new Engine(canvas, container)`, calls `engine.subscribe(onStateUpdate)`, and sets a 800ms ready timer. On unmount: calls `engine.dispose()`.

---

## Sidebar Panels

The sidebar (`Sidebar.tsx`) is a scrollable `<aside>` containing the logo, three panel components, a static cargo/credits section, and an FPS counter.

### 1. RadarPanel

**File:** `sidebar/RadarPanel.tsx`

**Reads:** `gameState.ship.position`, `gameState.ship.rotation`, `gameState.radarContacts`.

**Callbacks:** None (display only).

**Description:** An SVG radar scope (160px default). Draws range rings, crosshairs, a scanner cone (60-degree wedge with radial gradient), and contact dots. Planets are blue circles; ships are green. Contacts in the scanner cone appear at full opacity with a ping pulse animation. Supports a `compact` prop for the mobile mini-radar (90px, no panel header).

### 2. ShipDiagnosticPanel

**File:** `sidebar/ShipDiagnosticPanel.tsx`

**Reads:** `gameState.currentShipId`, `gameState.currentShipColor`. Looks up `ShipCatalog` internally for stats and model path.

**Callbacks:** `onColorChange(color)` -- switches ship texture.

**Description:** A rotating green wireframe 3D preview of the current ship (its own mini Three.js renderer, 210x150px). Below: a color selector (5 standard colors + any extra textures), the ship class label, and four stat bars (SPD, ARM, CRG, FPR) rendered as block characters.

### 3. ShipSelectorPanel

**File:** `sidebar/ShipSelectorPanel.tsx`

**Reads:** `gameState.currentShipId`. Uses `SHIP_CATALOG` directly.

**Callbacks:** `onShipChange(shipId)` -- switches the player's ship model.

**Description:** A scrollable list of all 11 ships. Each row shows the ship name and class. The active ship is highlighted.

### 4. ShipStatusPanel

**File:** `sidebar/ShipStatusPanel.tsx`

**Reads:** `gameState.ship` (shields, armor, fuel, rotation) and computed speed.

**Callbacks:** None (display only).

**Description:** Three status bars (shields blue, armor orange, fuel green) with percentage labels. Bars turn red below 30%. Below: speed and heading readouts. (Not currently wired into the Sidebar but available as a component.)

### 5. NavigationPanel

**File:** `sidebar/NavigationPanel.tsx`

**Reads:** `gameState.navigation` (systemName, coordinates, nearestPlanet, nearestDistance).

**Callbacks:** None (display only).

**Description:** Displays system name, current position coordinates, nearest planet name, and distance in AU. (Not currently wired into the Sidebar but available as a component.)

### 6. TargetPanel

**File:** `sidebar/TargetPanel.tsx`

**Reads:** `gameState.target` (name, type, distance, shields, armor).

**Callbacks:** None (display only).

**Description:** Shows targeted entity info with shield and armor bars, or "NO TARGET" when nothing is selected. (Not currently wired into the Sidebar but available as a component.)

### 7. CargoCredits (inline in Sidebar)

**Reads:** Nothing dynamic (static placeholder values: FREE CARGO = 10, CREDITS = 25,000).

**Callbacks:** None.

**Description:** Two rows displaying cargo space and credit balance. Currently hardcoded.

---

## Overlay Components

### ChatPanel

**File:** `ChatPanel.tsx`

**Props:** `apiUrl`, `nickname`.

**Description:** A collapsible COMMS panel in the bottom-left. Connects to the backend via Server-Sent Events for real-time messages. Loads history on mount via `GET /api/chat/history`. Sends messages via `POST /api/chat/message`. Auto-reconnects on SSE failure (3s delay). Keeps the last 7 messages. Stays fully visible for 10 seconds on load, then fades. Minimizable via the header toggle.

### NicknameEditor

**File:** `NicknameEditor.tsx`

**Props:** `nickname`, `onNicknameChange`.

**Description:** An inline callsign display that transforms into an editable input on click. Enter saves, Escape cancels. Max 16 characters. Persisted to `localStorage`.

### OffscreenIndicators

**File:** `OffscreenIndicators.tsx`

**Props:** `shipPosition`, `shipRotation`, `contacts`, `sidebarWidth`.

**Description:** Renders floating labels at viewport edges for contacts that are off-screen. Planets are always shown; ships only appear if within the 60-degree scanner cone. Positions are computed by projecting world-space directions onto the viewport edge with margin clamping.

### TouchControls

**File:** `TouchControls.tsx`

**Description:** Floating touch buttons for tablet/mobile. Left side: circular Thrust button (dispatches `KeyW`). Right side: two buttons for Rotate Left (`KeyA`) and Rotate Right (`KeyD`). Uses `pointerdown`/`pointerup` events and dispatches synthetic `KeyboardEvent`s on `window` so that `InputManager` picks them up without any special coupling.

---

## Config Panel (LightDebugPanel)

### Architecture

The config panel is a floating debug overlay (top-left, `position: fixed`) with a scrollable body containing 8 collapsible sections. It is hidden by default and toggled via `config()` in the browser console or programmatically.

### CollapsibleSection Component

**File:** `config/CollapsibleSection.tsx`

A reusable accordion section. Props: `title`, `defaultOpen`, `children`, `onReset`. Renders a header button with an arrow indicator and an optional RESET button. Children are only mounted when open.

### useConfigSlider Hook

**File:** `hooks/useConfigSlider.ts`

Manages a single slider value with `{ value, handleChange, reset }`. Accepts `initial` and `onChange` callback. Used extensively in `LightDebugPanel` to reduce boilerplate -- each slider is one `useConfigSlider()` call.

### The 8 Collapsible Sections

1. **DEBUG TOOLS** (default open) -- Spawn 1 / Spawn Ring / Clear test ships, Beam toggle, 5 camera view buttons (TOP, SIDE, ISO, ISO-R, ORBIT).
2. **CAMERA** -- Zoom (0.5x-3x), Offset X (-20 to 20), Offset Y (-20 to 20).
3. **SIDEBAR GLASS** -- Opacity (0-1), Blur (0-40px). Writes directly to CSS custom properties `--sidebar-bg-opacity` and `--sidebar-blur`.
4. **BACKGROUND** -- Image opacity (0-1), Nebula opacity (0-1). Routes through `updateLight("background", ...)`.
5. **SHIELD** -- Scale, Fresnel, Dissipation, Oval X/Y, Base alpha, Hit alpha, Hit Width, and Color presets (Green, Cyan, Orange, Red, Purple, White). All route through `updateLight("scanOutline", ...)`.
6. **SHIP MODEL** -- Tilt (-30 to 30 degrees), Model Rx/Ry/Rz (-180 to 180 degrees). Routes through `updateLight("shipTilt"/"modelRotation", ...)`.
7. **LIGHTING** -- 14 sliders grouped by light: Ambient (intensity), Hemisphere (intensity), Key Light (intensity, x, y, z), Fill Light (intensity, x, y, z), Rim Light (intensity, x, y, z).
8. **MATERIAL** -- Metalness (0-1), Roughness (0-1), Emissive Intensity (0-1).

The header also has a COPY CONFIG button that serializes all current values to JSON on the clipboard.

### How to Add a New Config Slider

1. In `LightDebugPanel.tsx`, add a new `useConfigSlider` call:

```ts
const myParam = useConfigSlider({
  initial: 0.5,
  onChange: (v) => updateLight("myCategory", "myProp", v),
});
```

2. Add it inside the appropriate `<CollapsibleSection>` (or create a new one):

```tsx
<div className="debug-slider-row">
  <span className="debug-slider-label">My Param</span>
  <input
    type="range"
    min={0} max={1} step={0.01}
    value={myParam.value}
    onChange={(e) => myParam.handleChange(Number(e.target.value))}
    className="debug-slider"
  />
  <span className="debug-slider-value">{myParam.value.toFixed(2)}</span>
</div>
```

3. If the slider controls an engine property, add a handler in `LightingSetup.updateLight()` for `"myCategory"`.

4. Add it to the section's reset handler and to `DEFAULTS`.

5. Include it in the `handleCopy` output object so COPY CONFIG captures it.

---

## Responsive Design

### useBreakpoint Hook

**File:** `hooks/useBreakpoint.ts`

Returns one of three breakpoint values based on `window.innerWidth`:

| Breakpoint | Width Range | Description |
|------------|-------------|-------------|
| `desktop` | >= 1024px | Full sidebar (240px), config panel, chat, nickname, keyboard HUD |
| `ipad` | 768-1023px | Narrower sidebar (200px), config panel, chat |
| `mobile` | < 768px | No sidebar, hamburger menu, mini radar, touch controls |

### What Changes at Each Breakpoint

**Desktop:** Full experience. Sidebar always visible at 240px. Config panel togglable. Chat panel and nickname editor in bottom-left. Keyboard control hints in HUD. Jump-back button when far from planets.

**iPad:** Sidebar narrows to 200px. Chat panel narrows to 280px. Ship list max-height shrinks to 160px. Everything else matches desktop.

**Mobile:** Sidebar is removed entirely (`--sidebar-width: 0px`). A hamburger toggle at top-left opens a full-screen ship modal (wireframe + stats + color picker only). A mini radar appears at top-right when the modal is closed. Touch controls overlay at the bottom. Config panel, chat, nickname editor, jump-back button, FPS counter, and keyboard hints are all hidden.

---

## CSS Organization

### Co-located CSS Pattern

Each component has a co-located CSS file that is imported directly in the component:

- `ChatPanel.tsx` imports `ChatPanel.css`
- `NicknameEditor.tsx` imports `NicknameEditor.css`
- `OffscreenIndicators.tsx` imports `OffscreenIndicators.css`
- `TouchControls.tsx` imports `TouchControls.css`
- `LightDebugPanel.tsx` imports `LightDebugPanel.css`
- `config/CollapsibleSection.tsx` imports `CollapsibleSection.css`

### Sidebar CSS Files

The sidebar panels share styles across three files in `components/sidebar/`:

- `sidebar.css` -- sidebar container layout, panel base styles, ship list, logo, footer.
- `radar.css` -- radar scope background, ping animation.
- `diagnostic.css` -- wireframe canvas, scanline overlay, color swatches, stat bars.

### Global CSS Files

- `App.css` -- main layout: game container, canvas container, HUD positioning, loading overlay, sidebar boot animation, mobile ship modal, mini radar HUD.
- `responsive.css` -- media queries for iPad (max-width: 1023px) and mobile (max-width: 767px). Overrides sidebar width, hides/shows elements per breakpoint.
- `index.css` -- CSS reset and base styles (body, html, font stacks, box-sizing).
