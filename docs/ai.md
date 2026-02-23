# AI-Assisted Development Guide

You use an AI coding assistant to help you develop? Great -- so do I. This page explains the two context files I've prepared and why every rule in them exists.

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
- **Tech stack** -- React 19, Three.js 0.172, TypeScript 5.7, Vite 6, Cloudflare Workers
- **Monorepo layout** -- `frontend/` and `worker/` as separate npm workspaces

### The One Rule (architecture boundary)

This is the most important section. The engine (`frontend/src/engine/`) is **pure Three.js with zero React dependencies**. React communicates with the engine through a single bridge: `GameCanvasHandle`, an imperative ref exposed by `GameCanvas.tsx`.

**Why this rule exists:**

- **Separation of concerns.** The engine can run without React. React can re-render without touching the scene graph. This makes both sides independently testable and replaceable.
- **Performance.** React re-renders are expensive in a 60fps game loop. By pushing state from the engine to React at only ~20fps via a subscribe callback, this avoids triggering React's reconciler on every frame.
- **Preventing accidental coupling.** Without this rule, it's tempting to `import { useState } from 'react'` inside an engine system or `import * as THREE from 'three'` in a component. Both break the architecture and create debugging nightmares.

The AI files make this rule explicit:
- *"NEVER import React in engine/ files."*
- *"NEVER import Three.js in component/ files."*
- *"When editing engine files: Do NOT use JSX syntax."*

### Key files and directory structure

The AI gets a map of the 6 most important files and a tree of every directory with one-line descriptions. This prevents the AI from exploring blindly or creating files in the wrong location.

### Conventions

Rules the AI must follow to keep code consistent:

| Convention | Why |
|-----------|-----|
| **TypeScript strict mode** | Catches bugs early, enforces type safety |
| **Co-located CSS** | Each component has a paired `.css` file -- keeps styles discoverable and prevents the monolithic CSS problem I already solved |
| **responsive.css for ALL media queries** | One file to audit for breakpoint behavior instead of hunting across dozens of files |
| **Systems pattern: constructor + update + dispose** | Every engine subsystem follows the same shape, making the codebase predictable |
| **Entities pattern: constructor + update + dispose** | Same consistency for game objects |
| **Shaders as TS template literals** | Keeps GLSL co-located with the TypeScript that uses it while enabling syntax highlighting via `/* glsl */` comments |
| **useConfigSlider for new sliders** | Eliminates the `useState` + `useCallback` boilerplate that used to plague the config panel |
| **dispose() is mandatory** | Three.js objects leak GPU memory if not explicitly disposed. The AI must always generate cleanup code. |

### Common tasks

Step-by-step recipes for the 4 most frequent operations:

1. **Add a new engine system** -- so the AI creates the file in the right place with the right pattern and wires it into the game loop
2. **Add a new React component** -- so it creates both `.tsx` and `.css`, adds it to `Game.tsx`, and uses `gameState` correctly
3. **Add a config slider** -- so it uses `useConfigSlider` instead of raw state, and includes the slider in COPY CONFIG and the reset handler
4. **Add a new ship** -- so it knows about `ShipCatalog.ts`, the model path convention, and the texture naming pattern

### Dev environment

The AI knows how to run the project (`npm run dev`), what ports to expect (5180, 8787), and the console shortcuts (`config()`, `testship()`, `B`). This prevents it from guessing or suggesting incorrect commands.

### Gotchas

A list of traps that would waste your time if the AI fell into them:

- **Don't put component CSS in App.css** -- I split that monolithic file on purpose
- **Don't use raw useState for config sliders** -- `useConfigSlider` exists for this
- **NpcShip has a 5-state machine** -- the AI needs to know the state flow to modify NPC behavior correctly
- **The Vite proxy handles chat in dev** -- no need to run the worker locally, and the AI shouldn't suggest it
- **GameCanvasHandle is the only bridge** -- the AI should never try to pass the Engine instance directly to React

---

## Tips for getting the best results

1. **Point your AI at a specific guide.** If you're working on the engine, tell it to read `docs/engine-guide.md`. If you're working on the UI, point it to `docs/ui-guide.md`. The more context it has, the better its suggestions.

2. **Reference the architecture diagram.** If the AI suggests something that crosses the React-Engine boundary, push back. The Mermaid diagrams in `docs/architecture.md` make the boundary crystal clear.

3. **Use COPY CONFIG.** The config panel's COPY CONFIG button exports all current engine settings as JSON. Paste this into your AI conversation when you're debugging visual issues -- it gives the AI exact parameter values.

4. **Ask the AI to follow the patterns.** If you say "add a new system following the pattern in the engine guide," the AI will produce consistent code that fits right in.

---

## Keeping the files up to date

When you add a new convention, system, or common task:

1. Update `CLAUDE.md` (dense reference format)
2. Update `.cursorrules` (imperative directive format)
3. Update this file if the change deserves an explanation of *why*

The AI context files are only as good as they are current. A few minutes of maintenance saves hours of correcting AI suggestions.
