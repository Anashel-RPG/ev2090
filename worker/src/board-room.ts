/**
 * BoardRoom — Durable Object for persistent community notes.
 *
 * Players leave notes at planet stations. Notes persist and are
 * retrieved via REST (no SSE needed).
 *
 * Storage key pattern: note:{planet}:{timestamp}:{id}
 * This gives natural reverse-chronological ordering via list().
 */

interface BoardNote {
  id: string;
  nickname: string;
  text: string;
  planet: string;
  timestamp: number;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_NOTES_PER_PLANET = 100;
const MAX_TEXT_LENGTH = 280;
const MAX_WORD_COUNT = 10;
const MAX_NICKNAME_LENGTH = 16;
const RATE_LIMIT_WINDOW_MS = 30_000; // 30-second sliding window
const RATE_LIMIT_MAX = 3;            // max 3 notes per window

export class BoardRoom implements DurableObject {
  private state: DurableObjectState;
  /** IP → list of recent post timestamps for rate limiting */
  private rateLimits: Map<string, number[]> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private isRateLimited(ip: string): boolean {
    const now = Date.now();
    const timestamps = this.rateLimits.get(ip) ?? [];
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) return true;
    recent.push(now);
    this.rateLimits.set(ip, recent);
    if (this.rateLimits.size > 200) {
      for (const [key, ts] of this.rateLimits) {
        if (ts.every((t) => now - t > RATE_LIMIT_WINDOW_MS)) this.rateLimits.delete(key);
      }
    }
    return false;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (
      (url.pathname === "/notes" || url.pathname === "/notes/") &&
      request.method === "GET"
    ) {
      return this.handleGetNotes(url);
    }

    if (
      (url.pathname === "/notes" || url.pathname === "/notes/") &&
      request.method === "POST"
    ) {
      return this.handlePostNote(request);
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }

  private async handleGetNotes(url: URL): Promise<Response> {
    const planet = url.searchParams.get("planet") ?? "";
    const limit = Math.min(
      50,
      parseInt(url.searchParams.get("limit") ?? "20", 10) || 20,
    );

    if (!planet) {
      return new Response(
        JSON.stringify({ error: "planet parameter required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        },
      );
    }

    const prefix = `note:${planet}:`;
    const entries = await this.state.storage.list<BoardNote>({
      prefix,
      reverse: true,
      limit,
    });

    const notes: BoardNote[] = [];
    for (const [, value] of entries) {
      notes.push(value);
    }

    return new Response(JSON.stringify(notes), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  private async handlePostNote(request: Request): Promise<Response> {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (this.isRateLimited(ip)) {
      return new Response(JSON.stringify({ error: "Too many notes" }), {
        status: 429,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    try {
      const body = (await request.json()) as {
        nickname?: string;
        text?: string;
        planet?: string;
      };

      const text = (body.text ?? "").trim();
      const planet = (body.planet ?? "").trim();

      if (!text) {
        return new Response(JSON.stringify({ error: "Empty note" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const wordCount = text.split(/\s+/).filter(Boolean).length;
      if (wordCount > MAX_WORD_COUNT) {
        return new Response(
          JSON.stringify({ error: "Note too long" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          },
        );
      }

      if (!planet) {
        return new Response(JSON.stringify({ error: "Planet required" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const note: BoardNote = {
        id: crypto.randomUUID(),
        nickname: (body.nickname ?? "Anonymous").slice(0, MAX_NICKNAME_LENGTH),
        text: text.slice(0, MAX_TEXT_LENGTH),
        planet,
        timestamp: Date.now(),
      };

      // Store with sortable key (timestamp padded for lexicographic order)
      const ts = String(note.timestamp).padStart(15, "0");
      const key = `note:${planet}:${ts}:${note.id}`;
      await this.state.storage.put(key, note);

      // Prune old notes if over limit
      const prefix = `note:${planet}:`;
      const allKeys = await this.state.storage.list({ prefix });
      if (allKeys.size > MAX_NOTES_PER_PLANET) {
        const sortedKeys = [...allKeys.keys()].sort();
        const toDelete = sortedKeys.slice(
          0,
          sortedKeys.length - MAX_NOTES_PER_PLANET,
        );
        for (const k of toDelete) {
          await this.state.storage.delete(k);
        }
      }

      return new Response(JSON.stringify({ ok: true, id: note.id }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }
  }
}
