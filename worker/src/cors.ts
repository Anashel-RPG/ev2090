/**
 * Shared CORS utilities for EV 2090 workers.
 *
 * Instead of `Access-Control-Allow-Origin: *`, we validate the request's
 * Origin header against a known allowlist and reflect only that origin.
 *
 * Applied at the router level (index.ts) so Durable Objects don't need
 * changes — their internal `*` headers get overridden before reaching
 * the browser.
 */

const ALLOWED_ORIGINS = new Set([
  "https://ev2090.com",
  "https://www.ev2090.com",
  // admin.ev2090.com intentionally excluded — admin dashboard is local-only
]);

/** Localhost is safe to allow — only reachable from the dev machine. */
const LOCALHOST_RE = /^http:\/\/localhost:\d+$/;

/** Cloudflare Pages preview deployments (e.g. abc123.ev2090.pages.dev). */
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.ev2090\.pages\.dev$/;

/**
 * Validate the request's Origin header against the allowlist.
 * Returns the origin string if allowed, or null if missing/unknown.
 */
export function validateOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  if (LOCALHOST_RE.test(origin)) return origin;
  if (PAGES_PREVIEW_RE.test(origin)) return origin;
  return null;
}

/**
 * CORS headers for a preflight OPTIONS response.
 * If the origin is not recognized, returns only `Vary: Origin`
 * (browser will block the preflight → subsequent request never fires).
 */
export function preflightHeaders(request: Request): Record<string, string> {
  const origin = validateOrigin(request);
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

/**
 * Replace the CORS headers on a Response that came from a Durable Object.
 *
 * The DO may have set `Access-Control-Allow-Origin: *`; we narrow it to
 * the validated origin (or strip it entirely for unknown callers).
 * All other response headers (Content-Type, Cache-Control, etc.) are preserved.
 */
export function applyCors(response: Response, request: Request): Response {
  const origin = validateOrigin(request);
  const headers = new Headers(response.headers);

  // Strip any wildcard CORS the DO may have set
  headers.delete("Access-Control-Allow-Origin");
  headers.delete("Access-Control-Allow-Methods");
  headers.delete("Access-Control-Allow-Headers");

  // Apply validated origin
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
