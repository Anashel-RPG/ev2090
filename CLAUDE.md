# CLAUDE.md -- Project Context for AI Assistants

## Project
EV · 2090 -- a 3D space simulation game.
Live: https://ev2090.com

## Tech Stack
- React 19 + Three.js 0.172 + TypeScript 5.7 + Vite 6
- Cloudflare Workers + Durable Objects (chat backend)
- Monorepo: frontend/ (SPA) + worker/ (chat API)

## Architecture -- The One Rule
The engine (frontend/src/engine/) is pure Three.js with ZERO React dependencies.
React communicates with the engine through GameCanvasHandle (imperative ref).
The engine pushes GameState to React at ~20fps via a subscribe callback.
NEVER import React in engine/ files. NEVER import Three.js in component/ files.

## Key Files
| File | Path | Purpose |
|------|------|---------|
| Engine | `frontend/src/engine/Engine.ts` | Core game loop, scene, renderer, all subsystem orchestration |
| GameCanvas | `frontend/src/components/GameCanvas.tsx` | React-to-Engine bridge via forwardRef + useImperativeHandle |
| Game | `frontend/src/components/Game.tsx` | Top-level React orchestrator -- state, layout, breakpoints |
| Types | `frontend/src/types/game.ts` | Shared types: GameState, ShipState, RadarContact, LightConfig |
| ShipCatalog | `frontend/src/engine/ShipCatalog.ts` | Ship definitions (11 ships, stats, model/texture paths) |
| ChatRoom | `worker/src/chat-room.ts` | Durable Object -- SSE chat with message persistence |

## Directory Structure
```
frontend/src/
  components/          # React UI (Game, Sidebar, Chat, Config, HUD)
    config/            # CollapsibleSection building blocks
    sidebar/           # Right sidebar panels (Radar, Ship, Nav, Status)
  engine/              # Pure Three.js engine (NO React imports)
    entities/          # Ship, Planet, NpcShip
    systems/           # 11 subsystems (Lighting, NPC, Camera, Input, etc.)
    shaders/           # GLSL shaders as TS template literals
  hooks/               # useBreakpoint, useConfigSlider
  types/               # Shared TypeScript interfaces
worker/src/
  index.ts             # HTTP routing + CORS
  chat-room.ts         # Durable Object for SSE chat
```

## Conventions
- TypeScript strict mode throughout
- Path alias: `@/` maps to `frontend/src/`
- CSS is co-located with components (ChatPanel.tsx + ChatPanel.css)
- No CSS-in-JS; plain CSS with co-located files
- responsive.css contains ALL media queries
- Systems follow pattern: constructor(scene, ...) + update(dt) + dispose()
- Entities follow pattern: constructor(config) + update(dt) + dispose()
- Shaders are TypeScript files exporting template literal strings
- Use useConfigSlider hook for new config panel sliders

## Common Tasks

### 1. Add a new engine system
1. Create class in `frontend/src/engine/systems/MySystem.ts`
2. Pattern: `constructor(scene, ...)`, `update(dt)`, `dispose()`
3. Import and instantiate in `Engine` constructor
4. Call `update(dt)` in the game loop (Engine.loop)
5. Call `dispose()` from `Engine.dispose()`

### 2. Add a new React component
1. Create `MyComponent.tsx` + `MyComponent.css` in `components/`
2. Add to `Game.tsx` render tree
3. Read engine state from the `gameState` prop passed down from Game
4. To call engine methods, add to GameCanvasHandle interface and implementation

### 3. Add a config panel slider
1. Add a default value to DEFAULTS in `LightDebugPanel.tsx`
2. Create a `useConfigSlider({ initial, onChange })` instance
3. Add a `<CollapsibleSection>` or add to an existing section
4. Wire up the reset handler for the section
5. Include in the COPY CONFIG output object

### 4. Add a new ship
1. Add a `ShipDef` entry to the SHIP_CATALOG array in `ShipCatalog.ts`
2. Place GLTF model + texture PNGs in `public/models/{id}/`
3. Follow naming: `{Name}_Blue.png`, `{Name}_Green.png`, etc.
4. Ship appears automatically in the ship selector panel

## Dev Environment
- `npm install` at root (installs both workspaces)
- `npm run dev` starts frontend (5180) + worker (8787)
- `npm run dev:frontend` for frontend only (chat proxied to production)
- `npm run deploy` builds + deploys frontend to Cloudflare Pages
- `npm run deploy:api` deploys worker to Cloudflare Workers
- Console: `config()` toggles config panel, `testship()` spawns NPC, `B` toggles debug beam
- COPY CONFIG button exports all settings as JSON

## Gotchas
- Engine is pure Three.js -- NEVER add React imports to engine/ files
- CSS is co-located -- do NOT put component styles in App.css
- Use useConfigSlider for new config sliders (not raw useState)
- GameCanvas uses forwardRef + useImperativeHandle -- add new engine methods there
- NpcShip state machine: APPROACHING -> DOCKING -> DOCKED -> DEPARTING -> DONE
- Three.js objects MUST be disposed in dispose() methods (prevent memory leaks)
- The engine pushes state every 3rd frame (~20fps) to avoid React re-render overhead
- The Vite proxy handles /api/chat in dev -- no need to run the worker locally
- 11 ships in catalog -- Striker, Bob, Challenger, Dispatcher, Executioner, Imperial, Insurgent, Omen, Pancake, Spitfire, Zenith
