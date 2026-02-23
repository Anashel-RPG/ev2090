# Components

React components for the game UI. The engine runs independently in a canvas -- React handles layout, HUD, sidebar, chat, and the config panel.

## Component Tree

```
Game.tsx (orchestrator)
├── GameCanvas (Three.js canvas, engine ref)
├── LightDebugPanel (config UI -- collapsible sections)
├── Sidebar (desktop/ipad)
│   ├── RadarPanel (SVG scanner)
│   ├── ShipDiagnosticPanel (wireframe + stats)
│   ├── ShipSelectorPanel (ship picker)
│   ├── ShipStatusPanel (hull/shield/fuel)
│   ├── TargetPanel (target info)
│   └── NavigationPanel (coordinates)
├── ChatPanel (SSE multiplayer chat)
├── NicknameEditor (player name)
├── OffscreenIndicators (direction arrows)
└── TouchControls (mobile joystick)
```

### Component Descriptions

| Component              | File                          | Purpose                                                                      |
| ---------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| **Game**               | `Game.tsx`                    | Top-level layout orchestrator. Manages game state, wires up engine callbacks, controls which panels are visible based on breakpoint. |
| **GameCanvas**         | `GameCanvas.tsx`              | Mounts the Three.js `<canvas>`, creates the Engine instance, and exposes an imperative handle (`GameCanvasHandle`) so Game.tsx can call engine methods (change ship, update lights, set camera view). |
| **LightDebugPanel**    | `LightDebugPanel.tsx`         | Config panel with collapsible sections for lights, shield, camera, background, and material. Uses sliders to tweak engine values in real time. Hidden by default -- toggle with `config()` in the console. |
| **ChatPanel**          | `ChatPanel.tsx`               | Multiplayer chat. Connects to the worker via SSE for incoming messages and sends outgoing messages via HTTP POST. Handles reconnection and nickname display. |
| **NicknameEditor**     | `NicknameEditor.tsx`          | Inline editable player name. Persists to localStorage.                       |
| **OffscreenIndicators**| `OffscreenIndicators.tsx`     | Renders directional arrows at screen edges pointing toward offscreen NPCs and planets. |
| **TouchControls**      | `TouchControls.tsx`           | Virtual joystick for mobile devices. Appears only on touch-capable screens.  |

### Sidebar Panels (`sidebar/`)

| Panel                  | File                          | Purpose                                                    |
| ---------------------- | ----------------------------- | ---------------------------------------------------------- |
| **Sidebar**            | `Sidebar.tsx`                 | Container that arranges child panels in a vertical stack.  |
| **RadarPanel**         | `RadarPanel.tsx`              | SVG-based radar display showing nearby contacts as blips with a rotating sweep line. |
| **ShipDiagnosticPanel**| `ShipDiagnosticPanel.tsx`     | Renders a wireframe diagram of the current ship with labeled stats. |
| **ShipSelectorPanel**  | `ShipSelectorPanel.tsx`       | Grid of available ships. Clicking a ship tells the engine to swap models. |
| **ShipStatusPanel**    | `ShipStatusPanel.tsx`         | Horizontal bars for hull integrity, shield strength, and fuel level. |
| **TargetPanel**        | `TargetPanel.tsx`             | Displays information about the currently targeted NPC (name, distance, bearing). |
| **NavigationPanel**    | `NavigationPanel.tsx`         | Shows the player ship's current coordinates and heading.   |

### Config Utilities (`config/`)

| Component              | File                             | Purpose                                              |
| ---------------------- | -------------------------------- | ---------------------------------------------------- |
| **CollapsibleSection** | `config/CollapsibleSection.tsx`  | Reusable accordion section for the config panel. Renders a clickable header that toggles content visibility. |

## Responsive Design

The app uses 4 breakpoints, managed by the `useBreakpoint` hook:

| Breakpoint | Width Range  | Behavior                                              |
| ---------- | ------------ | ----------------------------------------------------- |
| desktop    | >= 1024px    | Sidebar fixed on right, full HUD visible              |
| ipad       | 768 - 1023px | Sidebar fixed on right, slightly narrower             |
| tablet     | 576 - 767px  | Sidebar hidden, minimal HUD                           |
| mobile     | < 576px      | Sidebar hidden, touch controls appear, compact layout |

## CSS Organization

Each component has co-located CSS:

- `ChatPanel.tsx` pairs with `ChatPanel.css`
- `LightDebugPanel.tsx` pairs with `LightDebugPanel.css`
- Sidebar styles live in `sidebar/sidebar.css`, `sidebar/radar.css`, `sidebar/diagnostic.css`
- Config styles in `config/CollapsibleSection.css`

Global styles:

| File             | Contents                                        |
| ---------------- | ----------------------------------------------- |
| `App.css`        | Root layout, canvas positioning, main grid      |
| `responsive.css` | All media queries for every breakpoint           |
| `index.css`      | Base CSS reset and font                          |

## Config Panel

The `LightDebugPanel` provides real-time tuning of engine parameters. It is hidden by default and toggled by typing `config()` in the browser console.

Sections include:

- **Lights** -- intensity, position, and color for each of the 5 scene lights (ambient, hemisphere, key, fill, rim).
- **Shield** -- Fresnel power, opacity, hit intensity, and oval shape parameters for the NPC energy shield shader.
- **Camera** -- field of view, distance, and angle offsets for each camera mode.
- **Background** -- nebula opacity, starfield density, background image blend.
- **Material** -- metalness, roughness, and emissive intensity for ship models.

The panel uses the `CollapsibleSection` component for each group and the `useConfigSlider` hook for individual slider controls. The **COPY CONFIG** button serializes all current engine settings to JSON on the clipboard.
