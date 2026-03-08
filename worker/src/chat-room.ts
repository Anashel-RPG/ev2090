/**
 * ChatRoom — Durable Object for real-time SSE chat.
 *
 * Holds last 10 messages in memory and streams them to connected clients.
 * Sends periodic pings to keep connections alive.
 */

interface ChatMessage {
  id: string;
  nickname: string;
  text: string;
  timestamp: number;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_MESSAGES = 7;
const PING_INTERVAL_MS = 15_000;
const RATE_LIMIT_WINDOW_MS = 10_000; // 10-second sliding window
const RATE_LIMIT_MAX = 5;            // max 5 messages per window

export class ChatRoom implements DurableObject {
  private messages: ChatMessage[] = [];
  private writers: Set<WritableStreamDefaultWriter<Uint8Array>> = new Set();
  private encoder = new TextEncoder();
  private state: DurableObjectState;
  /** IP → list of recent message timestamps for rate limiting */
  private rateLimits: Map<string, number[]> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
    // Load persisted messages before handling any requests
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<ChatMessage[]>("messages");
      if (stored && Array.isArray(stored)) {
        this.messages = stored.slice(-MAX_MESSAGES);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/stream" || url.pathname === "/stream/") {
      return this.handleStream(request);
    }

    if (
      (url.pathname === "/message" || url.pathname === "/message/") &&
      request.method === "POST"
    ) {
      return this.handleMessage(request);
    }

    if (url.pathname === "/history" || url.pathname === "/history/") {
      return new Response(JSON.stringify(this.messages), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }

  private async handleStream(request: Request): Promise<Response> {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    this.writers.add(writer);

    const cleanup = () => {
      if (this.writers.delete(writer)) {
        try {
          writer.close();
        } catch {
          /* ignore */
        }
      }
    };

    request.signal.addEventListener("abort", cleanup, { once: true });
    writer.closed.then(cleanup).catch(cleanup);

    // Write initial flush + history AFTER returning the response.
    // Cloudflare Workers won't send response headers until the first
    // chunk is pulled from the readable side, so we must return first
    // and let the runtime start reading before we push data.
    this.state.waitUntil(
      (async () => {
        // Flush headers immediately with an SSE comment
        try {
          await writer.write(this.encoder.encode(`: connected\n\n`));
        } catch {
          cleanup();
          return;
        }

        // Send current history as initial events
        for (const msg of this.messages) {
          try {
            await writer.write(
              this.encoder.encode(`data: ${JSON.stringify(msg)}\n\n`),
            );
          } catch {
            cleanup();
            return;
          }
        }

        // Schedule ping alarm if not already set
        this.schedulePing();
      })(),
    );

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...CORS_HEADERS,
      },
    });
  }

  private isRateLimited(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.rateLimits.get(ip) ?? [];
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) return true;
    recent.push(now);
    this.rateLimits.set(ip, recent);
    // Prevent unbounded map growth: prune stale IPs every ~100 entries
    if (this.rateLimits.size > 200) {
      for (const [key, ts] of this.rateLimits) {
        if (ts.every((t) => now - t > RATE_LIMIT_WINDOW_MS)) this.rateLimits.delete(key);
      }
    }
    return false;
  }

  private async handleMessage(request: Request): Promise<Response> {
    try {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (this.isRateLimited(ip)) {
        return new Response(JSON.stringify({ error: "Too many messages" }), {
          status: 429,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const body = (await request.json()) as {
        nickname?: string;
        text?: string;
      };

      const text = (body.text || "").trim();
      if (!text) {
        return new Response(JSON.stringify({ error: "Empty message" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        nickname: (body.nickname || "Anonymous").slice(0, 16),
        text: text.slice(0, 200),
        timestamp: Date.now(),
      };

      this.messages.push(message);
      if (this.messages.length > MAX_MESSAGES) {
        this.messages = this.messages.slice(-MAX_MESSAGES);
      }

      // Persist to Durable Object storage so messages survive eviction
      await this.state.storage.put("messages", this.messages);

      // Broadcast to all SSE connections
      await this.broadcast(`data: ${JSON.stringify(message)}\n\n`);

      return new Response(JSON.stringify({ ok: true, id: message.id }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
  }

  private async broadcast(data: string): Promise<void> {
    const encoded = this.encoder.encode(data);
    const dead: WritableStreamDefaultWriter[] = [];

    for (const writer of this.writers) {
      try {
        await writer.write(encoded);
      } catch {
        dead.push(writer);
      }
    }

    for (const w of dead) {
      this.writers.delete(w);
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
  }

  private async schedulePing() {
    try {
      await this.state.storage.setAlarm(Date.now() + PING_INTERVAL_MS);
    } catch {
      /* alarm already set */
    }
  }

  async alarm() {
    // Send SSE comment as keepalive ping
    await this.broadcast(`: ping ${Date.now()}\n\n`);

    // Keep pinging while clients are connected
    if (this.writers.size > 0) {
      this.schedulePing();
    }
  }
}
