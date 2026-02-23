/**
 * Escape Velocity — Chat Worker
 * Cloudflare Worker with Durable Object for SSE-based chat.
 *
 * Routes:
 *   GET  /api/chat/stream   → SSE stream of chat messages
 *   POST /api/chat/message   → Send a message { nickname, text }
 *   GET  /api/chat/history   → Last 10 messages (JSON)
 */

export { ChatRoom } from "./chat-room";

interface Env {
  CHAT_ROOM: DurableObjectNamespace;
}

const WORKER_VERSION = "2026-02-23.2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
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

      return stub.fetch(new Request(doUrl.toString(), request));
    }

    return new Response(
      JSON.stringify({
        service: "escape-velocity-chat",
        version: WORKER_VERSION,
        now: new Date().toISOString(),
        routes: {
          stream: "/api/chat/stream",
          message: "/api/chat/message",
          history: "/api/chat/history",
        },
      }),
      {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-EV-Worker-Version": WORKER_VERSION,
        },
      },
    );
  },
};
