[← Back to index](/README.md)

# UI Guide

Deep-dive documentation for the EV 2090 React UI layer.

---

## Mental Model

React owns the HUD, not the game. The 3D world lives in a `<canvas>` managed by the engine. React renders everything outside that canvas: the sidebar, radar, ship diagnostics, station panels, trading interface, hangar overlay, chat, config panel, loading screen, intro screen, and touch controls. The engine pushes a `GameState` object to React every 3rd frame (~20 times per second); React reads it and re-renders the relevant panels. React never manipulates the Three.js scene directly -- it calls methods on the engine through a bridge component.

---

## Game States

The game moves through five distinct scene states, all managed by `Game.tsx`. Each state controls which components render and what the player can interact with.

| State | Trigger | What Renders |
|-------|---------|--------------|
| **intro** | First visit (no `ev-ship` in localStorage) | `IntroScreen` -- ship selection carousel over the canvas |
| **gameplay** | After intro completes or on returning visits | Sidebar, HUD overlays, off-screen indicators, chat, dock button |
| **docking** | Player clicks DOCK or presses D/L near a planet | Letterbox bars animate in, `DockFlash` fires, hero camera zooms to planet |
| **docked** | Letterbox animation settles | `StationPanel` (desktop) or `StationOverlay` (mobile), sidebar hidden |
| **hangar** | Player clicks VISIT HANGAR or station Hangar tab | `HangarOverlay` -- full-screen ship catalog, detail view, forge |

These states are not a formal enum. They emerge from the combination of `introComplete`, `docked`, `forgeOpen`, and `editorActive` booleans in `Game.tsx`. The URL query param `?scene=X` can force a state in development (see Console Globals below).

---

## Game.tsx -- The Orchestrator

`Game` is the top-level component. It manages all shared state, wires up callbacks, and decides what to render based on the viewport breakpoint and current game state.

### State Management

| State | Type | Purpose |
|-------|------|---------|
| `gameState` | `GameState` | Latest snapshot from engine (ship, nav, radar, fps, dockable, heroLetterbox, etc.) |
| `loadPhase` | `"loading" \| "bar-fading" \| "canvas-fading" \| "done"` | Controls loading overlay transitions |
| `loadProgress` | `number` | 0-100 progress bar value |
| `introComplete` | `boolean` | Whether the intro ship-selection screen has been dismissed |
| `docked` | `boolean` | Whether the player is currently docked at a station |
| `dockedPlanet` | `string \| null` | Name of the planet the player is docked at |
| `lightDebugOpen` | `boolean` | Config panel visibility (persisted to `localStorage`) |
| `heroShotOpen` | `boolean` | Hero shot authoring tool visibility |
| `hardpointEditorOpen` | `boolean` | Hardpoint editor visibility |
| `forgeOpen` | `boolean` | Hangar/Forge overlay visibility |
| `hangarContext` | `HangarContext` | `"forge"` (opened from sidebar) or `"hangar"` (opened from station) |
| `nickname` | `string` | Player callsign (persisted to `localStorage`) |
| `sidebarOpen` | `boolean` | Mobile sidebar modal toggle |
| `shipLoading` | `boolean` | Community ship model download spinner |
| `cargoWarning` | `CargoWarningData \| null` | Cargo overflow modal when switching to a ship with less cargo capacity |

### Loading Sequence

The loading sequence preloads all built-in ship models via `ModelCache`, which caches to IndexedDB. First visit downloads ~55MB from CDN with real progress tracking. Subsequent visits hit the IndexedDB cache and load near-instantly.

1. `loadPhase = "loading"` -- overlay visible, progress bar driven by real asset download progress.
2. Engine readiness is signaled via the `onReady` callback (~800ms after mount).
3. `ModelCache.preloadWithProgress` downloads all GLTF models, updating progress 0-100%.
4. `"bar-fading"` (100ms delay) -- bar and text fade out.
5. `"canvas-fading"` (700ms delay) -- overlay itself fades, canvas becomes visible.
6. `"done"` (2000ms delay) -- overlay removed from DOM.

If preloading fails, the game proceeds anyway -- models load on demand as fallback.

### Console Globals & URL Shortcuts

Console commands (`config()`, `testship()`, `forge()`, etc.) and URL debug shortcuts (`?scene=gameplay`, etc.) are documented in **[dev-tools.md](./dev-tools.md)**.

### Player Economy

`Game.tsx` integrates two economy hooks:

- `usePlayerEconomy(shipId)` -- tracks credits, cargo inventory, cargo weight/capacity, and provides `buy()`, `sell()`, and `jettison()` methods. Persists to localStorage.
- `useMarketPrices(apiUrl, enabled)` -- fetches live market prices from the economy API when docked.

These are threaded through to `StationPanel`, `StationOverlay`, `Sidebar`, and the cargo warning modal.

### Breakpoint Logic

`Game` calls `useBreakpoint()` and branches on the result:

- **desktop** (>= 1024px): Sidebar always visible (240px wide), config panel available, chat and nickname editor shown, keyboard HUD hints visible.
- **ipad** (768-1023px): Sidebar always visible (200px wide), config panel available, chat shown.
- **mobile** (< 768px): No sidebar. Hamburger toggle opens a full-screen ship modal. Mini radar HUD in corner. Touch controls shown. Chat, nickname, config panel, and jump-back button hidden. Station uses `StationOverlay` (CRT terminal) instead of `StationPanel`.

---

## GameCanvas.tsx -- The Bridge

`GameCanvas` is the React-to-engine bridge. It uses `forwardRef` + `useImperativeHandle` to expose engine methods to the parent `Game` component without ever passing the `Engine` instance directly.

### Bridge Pattern

`Game` holds a `ref` to `GameCanvas` and calls methods like `canvasRef.current?.changeShip(id)`. Each method on the handle simply delegates to `engineRef.current?.methodName()`.

### Bridge Methods (GameCanvasHandle)

#### Core Ship & Camera

| Method | Delegates to |
|--------|-------------|
| `changeShip(shipId)` | `engine.changeShip()` |
| `changeShipColor(color)` | `engine.changeShipColor()` |
| `jumpBack()` | `engine.jumpToNearestPlanet()` |
| `setSidebarWidthPx(px)` | `engine.setSidebarWidthPx()` |
| `setZoom(factor)` | `engine.setZoom()` |
| `getZoom()` | `engine.getZoom()` |
| `setCameraOffset(x, y)` | `engine.setCameraOffset()` |
| `getCameraOffset()` | `engine.getCameraOffset()` |

#### Docking

| Method | Delegates to |
|--------|-------------|
| `dock()` | `engine.dock()` |
| `undock()` | `engine.undock()` |
| `repairShip()` | `engine.repairShip()` |
| `refuelShip()` | `engine.refuelShip()` |
| `setDockRequestCallback(cb)` | `engine.setDockRequestCallback()` |

#### Lighting & Materials

| Method | Delegates to |
|--------|-------------|
| `getLightConfig()` | `engine.getLightConfig()` |
| `updateLight(light, prop, value)` | `engine.updateLight()` |
| `updateShipMaterial(prop, value)` | `engine.updateShipMaterial()` |

#### Debug & Testing

| Method | Delegates to |
|--------|-------------|
| `onReady(cb)` | Stores callback, fired after ~800ms |
| `spawnTestShip()` | `engine.spawnTestShip()` |
| `spawnTestRing()` | `engine.spawnTestRing()` |
| `clearTestShips()` | `engine.clearTestShips()` |
| `setDebugView(view)` | `engine.setDebugView()` |
| `getDebugView()` | `engine.getDebugView()` |
| `setBeamVisible(visible)` | `engine.setBeamVisible()` |
| `isBeamVisible()` | `engine.isBeamVisible()` |

#### Dev Tool Methods

Hero Shot, Hardpoint Editor, FPV, and Quest bridge methods are not listed here. They follow the same delegation pattern -- see the source in `GameCanvas.tsx` for the complete list.

#### Ship Forge & FPV

| Method | Delegates to |
|--------|-------------|
| `registerCommunityShip(def)` | `registerCommunityShip()` (ShipCatalog) |
| `toggleFpv()` | `engine.toggleFpv()` |
| `isFpvActive()` | `engine.isFpvActive()` |
| `getFpvPostConfig()` | `engine.getFpvPostConfig()` |
| `setFpvPostParam(key, value)` | `engine.setFpvPostParam()` |
| `exitCommMode()` | `engine.exitCommMode()` |

#### Quest

| Method | Delegates to |
|--------|-------------|
| `triggerQuestRescue()` | `engine.triggerQuestRescue()` |
| `startQuest()` | `engine.startQuest()` |

### Mount / Unmount

On mount: creates `new Engine(canvas, container)`, calls `engine.subscribe(onStateUpdate)`, and sets an 800ms ready timer. On unmount: calls `engine.dispose()`.

---

## Intro Screen

**File:** `components/IntroScreen.tsx` + `IntroScreen.css`

**Props:** `onComplete: (shipId, color) => void`

**Description:** A full-screen overlay shown to first-time visitors (no `ev-ship` in localStorage). Presents a ship selection carousel with 3D wireframe previews for three starter ships: Striker, Bob, and Challenger.

The component has two steps:

1. **Ship selection** -- carousel with left/right arrows, rotating wireframe preview (via `ShipPreviewRenderer`), ship name, class, lore text, and four stat bars (SPD, ARM, CRG, FPR). A counter shows `N / 3` and a hint reads "Visit Hangar for more."
2. **Controls tutorial** (desktop only) -- keyboard mapping for W/A/S/D and arrow keys, plus a docking tip.

On mobile, step 2 is skipped entirely -- selecting a ship immediately calls `onComplete`. On desktop, the SELECT button transitions to the controls screen, and the LAUNCH button fires `onComplete`.

The wireframe preview is rendered by `ShipPreviewRenderer` (engine class), instantiated in a `useEffect` on a dedicated `<canvas>` element -- following the architecture rule of no Three.js in React components.

---

## Station UI -- Docking

When the player docks at a planet, `Game.tsx` sets `docked = true` and `dockedPlanet` to the planet name. The engine enters hero mode (cinematic camera zoom to the planet). Two different UIs render depending on the breakpoint:

- **Desktop/iPad:** `StationPanel` -- a sci-fi glass panel on the right side of the screen.
- **Mobile:** `StationOverlay` -- a full-screen CRT terminal interface.

### StationPanel (Desktop)

**File:** `components/StationPanel.tsx` + `StationPanel.css`

**Props:** `planetName`, `shipId`, `heroLetterbox`, `onUndock`, `onRepair`, `onRefuel`, `onOpenHangar`, plus economy props (`marketSnapshot`, `playerCredits`, `playerCargo`, `cargoWeight`, `cargoCapacity`, `onBuy`, `onSell`). Auth props have been removed — all tabs are open to all players (see auth note below).

**Description:** A glass-effect aside panel positioned on the right of the viewport. Waits for the hero letterbox animation to settle before revealing itself. Features:

- **Planet info overlay** (top-left) -- class badge (e.g. "Terrestrial"), habitable badge, planet name, and lore text. Uses `framer-motion` for entrance animation.
- **Planet stats** (bottom-left) -- temperature, gravity, radiation level, threat level.
- **Tabbed navigation** -- four tabs: Overview (Summary), Market (Trading), Hangar, and Comm-Link (locked/coming soon). The Hangar tab opens the `HangarOverlay` instead of rendering in-panel. Market and Hangar are open to all players — no account required (see auth note below).
- **Animated tab transitions** -- `AnimatePresence` with fade/slide animations between tab content.
- **Undock button** -- triggers a `DockFlash`, hides the panel, then calls `onUndock` after a short delay.

Screen FX layers (scanlines, vignette) are rendered as decorative overlays on top of the panel.

### StationOverlay (Mobile)

**File:** `components/StationOverlay.tsx` + `StationOverlay.css`

**Props:** `planetName`, `nickname`, `boardApiUrl`, `onUndock`, `onRepair`, `onRefuel`, `onOpenHangar`, `shields`, `armor`, `fuel`, plus economy props (`credits`, `cargo`, `cargoWeight`, `cargoCapacity`). All BBS options (including Hangar) are open to all players.

**Description:** A full-screen CRT terminal overlay with a retro BBS (bulletin board system) aesthetic. Features:

- **Boot sequence** -- five lines typed out at 260ms intervals, simulating a terminal handshake.
- **BBS menu** -- numbered options: [1] OPERATIONS, [2] COMMUNITY BOARD, [3] CARGO BAY, [4] HANGAR.
- **Keyboard navigation** -- number keys (1-4) switch tabs, arrow keys cycle, Escape undocks, R repairs, F refuels.
- **Operations tab** -- block-character ASCII progress bars for hull, shields, and fuel. REPAIR ALL and REFUEL buttons that disable when systems are OK.
- **Community Board tab** -- renders the `CommunityBoard` component (see below).
- **Cargo Bay tab** -- cargo manifest showing loaded items, quantities, values, and totals. Uses monospace formatting.
- **Footer** -- blinking cursor with `[ESC] UNDOCK` prompt.

### Station Sub-Panels

#### SummaryPanel

**File:** `components/station/SummaryPanel.tsx` + `SummaryPanel.css`

**Props:** None (currently uses static data).

**Description:** Faction overview with a reputation bar (10-cell visual), a 3x2 services grid (Refinery, Shipyard, Cloning, Insurance, Bounties, Maps), and a scrollable local feed with timestamped event entries. Uses `framer-motion` for fade-in.

#### TradingPanel

**File:** `components/station/TradingPanel.tsx`

**Props:** `planetId`, `marketSnapshot`, `playerCredits`, `playerCargo`, `cargoWeight`, `cargoCapacity`, `onBuy`, `onSell`.

**Description:** A full commodity market interface. Features:

- **Volume bar chart** (SVG) -- shows all commodities as bars colored by supply level (red < 30%, green > 70%).
- **Price history chart** -- when a commodity is selected, switches to a `PriceHistoryMini` OHLC candle chart.
- **Category filter pills** -- All, Minerals, Food, Tech, Industrial, Luxury.
- **Commodity list** -- scrollable rows showing name, category icon, price, supply percentage, and holdings count.
- **Sticky glass action bar** -- appears when a commodity is selected. Contains:
  - Live cargo projection bar (animated preview of cargo after trade).
  - Sell side: mode toggle (% / CR), quick-select chips (10%, 25%, 50%, ALL or CR amounts), quantity input, execute button.
  - Buy side: same layout, capped by both available credits and free cargo capacity.

Prices come from the live economy backend via `MarketSnapshot`.

#### LockedPanel

**File:** `components/station/LockedPanel.tsx`

**Props:** `label: string`

**Description:** A centered lock icon with the facility label and "Coming soon" text. Used for station tabs that are not yet implemented (e.g. Comm-Link).

#### Auth / Account Gating — Status

> **Scaffolded but not enforced.** The authentication infrastructure (`useAuth`, `types/auth.ts`, `hooks/useAuth.ts`) is implemented and the worker exposes `/api/auth/*` endpoints. However, Market and Hangar station tabs are open to all players without an account. The COMMISSION tab in the Ship Forge is the only feature that checks `isAuthenticated` in production (to gate the AI pipeline). Full account gating across the game is deferred to a future release.

---

## Docking Effects

### DockFlash

**File:** `components/DockFlash.tsx` + `DockFlash.css`

**Props:** `trigger: number` (increment to re-fire).

**Description:** A full-screen white flash that fades out over 700ms. Triggered on both docking and undocking by incrementing the `trigger` prop. Returns `null` when inactive.

### Letterbox Bars

Not a separate component -- rendered inline in `Game.tsx` when `gameState.heroLetterbox > 0.001` and not docked. Two `<div>` elements at the top and bottom of the viewport, height driven by `heroLetterbox * 12vh`. They appear during the hero camera transition into docking and hide once the station panel takes over.

---

## Community Board

**File:** `components/CommunityBoard.tsx` + `CommunityBoard.css`

**Props:** `planet`, `nickname`, `apiUrl`.

**Description:** A player-submitted notes board at each planet station, backed by the BoardRoom Durable Object. Features:

- Fetches the 5 most recent notes for the current planet on mount via `GET /api/board/notes?planet=X&limit=5`.
- Posts new notes via `POST /api/board/notes` with `{ nickname, text, planet }`.
- **10-word limit** -- input shows a live word counter that turns red when exceeded.
- **Relative timestamps** -- "just now", "5m ago", "2h ago", or a date.
- Text input with Enter to submit, Escape to blur.

Used inside `StationOverlay` (mobile Community Board tab) and potentially in `StationPanel` in the future.

---

## Hangar Overlay

**File:** `components/hangar/HangarOverlay.tsx` + `HangarOverlay.css`

**Props:** `open`, `context`, `onClose`, `onSelectShip`, `onUndock?`, `forgeApiUrl`, `nickname`, `currentShipId`.

**Description:** A full-screen overlay for ship management. Opens in two contexts:

- `"forge"` -- opened from the sidebar VISIT HANGAR button. Shows FLEET + COMMISSION tabs. CTA on ship detail = "Fly This Ship".
- `"hangar"` -- opened from the station Hangar tab. Shows FLEET tab only. CTA on ship detail = "Undock Ship" (also triggers undock).

### Fleet Tab

Displays a filterable grid of all ships (built-in + community). Components:

- **FilterSidebar** (`hangar/FilterSidebar.tsx`) -- filter by ship class, minimum cargo/turrets/launchers/drone bay.
- **ShipCard grid** -- responsive card grid with animated enter/exit.
- **ShipDetail modal** -- opens when a card is clicked (see below).

Ships are fetched from both the local `SHIP_CATALOG` (11 built-in ships) and the forge catalog API (`GET /api/forge/catalog`). Community ships from the API take precedence over any matching local entries.

### Commission Tab

Available only in `"forge"` context. May be locked (controlled by the forge API config endpoint). Admin API key bypasses the lock. Renders the `ForgeCreatePanel`.

### ShipCard

**File:** `components/hangar/ShipCard.tsx`

**Props:** `ship: HangarShip`, `onClick`.

**Description:** A card with a hero image (16:9 aspect ratio), gradient fade, scanline overlay, class badge (color-coded by ship class), ship name, status indicator (Active = green, In Hangar = gold), and a 2x2 stat grid (Cargo, Drone Bay, Turrets, Launchers). Hover state lifts the card with a gold top border accent.

### ShipDetail

**File:** `components/hangar/ShipDetail.tsx` + `ShipDetail.css`

**Props:** `ship`, `context`, `onClose`, `onFly`, `onDelete?`, `isAdmin?`, `forgeApiUrl?`, `forgeApiKey?`, `onLoreUpdated?`, `onHeroUpdated?`.

**Description:** A fullscreen modal for viewing ship details. Top half shows the hero image with bloom pass, gradient fades, a tactical grid overlay, and a 3D ship renderer (via `ShipDetailRenderer`). Bottom half has two columns:

- **Left: Database Entry** -- lore text, creator name. Admin users can regenerate lore via Grok AI.
- **Right: Technical Specs** -- cargo, drone bay, turrets, launchers, defense, signature radius with animated bar fills. Below: a primary CTA button ("Fly This Ship" or "Undock Ship") and admin actions (regenerate hero image, delete ship).

The 3D renderer (`ShipDetailRenderer`) is an engine-side class that renders a rotating ship model on a separate canvas. In hero mode (admin feature), the renderer becomes interactive -- users can drag to rotate the ship, capture a screenshot, and submit it to the AI hero image generation pipeline.

### ForgeCreatePanel

**File:** `components/hangar/ForgeCreatePanel.tsx` + `ForgeCreatePanel.css`

**Props:** `forgeApiUrl`, `forgeApiKey?`, `nickname`, `ships?`, `onShipCreated`, `onCatalogRefresh`.

**Description:** The AI ship creation flow. Two creative modes:

**AI Commission** -- multi-step wizard:
1. **Describe** -- text description (200 chars), ship class selector, name/lore text (or AI auto-complete).
2. **Blueprint Review** -- generated concept art displayed, primary/secondary color pickers.
3. **Render Preview** -- colored render shown, approve or repaint.
4. **Building 3D** -- progress bar with elapsed timer while MeshyAI generates the 3D model (1-2 min). Polls status every 5 seconds.
5. **Complete** -- ship name, class, lore, thumbnail, stat bars, and "FLY THIS SHIP" button.

**3D Artist** -- file upload flow for custom `.glb` models (pipeline coming soon).

A dynamic hero banner at the top changes title/subtitle based on the current phase.

### hangarTypes.ts

**File:** `components/hangar/hangarTypes.ts`

Defines the bridge types between `ShipDef` (engine catalog) and `HangarShip` (UI display type). Key exports:

- `HangarContext` -- `"hangar" | "forge"`
- `HangarShip` -- UI display interface with `id`, `name`, `class`, `imageUrl`, `status`, `cargoSpace`, `hardpoints`, `droneBay`, `description`, `modelId`, `creator`, `source`, `_shipDef`.
- `CommunityShipMeta` -- metadata from the forge catalog API.
- `toHangarShip()` / `communityToHangarShip()` -- adapter functions.
- `buildShipDef()` -- constructs a `ShipDef` from community metadata.
- `CLASS_COLOR` -- color map for ship class badges.

---

## Sidebar Panels

The sidebar (`Sidebar.tsx`) is a scrollable `<aside>` containing the logo, radar, ship diagnostics, cargo panel, ship selector, and a hangar button. It is hidden during docked state, editor mode, FPV mode, and on mobile.

### 1. RadarPanel

**File:** `sidebar/RadarPanel.tsx`

**Reads:** `gameState.ship.position`, `gameState.ship.heading`, `gameState.radarContacts`.

**Callbacks:** None (display only).

**Description:** An SVG radar scope (160px default). Draws range rings, crosshairs, a scanner cone (60-degree wedge with radial gradient), and contact dots. Planets are blue circles; ships are green. Contacts in the scanner cone appear at full opacity with a ping pulse animation. Supports a `compact` prop for the mobile mini-radar (90px, no panel header).

### 2. ShipDiagnosticPanel

**File:** `sidebar/ShipDiagnosticPanel.tsx`

**Reads:** `gameState.currentShipId`. Looks up `ShipCatalog` internally for stats and model path.

**Callbacks:** None (color change removed from sidebar).

**Description:** A rotating green wireframe 3D preview of the current ship (its own mini Three.js renderer, 210x150px). Below: the ship class label and four stat bars (SPD, ARM, CRG, FPR) rendered as block characters.

### 3. ShipSelectorPanel

**File:** `sidebar/ShipSelectorPanel.tsx`

**Reads:** `gameState.currentShipId`. Uses `SHIP_CATALOG` directly (includes both built-in and community ships restored from localStorage).

**Callbacks:** `onShipChange(shipId)` -- switches the player's ship model.

**Description:** A scrollable list of all available ships. Each row shows the ship name and class. The active ship is highlighted. Community ships appear alongside the 11 built-in ships.

### 4. CargoPanel

**File:** `sidebar/CargoPanel.tsx`

**Reads:** `credits`, `cargo`, `cargoWeight`, `cargoCapacity`, `transactions`, `marketSnapshot`.

**Callbacks:** None (display only).

**Description:** Displays the player's credit balance, cargo weight/capacity, a list of held commodities with quantities and estimated market values, and recent trade transactions. Replaced the old hardcoded CargoCredits section.

---

## Overlay Components

### ChatPanel

**File:** `ChatPanel.tsx` + `ChatPanel.css`

**Props:** `apiUrl`, `nickname`, `questComms`.

**Description:** A collapsible COMMS panel in the bottom-left. Connects to the backend via Server-Sent Events for real-time messages. Loads history on mount via `GET /api/chat/history`. Sends messages via `POST /api/chat/message`. Auto-reconnects on SSE failure (3s delay). Keeps the last 7 messages. Stays fully visible for 10 seconds on load, then fades. Minimizable via the header toggle. Also displays quest comm messages from the mission engine.

Hidden during docked state, editor mode, mobile, and FPV mode.

### NicknameEditor

**File:** `NicknameEditor.tsx` + `NicknameEditor.css`

**Props:** `nickname`, `onNicknameChange`.

**Description:** An inline callsign display that transforms into an editable input on click. Enter saves, Escape cancels. Max 16 characters. Persisted to `localStorage`.

Hidden during docked state, editor mode, mobile, and FPV mode.

### OffscreenIndicators

**File:** `OffscreenIndicators.tsx` + `OffscreenIndicators.css`

**Props:** `shipPosition`, `shipHeading`, `contacts`, `sidebarWidth`, `questTargetName?`.

**Description:** Renders floating labels at viewport edges for contacts that are off-screen. Planets are always shown; ships only appear if within the 60-degree scanner cone. Quest targets are highlighted with a distinct visual treatment. Positions are computed by projecting world-space directions onto the viewport edge with margin clamping.

Hidden during docked state, editor mode, and FPV mode.

### TouchControls

**File:** `TouchControls.tsx` + `TouchControls.css`

**Description:** Floating touch buttons for tablet/mobile. Left side: circular Thrust button (dispatches `KeyW`). Right side: two buttons for Rotate Left (`KeyA`) and Rotate Right (`KeyD`). Uses `pointerdown`/`pointerup` events and dispatches synthetic `KeyboardEvent`s on `window` so that `InputManager` picks them up without any special coupling.

Shown only on mobile/tablet breakpoints.

### CargoWarningModal

**File:** `CargoWarningModal.tsx`

**Props:** `currentWeight`, `newCapacity`, `newShipName`, `itemsToJettison`, `onConfirm`, `onCancel`.

**Description:** A modal dialog that appears when the player tries to switch to a ship with less cargo capacity than their current cargo weight. Shows what items would need to be jettisoned and their values. Confirm jettisons the excess cargo and switches ships; cancel aborts the switch.

---

## Dev Tool Panels

Config panel, FPV tuner, hero shot authoring, and hardpoint editor are documented in **[dev-tools.md](./dev-tools.md)**. Adding new config sliders is covered in **[recipes.md](./recipes.md)**.

---

## Responsive Design

> **No mobile optimization.** The mobile and tablet experience is functional but not optimized. Touch controls exist but the game is designed for desktop. Mobile/tablet should be treated as a preview, not a production experience. Expect significant UX rework before mobile is ready for players.

### useBreakpoint Hook

**File:** `hooks/useBreakpoint.ts`

Returns one of three breakpoint values based on `window.innerWidth`:

| Breakpoint | Width Range | Description |
|------------|-------------|-------------|
| `desktop` | >= 1024px | Full sidebar (240px), config panel, chat, nickname, keyboard HUD |
| `ipad` | 768-1023px | Narrower sidebar (200px), config panel, chat |
| `mobile` | < 768px | No sidebar, hamburger menu, mini radar, touch controls |

### What Changes at Each Breakpoint

**Desktop:** Full experience. Sidebar always visible at 240px. Config panel togglable. Chat panel and nickname editor in bottom-left. Keyboard control hints in HUD. Jump-back button when far from planets. Station uses `StationPanel`. Dev tools (Hero Shot, Hardpoint, Config) available.

**iPad:** Sidebar narrows to 200px. Chat panel narrows to 280px. Ship list max-height shrinks to 160px. Station uses `StationPanel`. Everything else matches desktop.

**Mobile:** Sidebar is removed entirely (`--sidebar-width: 0px`). A hamburger toggle at top-left opens a full-screen ship modal (wireframe + stats only). A mini radar appears at top-right when the modal is closed. Touch controls overlay at the bottom. Config panel, chat, nickname editor, jump-back button, FPS counter, and keyboard hints are all hidden. Station uses `StationOverlay` (CRT terminal). Dev tools are hidden.

---

## CSS Organization

### Co-located CSS Pattern

Each component has a co-located CSS file that is imported directly in the component:

| Component | CSS File |
|-----------|----------|
| `Game.tsx` | `Game.css` |
| `IntroScreen.tsx` | `IntroScreen.css` |
| `StationPanel.tsx` | `StationPanel.css` |
| `StationOverlay.tsx` | `StationOverlay.css` |
| `SummaryPanel.tsx` | `SummaryPanel.css` |
| `DockFlash.tsx` | `DockFlash.css` |
| `CommunityBoard.tsx` | `CommunityBoard.css` |
| `HangarOverlay.tsx` | `HangarOverlay.css` |
| `ShipDetail.tsx` | `ShipDetail.css` |
| `ForgeCreatePanel.tsx` | `ForgeCreatePanel.css` |
| `ChatPanel.tsx` | `ChatPanel.css` |
| `NicknameEditor.tsx` | `NicknameEditor.css` |
| `OffscreenIndicators.tsx` | `OffscreenIndicators.css` |
| `TouchControls.tsx` | `TouchControls.css` |
| `LightDebugPanel.tsx` | `LightDebugPanel.css` |
| `FpvConfigPanel.tsx` | `FpvConfigPanel.css` |
| `config/CollapsibleSection.tsx` | `CollapsibleSection.css` |

### Sidebar CSS Files

The sidebar panels share styles across files in `components/sidebar/`:

- `sidebar.css` -- sidebar container layout, panel base styles, ship list, logo, footer, forge button.
- `radar.css` -- radar scope background, ping animation.
- `diagnostic.css` -- wireframe canvas, scanline overlay, stat bars.

### Global CSS Files

- `Game.css` -- game container, canvas container, HUD positioning, loading overlay, sidebar boot animation, mobile ship modal, mini radar HUD, letterbox bars, dock button, jump-back button, quest overlays, ship loading overlay, exit comm button.
- `responsive.css` -- media queries for iPad (max-width: 1023px) and mobile (max-width: 767px). Overrides sidebar width, hides/shows elements per breakpoint.
- `index.css` -- CSS reset, base styles, font stacks, box-sizing, CSS custom properties.
- `App.css` -- intentionally empty (exists for future global overrides).

---

## Related Docs

- **[engine-guide.md](./engine-guide.md)** -- Engine systems, entities, standalone renderers
- **[dev-tools.md](./dev-tools.md)** -- Config panel, FPV tuner, hero shot, hardpoint editor, debug tools
- **[recipes.md](./recipes.md)** -- How to add components, config sliders, standalone renderers
- **[architecture.md](./architecture.md)** -- Component tree, data flows, React-Engine boundary
