[← Back to index](/README.md)

# Dev Tools

> **Temporary.** These tools exist for tuning and authoring during active development. They will either be removed from the project or consolidated into a dedicated tuning toolset. Do not build features on top of them.

---

## Console Commands

Development helpers exposed on `window` from `Game.tsx`:

| Command | Action |
|---------|--------|
| `config()` | Toggle the config/tuning panel |
| `testship()` | Spawn a frozen test NPC near the player |
| `heroshot()` | Toggle Hero Shot authoring panel |
| `hardpoints()` | Toggle Hardpoint Editor |
| `forge()` | Toggle the Hangar/Forge overlay |
| `ship("bob")` | Switch ship by catalog ID |
| `zoom(0.3)` | Zoom camera (lower = closer) |
| `zoomreset()` | Reset zoom to default |
| `reset()` | Clear localStorage + IndexedDB cache and reload |
| `B` key | Toggle debug beam |
| `window.__engine` | Direct Engine instance access |

## URL Debug Shortcuts

Add `?scene=X` to the URL to skip directly to a game state:

| Param | Effect |
|-------|--------|
| `?scene=gameplay` | Skip intro, go straight to flight |
| `?scene=docked` | Skip intro, auto-dock at Nexara |
| `?scene=heroshot` | Skip intro, open Hero Shot panel |
| `?scene=hardpoint` | Skip intro, open Hardpoint Editor |
| `?scene=config` | Skip intro, open Config panel |
| `?scene=intro` | Force the intro/ship-select screen |

---

## Config Panel (LightDebugPanel)

**Files:** `components/LightDebugPanel.tsx` + `LightDebugPanel.css`

A floating debug overlay for tuning lights, materials, camera, shield shader, and ship orientation in real time. Toggle with `config()` in the console.

Contains 8 collapsible sections: Debug Tools, Camera, Sidebar Glass, Background, Shield, Ship Model, Lighting (14 sliders), and Material. Has a COPY CONFIG button that exports all values as JSON.

Built with `useConfigSlider` hook (`hooks/useConfigSlider.ts`) and `CollapsibleSection` component (`config/CollapsibleSection.tsx`).

---

## FPV Config Panel

**Files:** `components/FpvConfigPanel.tsx` + `FpvConfigPanel.css`

A temporary authoring panel for tuning first-person view post-processing parameters. Only visible when FPV is fully active. Contains sliders for camera position, bank angles, vignette, bloom, color correction, and lighting. Includes a COPY button.

---

## Hero Shot Authoring

> **Work in progress.** The hero camera system is under active development and subject to significant changes.

**React:** `components/HeroShotPanel.tsx`
**Engine:** `engine/systems/HeroCamera.ts`

Cinematic screenshot authoring tool. Enters a special camera mode to frame ships and planets for promotional images. Controls camera orbit, ship rotation/tilt/roll/scale, and offers preset compositions with animated transitions. Only available on desktop/iPad.

---

## Hardpoint Editor

> **Work in progress.** The hardpoint editor is under active development.

**React:** `components/HardpointPanel.tsx`
**Engine:** `engine/systems/HardpointEditor.ts`

Ship annotation and hardpoint placement tool. Isolates the ship on a neutral background with its own orbit camera, editor lights, and HTML/SVG label overlay. Supports:

- Click-to-place colored markers (thruster, weapon, bridge, hull, shield)
- Fine X/Y/Z adjustment with axis-constrained drag
- Thrust direction arrows for thruster hardpoints
- Live material tuning
- JSON export of hardpoint data

---

## Bridge View

> **Under development.** The bridge/cockpit view is actively being built and will change significantly.

**Files:** `engine/entities/Bridge.ts`, `engine/systems/BridgeEditor.ts`

First-person cockpit view that renders a 3D bridge interior from the pilot's perspective. Currently in early prototype stage.

---

## Debug Beam

**File:** `engine/systems/DebugBeam.ts`

Renders a red ray from the player ship in the forward direction, with hit markers on scanned NPCs. Toggle with `B` key or the config panel.

---

## Orbit Controls

**File:** `engine/systems/OrbitControls.ts`

Mouse-driven orbit camera for the debug orbit view. Handles drag-to-rotate and scroll-to-zoom. Activated via the config panel's camera view buttons.

---

## Related Docs

- **[engine-guide.md](./engine-guide.md)** -- Engine systems and entities (production systems)
- **[ui-guide.md](./ui-guide.md)** -- React components (production UI)
- **[recipes.md](./recipes.md)** -- How to add new config sliders
