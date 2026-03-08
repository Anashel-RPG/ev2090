/**
 * Internal API client for calling the game worker (ev-2090-ws).
 *
 * Uses the service binding (GAME_API) for zero-latency internal calls,
 * or falls back to DO bindings for direct access.
 */

import type { Env } from "../types";

/**
 * Call an admin API endpoint on the game worker via service binding.
 */
export async function callAdminApi(
  env: Env,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  } = {}
): Promise<unknown> {
  const { method = "GET", body, query } = options;

  // Build URL with query params
  let url = `https://internal/api/admin${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const res = await env.GAME_API.fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin API error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Call the EconomyRegion DO directly via its namespace binding.
 */
export async function callEconomyDO(
  env: Env,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  } = {}
): Promise<unknown> {
  const { method = "GET", body, query } = options;

  const id = env.ECONOMY_REGION.idFromName("core-worlds");
  const stub = env.ECONOMY_REGION.get(id);

  let url = `https://internal${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await stub.fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EconomyDO error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Call the ChatRoom DO directly.
 */
export async function callChatDO(
  env: Env,
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const { method = "GET", body } = options;

  const id = env.CHAT_ROOM.idFromName("global");
  const stub = env.CHAT_ROOM.get(id);

  const res = await stub.fetch(`https://internal${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ChatDO error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Call the BoardRoom DO directly.
 */
export async function callBoardDO(
  env: Env,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  } = {}
): Promise<unknown> {
  const { method = "GET", body, query } = options;

  const id = env.BOARD_ROOM.idFromName("global");
  const stub = env.BOARD_ROOM.get(id);

  let url = `https://internal${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await stub.fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BoardDO error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Call the ShipForge DO directly.
 */
export async function callForgeDO(
  env: Env,
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const { method = "GET", body } = options;

  const id = env.SHIP_FORGE.idFromName("global");
  const stub = env.SHIP_FORGE.get(id);

  const res = await stub.fetch(`https://internal${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ForgeDO error (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Get an R2 bucket reference by name.
 */
export function getR2Bucket(env: Env, bucket: string): R2Bucket {
  if (bucket === "ships") return env.SHIP_MODELS;
  return env.STATIC_DATA;
}
