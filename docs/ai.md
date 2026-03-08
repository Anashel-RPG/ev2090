[← Back to index](/README.md)

# AI-Assisted Development Guide

You use an AI coding assistant to help you develop? Great -- so do I. This page explains the context files I've prepared and why every rule in them exists.

---

## The files

| File | Tool | How it's loaded |
|------|------|-----------------|
| [`CLAUDE.md`](../CLAUDE.md) | Claude Code (CLI) | Automatically read when you open the project |
| [`.cursorrules`](../.cursorrules) | Cursor | Automatically read as project-level rules |

Both files contain the same core information formatted for their respective tools. You don't need to copy-paste anything -- just open the project in Claude Code or Cursor and the AI will already know the architecture.

---

## What's inside

### Project identity and tech stack

The AI needs to know what it's working with before it writes a single line. Both files open with:

- **Project name and live URL** -- so the AI can reference the deployed version
- **Tech stack** -- React 19, Three.js 0.172, TypeScript 5.7, Vite 6, Cloudflare Workers + Durable Objects
- **Monorepo layout** -- `frontend/`, `worker/`, `worker-mcp/`, and `admin/` as workspaces

### The One Rule (architecture boundary)

This is the most important section. The engine (`frontend/src/engine/`) is **pure Three.js with zero React dependencies**. React communicates with the engine through a single bridge: `GameCanvasHandle`, an imperative ref exposed by `GameCanvas.tsx`.

**Why this rule exists:**

- **Separation of concerns.** The engine can run without React. React can re-render without touching the scene graph. This makes both sides independently testable and replaceable.
- **Performance.** React re-renders are expensive in a 60fps game loop. By pushing state from the engine to React at only ~20fps via a subscribe callback, this avoids triggering React's reconciler on every frame.
- **Preventing accidental coupling.** Without this rule, it's tempting to `import { useState } from 'react'` inside an engine system or `import * as THREE from 'three'` in a component. Both break the architecture and create debugging nightmares.

The AI files make this rule explicit:
- *"NEVER import React in engine/ files."*
- *"NEVER import Three.js in component/ files."*

When a component needs 3D rendering (e.g. ship wireframe preview, hangar ship detail), extract the Three.js logic into an engine-side class and instantiate it from the component via `useEffect`. See `ShipPreview.ts` and `ShipDetailRenderer.ts` for the pattern.

### Key files and directory structure

The AI gets a map of the most important files and a tree of every directory with one-line descriptions. This prevents the AI from exploring blindly or creating files in the wrong location.

### Backend patterns

The AI knows about the four Durable Objects and their patterns:

- **ChatRoom** -- SSE chat, 7 messages, ping/alarm keep-alive
- **BoardRoom** -- community notes per planet station
- **ShipForge** -- AI ship generation pipeline (Grok → Gemini → MeshyAI)
- **EconomyRegionDO** -- NPC economy simulation with SQLite + 60s tick alarm

The critical pattern: **Durable Object state is dual** -- in-memory (fast) + SQLite (durable). MCP tools and admin endpoints must update BOTH. If you only update SQL, the in-memory state overwrites it on the next tick. If you only update memory, it's lost on restart.

### MCP tool patterns

The AI knows about the 37 MCP tools across 10 categories and the 3-tier access control system. When adding a new tool:

1. Define it in the appropriate `worker-mcp/src/tools/*.ts` file
2. Register it in `worker-mcp/src/tools/index.ts` with scope requirements
3. Follow the pattern: validate → extract params → call DO → format response

### Conventions

Rules the AI must follow to keep code consistent:

| Convention | Why |
|-----------|-----|
| **TypeScript strict mode** | Catches bugs early, enforces type safety |
| **Co-located CSS** | Each component has a paired `.css` file -- keeps styles discoverable |
| **responsive.css for ALL media queries** | One file to audit for breakpoint behavior |
| **Systems pattern: constructor + update + dispose** | Every engine subsystem follows the same shape |
| **Entities pattern: constructor + update + dispose** | Same consistency for game objects |
| **DO pattern: constructor + fetch + alarm** | Every Durable Object follows the same shape |
| **Shaders as TS template literals** | GLSL co-located with TypeScript via `/* glsl */` comments |
| **useConfigSlider for new sliders** | Eliminates useState + useCallback boilerplate |
| **dispose() is mandatory** | Three.js objects leak GPU memory if not explicitly disposed |
| **Dual state updates in DOs** | Always update both in-memory AND SQLite/storage |

### Common tasks

Step-by-step recipes for the most frequent operations:

1. **Add a new engine system** -- create in `systems/`, wire into Engine constructor + loop + dispose
2. **Add a new React component** -- create `.tsx` + `.css`, add to `Game.tsx`, use `gameState` prop
3. **Add a config slider** -- use `useConfigSlider`, add to CollapsibleSection, include in COPY CONFIG
4. **Add a new ship** -- add `ShipDef` to `ShipCatalog.ts`, place GLTF in `public/models/{id}/`
5. **Add a new Durable Object** -- create class, add to `wrangler.toml` bindings + migrations, wire routing
6. **Add a new admin endpoint** -- add handler in `admin.ts`, call from admin dashboard
7. **Add a new MCP tool** -- implement in `tools/*.ts`, register in `tools/index.ts` with scope

### Dev environment

The AI knows how to run the project:

| Command | What it does |
|---------|-------------|
| `npm run dev` | Frontend only (port 5180, API proxied to production) |
| `npm run dev:all` | Frontend + worker in parallel |
| `npm run dev:admin` | Admin dashboard (port 5181) |
| `npm run dev:mcp` | MCP worker locally |
| `npm run deploy` | Build + deploy frontend to Cloudflare Pages |
| `npm run deploy:api` | Deploy worker to Cloudflare Workers |
| `npm run deploy:admin` | Build + deploy admin dashboard |
| `npm run deploy:mcp` | Deploy MCP worker |

Console shortcuts: `config()`, `testship()`, `heroshot()`, `hardpoints()`, `forge()`, `ship("bob")`, `zoom(0.3)`.

### Gotchas

Traps that would waste time if the AI fell into them:

- **Don't put component CSS in App.css** -- use co-located `ComponentName.css`
- **Don't use raw useState for config sliders** -- `useConfigSlider` exists
- **NpcShip has a 5-state machine** -- know the flow before modifying NPC behavior
- **The Vite proxy handles API in dev** -- no need to run the worker locally
- **GameCanvasHandle is the only bridge** -- never pass Engine directly to React
- **Ship mesh hierarchy matters** -- `mesh` → `bankGroup` → `visualGroup` → `modelGroup`; thrusters on `mesh` directly
- **Community ships use embedded PBR in GLB** -- no separate textures, `source: "community"`
- **DO state is dual** -- update BOTH in-memory AND SQLite or you'll lose data
- **MCP scope controls** -- `ro` can't call set_*, trigger_*, delete_*, mutate_*
- **Cross-worker bindings** -- MCP worker references game worker DOs via `script_name`

---

## Tips for getting the best results

1. **Point your AI at a specific guide.** If you're working on the engine, tell it to read `docs/engine-guide.md`. If you're working on the economy, point it to `docs/economy-engine.md`. The more context it has, the better.

2. **Reference the architecture diagram.** If the AI suggests something that crosses the React-Engine boundary, push back. The diagrams in `docs/architecture.md` make the boundary clear.

3. **Use COPY CONFIG.** The config panel's COPY CONFIG button exports all current engine settings as JSON. Paste this into your AI conversation when debugging visual issues.

4. **Ask the AI to follow the patterns.** If you say "add a new system following the pattern in the engine guide," the AI will produce consistent code.

5. **For economy work, share the MCP tool list.** The AI can reason about the economy much better when it knows what tools are available. Point it at `docs/mcp-guide.md`.

---

## Keeping the files up to date

When you add a new convention, system, or common task:

1. Update `CLAUDE.md` (dense reference format)
2. Update `.cursorrules` (imperative directive format)
3. Update this file if the change deserves an explanation of *why*

The AI context files are only as good as they are current. A few minutes of maintenance saves hours of correcting AI suggestions.
