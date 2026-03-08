/**
 * Centralized URL configuration for EV 2090.
 *
 * All external URLs (API, CDN, R2 assets) are defined here with env-var
 * overrides so self-hosters can point at their own infrastructure without
 * modifying source code.
 *
 * Defaults match the production deployment (ws.ev2090.com / cdn.ev2090.com).
 * Override via .env or .env.development.local:
 *
 *   VITE_API_URL=https://your-worker.example.com
 *   VITE_CDN_URL=https://your-cdn.example.com
 *   VITE_ASSET_URL=https://your-worker.example.com/api/forge/asset
 */

/**
 * The always-absolute production worker URL.
 * Used for services that must reach the live backend even in local dev:
 * 3D model assets (R2), chat (real players), community board.
 */
const LIVE_BASE: string =
  import.meta.env.VITE_API_URL || "https://ws.ev2090.com";

/**
 * API base for local-first endpoints (market prices, economy, auth).
 * Empty in dev so Vite proxies to the local wrangler worker.
 */
export const API_BASE: string = import.meta.env.DEV
  ? ""
  : LIVE_BASE;

/** CDN base for static assets (images, audio). */
export const CDN_BASE: string =
  import.meta.env.VITE_CDN_URL || "https://cdn.ev2090.com";

/**
 * Base path for R2-served 3D assets (ship models, bridge, textures).
 * Always absolute — models live in production R2, not the local worker.
 */
export const ASSET_BASE: string =
  import.meta.env.VITE_ASSET_URL || `${LIVE_BASE}/api/forge/asset`;

/**
 * Base URL for real-time services: chat SSE and community board.
 * Always points to production so local dev joins the real player session.
 */
export const LIVE_API_BASE: string = LIVE_BASE;
