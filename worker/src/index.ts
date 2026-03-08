/**
 * Escape Velocity — API Worker
 * Cloudflare Worker with Durable Objects for chat, community board,
 * ship forge, and NPC economy simulation.
 *
 * Routes:
 *   /api/chat/*    → ChatRoom DO (SSE chat)
 *   /api/board/*   → BoardRoom DO (community notes)
 *   /api/forge/*   → ShipForge DO (AI ship pipeline)
 *   /api/market/*  → EconomyRegion DO (NPC economy)
 *   /api/admin/*   → Admin endpoints (auth required)
 */

export { ChatRoom } from "./chat-room";
export { BoardRoom } from "./board-room";
export { ShipForge } from "./ship-forge";
export { EconomyRegionDO } from "./economy-region";
import { preflightHeaders, applyCors } from "./cors";
import { handleAdminRoute, handleAdminSeed, requireAdminAuth } from "./admin";

interface MeshyPollMessage {
  jobId: string;
  meshyTaskId: string;
  attempt: number;
}

interface Env {
  CHAT_ROOM: DurableObjectNamespace;
  BOARD_ROOM: DurableObjectNamespace;
  SHIP_FORGE: DurableObjectNamespace;
  ECONOMY_REGION: DurableObjectNamespace;
  SHIP_MODELS: R2Bucket;
  STATIC_DATA: R2Bucket;
  IMAGES: ImagesBinding;  // Cloudflare Images binding
  MESHY_QUEUE: Queue<MeshyPollMessage>;
  FORGE_LOCKED: string;
  FORGE_API_KEY: string;
  ADMIN_API_KEY: string;
}

const WORKER_VERSION = "2026-02-28.1";

/* CORS is now handled by the shared cors.ts module — see preflightHeaders() + applyCors(). */

const MAX_POLL_ATTEMPTS = 60; // 60 × 10s = 10 min timeout
const POLL_DELAY_SECONDS = 10;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight — validated origin only (no wildcard)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: preflightHeaders(request) });
    }

    const url = new URL(request.url);

    // Route /api/chat/* to the ChatRoom Durable Object
    if (url.pathname.startsWith("/api/chat")) {
      const id = env.CHAT_ROOM.idFromName("global");
      const stub = env.CHAT_ROOM.get(id);

      // Forward with path stripped to just the action part
      const rawPath = url.pathname.slice("/api/chat".length) || "/";
      const normalizedPath = `/${rawPath}`.replace(/^\/+/, "/");
      const doUrl = new URL(normalizedPath, url.origin);
      doUrl.search = url.search;

      const res = await stub.fetch(new Request(doUrl.toString(), request));
      return applyCors(res, request);
    }

    // Route /api/board/* to the BoardRoom Durable Object
    if (url.pathname.startsWith("/api/board")) {
      const id = env.BOARD_ROOM.idFromName("global");
      const stub = env.BOARD_ROOM.get(id);

      const rawPath = url.pathname.slice("/api/board".length) || "/";
      const normalizedPath = `/${rawPath}`.replace(/^\/+/, "/");
      const doUrl = new URL(normalizedPath, url.origin);
      doUrl.search = url.search;

      const res = await stub.fetch(new Request(doUrl.toString(), request));
      return applyCors(res, request);
    }

    // Route /api/forge/* to the ShipForge Durable Object
    if (url.pathname.startsWith("/api/forge")) {
      const id = env.SHIP_FORGE.idFromName("global");
      const stub = env.SHIP_FORGE.get(id);

      const rawPath = url.pathname.slice("/api/forge".length) || "/";
      const normalizedPath = `/${rawPath}`.replace(/^\/+/, "/");
      const doUrl = new URL(normalizedPath, url.origin);
      doUrl.search = url.search;

      const res = await stub.fetch(new Request(doUrl.toString(), request));
      return applyCors(res, request);
    }

    // Route /api/market/* to the EconomyRegion Durable Object
    if (url.pathname.startsWith("/api/market")) {
      const rawPath = url.pathname.slice("/api/market".length) || "/";
      const normalizedPath = `/${rawPath}`.replace(/^\/+/, "/");

      // Write/admin endpoints require auth — these are used by MCP and admin tools.
      // Public read endpoints (snapshot, history, prices, routes, disruptions) pass through.
      const isWriteEndpoint =
        normalizedPath === "/set-stock" ||
        normalizedPath === "/set-rates" ||
        normalizedPath === "/set-capacity" ||
        normalizedPath === "/create-route" ||
        normalizedPath === "/rebalance-consumption" ||
        normalizedPath === "/raw-query" ||
        normalizedPath === "/raw-mutate" ||
        normalizedPath === "/schema" ||
        normalizedPath === "/state" ||
        normalizedPath === "/diagnostics" ||
        normalizedPath === "/tick-stats" ||
        normalizedPath === "/summary" ||
        normalizedPath === "/disrupt" ||
        normalizedPath === "/warmup" ||
        normalizedPath.startsWith("/route/") ||
        normalizedPath.startsWith("/disruption/");

      if (isWriteEndpoint) {
        const authError = requireAdminAuth(request, env);
        if (authError) return applyCors(authError, request);
      }

      const id = env.ECONOMY_REGION.idFromName("core-worlds");
      const stub = env.ECONOMY_REGION.get(id);

      const doUrl = new URL(normalizedPath, url.origin);
      doUrl.search = url.search;

      const res = await stub.fetch(new Request(doUrl.toString(), request));
      return applyCors(res, request);
    }

    // Route /api/admin/* — auth required
    if (url.pathname.startsWith("/api/admin")) {
      const authError = requireAdminAuth(request, env);
      if (authError) return applyCors(authError, request);

      const res = await handleAdminRoute(request, url, env);
      return applyCors(res, request);
    }

    // Dev-only: seed + warmup the local economy in one shot.
    // Only available when ADMIN_API_KEY is not set (i.e., local wrangler dev).
    if (url.pathname === "/api/dev/seed" && request.method === "POST") {
      if (env.ADMIN_API_KEY) {
        return applyCors(
          new Response(JSON.stringify({ error: "Not available in production" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
          request,
        );
      }
      const force = url.searchParams.get("force") === "true";
      const res = await handleAdminSeed(env, force);
      return applyCors(res, request);
    }

    // Health-check / root — no route map (avoid exposing API surface)
    const root = new Response(
      JSON.stringify({
        service: "escape-velocity",
        version: WORKER_VERSION,
        status: "ok",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
    return applyCors(root, request);
  },

  /* ─── Queue Consumer: MeshyAI polling ─── */

  async queue(batch: MessageBatch<MeshyPollMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { jobId, meshyTaskId, attempt } = msg.body;

      // Safety timeout: abandon after MAX_POLL_ATTEMPTS
      if (attempt > MAX_POLL_ATTEMPTS) {
        console.error(`Job ${jobId} timed out after ${attempt} attempts`);
        // Mark failed via DO
        const id = env.SHIP_FORGE.idFromName("global");
        const stub = env.SHIP_FORGE.get(id);
        await stub.fetch(new Request("https://internal/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, meshyTaskId }),
        }));
        msg.ack();
        continue;
      }

      try {
        // Call into the DO to poll MeshyAI and update job state
        const id = env.SHIP_FORGE.idFromName("global");
        const stub = env.SHIP_FORGE.get(id);
        const res = await stub.fetch(new Request("https://internal/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, meshyTaskId }),
        }));

        const result = (await res.json()) as { action: string; reason?: string };

        if (result.action === "done") {
          console.log(`Job ${jobId} done: ${result.reason}`);
          msg.ack();
        } else {
          // Still in progress — ack this message, send a fresh one with delay
          msg.ack();
          await env.MESHY_QUEUE.send(
            { jobId, meshyTaskId, attempt: attempt + 1 },
            { delaySeconds: POLL_DELAY_SECONDS },
          );
        }
      } catch (err) {
        console.error(`Queue poll error for job ${jobId}:`, err);
        // Ack + re-queue to avoid stuck retry loops
        msg.ack();
        await env.MESHY_QUEUE.send(
          { jobId, meshyTaskId, attempt: attempt + 1 },
          { delaySeconds: POLL_DELAY_SECONDS },
        );
      }
    }
  },
};
