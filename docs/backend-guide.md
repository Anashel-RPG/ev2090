# Backend Guide

## Overview

The entire backend is just two TypeScript files. That is not an exaggeration -- `index.ts` handles HTTP routing and `chat-room.ts` implements a Durable Object that manages chat state and SSE connections. Together they weigh in at roughly 280 lines of code.

The backend runs on Cloudflare Workers and is deployed as a single Worker binding named `ev-2090-ws`.

---

## index.ts -- HTTP routing

This is the Worker entry point. It handles three concerns:

### CORS headers

Every response includes permissive CORS headers. A preflight (`OPTIONS`) handler returns `204` immediately:

```typescript
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
```

### Route matching

The Worker checks if the request path starts with `/api/chat`. If it does, the request is forwarded to the ChatRoom Durable Object. The path is stripped down to just the action part (`/stream`, `/message`, or `/history`) before forwarding.

If the path does not match `/api/chat/*`, the Worker returns a JSON service descriptor with the version, timestamp, and available routes. This is useful for health checks and debugging.

### Durable Object stub forwarding

The Worker obtains a single global ChatRoom instance using `idFromName("global")`. All chat traffic goes through this one Durable Object, which means all users share the same chat room.

```
Request flow:
  Client -> Worker (index.ts) -> ChatRoom DO (chat-room.ts)
```

---

## chat-room.ts -- ChatRoom Durable Object

The `ChatRoom` class implements the `DurableObject` interface. It manages in-memory chat history, persists messages to Durable Object storage, and broadcasts to connected SSE clients.

### Message storage

Messages are stored in an in-memory array (`this.messages`). The array is capped at **7 messages** (`MAX_MESSAGES = 7`). When a new message arrives, it is appended and the array is trimmed from the front. Messages are also persisted to Durable Object storage under the key `"messages"` so they survive eviction.

On construction, stored messages are loaded via `state.blockConcurrencyWhile()` to ensure they are available before any request is handled.

### SSE stream implementation

When a client connects to `/stream`, the Durable Object creates a `TransformStream` and adds the writable side's writer to a `Set<WritableStreamDefaultWriter>`. The readable side is returned as the response body with `Content-Type: text/event-stream`.

After the response is returned, the Durable Object (via `state.waitUntil`) sends:
1. An SSE comment (`: connected\n\n`) to flush headers
2. All current messages as `data:` events (history replay)

This means every new connection immediately receives the full chat history.

### POST message broadcasting

When a client POSTs to `/message`, the Durable Object:
1. Validates the body (`{ nickname, text }`) -- rejects empty text
2. Creates a `ChatMessage` with a `crypto.randomUUID()` id
3. Truncates nickname to 16 characters, text to 200 characters
4. Appends to the in-memory array and trims to 7 messages
5. Persists the updated array to Durable Object storage
6. Broadcasts the message as an SSE `data:` event to all connected writers

### Ping / alarm keep-alive

To prevent SSE connections from timing out, the Durable Object schedules a Cloudflare alarm every **15 seconds** (`PING_INTERVAL_MS = 15_000`). When the alarm fires, it broadcasts an SSE comment (`: ping <timestamp>\n\n`) to all writers. If clients are still connected, it schedules the next alarm. If no writers remain, pinging stops.

### Dead writer cleanup

During every `broadcast()` call, if a `writer.write()` throws (because the client disconnected), the writer is added to a dead list. After the broadcast loop, dead writers are removed from the set and closed. The SSE `/stream` handler also registers cleanup on `request.signal` abort and `writer.closed`.

---

## Message format

The message format used throughout the system:

```typescript
interface ChatMessage {
  id: string;        // crypto.randomUUID()
  nickname: string;  // max 16 characters
  text: string;      // max 200 characters
  timestamp: number; // Date.now() epoch milliseconds
}
```

This interface is defined in both `worker/src/chat-room.ts` and `frontend/src/components/ChatPanel.tsx`. They are not shared via import -- they are kept in sync manually.

---

## Deployment

### Configuration

The Worker is configured in `worker/wrangler.toml`:

```toml
name = "ev-2090-ws"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [
  { name = "CHAT_ROOM", class_name = "ChatRoom" }
]

[[migrations]]
tag = "v1"
new_classes = ["ChatRoom"]
```

### Deploy command

```bash
cd worker
npm run deploy:api
```

### Production URL

The Worker is deployed at `https://ws.ev2090.com`. The three chat endpoints are:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chat/stream` | SSE stream of chat messages |
| POST | `/api/chat/message` | Send a message `{ nickname, text }` |
| GET | `/api/chat/history` | Last 7 messages as JSON array |

The root path (`/`) returns a JSON service descriptor with version and route information.

---

## Local development

During local development, the frontend does **not** run a local Worker. Instead, Vite proxies `/api/chat/*` requests to the production Worker at `https://ws.ev2090.com`. This is configured in `frontend/vite.config.ts`:

```typescript
proxy: {
  "/api/chat": {
    target: "https://ws.ev2090.com",
    changeOrigin: true,
    configure: (proxy) => {
      // Flush SSE chunks immediately through the proxy
      proxy.on("proxyRes", (proxyRes, _req, res) => {
        if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
          proxyRes.on("data", (chunk) => res.write(chunk));
          proxyRes.on("end", () => res.end());
        }
      });
    },
  },
},
```

The special `configure` block ensures SSE chunks are flushed immediately rather than buffered, which is required for real-time message delivery through the proxy.

To point at a different backend (e.g., a local Wrangler dev server), set the environment variable:

```bash
VITE_CHAT_API_URL=http://localhost:8787/api/chat npm run dev
```

---

## How to modify

### Constants you can change

| Constant | File | Default | Purpose |
|----------|------|---------|---------|
| `MAX_MESSAGES` | `chat-room.ts` | `7` | Number of messages kept in memory and storage |
| `PING_INTERVAL_MS` | `chat-room.ts` | `15000` | Milliseconds between SSE keepalive pings |
| Nickname max length | `chat-room.ts` | `16` | Truncation limit in `handleMessage` |
| Text max length | `chat-room.ts` | `200` | Truncation limit in `handleMessage` |

### Adding new endpoints

To add a new route:

1. In `chat-room.ts`, add a new `if (url.pathname === "/yourpath")` block in the `fetch()` method.
2. The Worker (`index.ts`) already forwards all `/api/chat/*` paths to the Durable Object, so no changes needed there.
3. On the frontend, call the new endpoint at `/api/chat/yourpath` (the Vite proxy will forward it automatically in dev, and the production URL will work directly).

If your new endpoint does not need shared state or SSE, you could instead handle it directly in `index.ts` before the Durable Object forwarding -- just add a new `if` block before the `/api/chat` check.
