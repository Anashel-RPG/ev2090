[← Back to index](/README.md)

# Security Disclosure

> **Last updated:** 2026-03-08

This document is intended for anyone self-hosting EV 2090 or contributing to the project. It summarises the **known risks**, the **mitigations currently in place**, and **what is being worked on**. It is not a security guarantee and not a complete threat model.

---

## Attack Surface

Three public-facing surfaces exist:

| Surface | URL | Notes |
|---------|-----|-------|
| Frontend SPA | `ev2090.com` | Static, served by Cloudflare Pages |
| Game API / Chat | `ws.ev2090.com/api/*` | Cloudflare Workers + Durable Objects |
| MCP Server | `mcp.ev2090.com` | AI tool access, key-gated |

The admin dashboard (`admin/`) **must never be deployed to a public host**. It has not been hardened — there is no IP restriction, no rate limiting, no session management, and the API key is stored in `localStorage`. It is a local development tool only.

---

## Current Risks

These are known gaps. If you are self-hosting, assume these apply to your deployment too.

### High

| Risk | Where |
|------|-------|
| No CSP header anywhere — missing across the frontend (Cloudflare Pages) and game worker responses | Frontend, `worker/src/` |
| No content moderation on user-generated text (chat, board) — abuse and spam are not filtered beyond character and word limits | `chat-room.ts`, `board-room.ts` |
| The `mutate_db` MCP tool accepts arbitrary `DELETE` and `UPDATE` SQL, not just safe reads | `economy-region.ts` (MCP full-scope only) |
| No audit log for game worker admin operations — MCP has logging but `admin.ts` / `ship-forge.ts` do not | `admin.ts`, `ship-forge.ts` |
| Bearer token comparison in the game worker is not timing-safe (uses `===` / `!==`) | `admin.ts` line 35, `ship-forge.ts` `isAdmin()` |

### Medium

| Risk | Where |
|------|-------|
| Ship Forge rate-limit has a race condition: the daily counter is read, then the full Gemini pipeline runs, then the counter is incremented — two concurrent requests can both pass the check | `ship-forge.ts` `handleGenerateConcept()` |
| Forge pipeline stages after the initial concept (`/generate-render`, `/generate-3d`) are not independently rate-limited — cost amplification on external APIs is possible | `ship-forge.ts` |
| Nicknames have no reserved-name blocking — players can register "ADMIN" or "SYSTEM" | `chat-room.ts`, `board-room.ts` |
| The CORS allowlist includes `admin.ev2090.com` but the admin dashboard is local-only — if this domain is not controlled, a third party could use it to make cross-origin requests to the game API | `cors.ts` line 15 |

### Low

| Risk | Where |
|------|-------|
| Google Fonts are loaded from CDN without Subresource Integrity (SRI) hashes | `index.html` |
| A single shared admin bearer token is used — no per-user identity or action traceability | `admin.ts` |
| If `OAUTH_HMAC_SECRET` is not set as a Cloudflare secret, the MCP worker falls back to `MCP_API_KEY` for signing OAuth tokens — a leaked API key could then forge auth codes | `worker-mcp/src/index.ts` lines 180, 263 |
| The Bridge Editor (dev-only tool) uses `innerHTML` with template literals — safe today but fragile | `BridgeEditor.ts` (dev tool only) |
| PKCE hash comparison in `verifyPkce()` uses `===` instead of `constantTimeCompare()` — low risk (SHA-256 digest, not a secret) but inconsistent with the rest of the auth module | `worker-mcp/src/auth.ts` line 191 |
| The `json()` helper in `admin.ts` hardcodes `Access-Control-Allow-Origin: *` — overridden by `applyCors()` at the router level today, but fragile if responses ever bypass the router | `admin.ts` line 20 |

---

## Mitigations in Place

These controls reduce risk but do not eliminate the gaps above.

**Access control**
- The admin dashboard is local-only and never deployed to a public host.
- Economy write endpoints (`set-stock`, `set-rates`, `set-capacity`, `create-route`, `raw-query`, `raw-mutate`, `schema`, `disrupt`, `warmup`, route/disruption mutations) require `ADMIN_API_KEY` auth at the router level. Public read endpoints (snapshot, history, prices, routes, disruptions) remain open.
- MCP tools use three separate API key scopes (read-only, read-write, full-access). Destructive tools require the full-access key.
- MCP bearer token comparison uses `constantTimeCompare()` (timing-safe).
- MCP supports OAuth 2.0 + PKCE for Claude.ai integration.
- Forge admin operations require a separate `FORGE_API_KEY` bearer token.

**CORS**
- All workers enforce an explicit origin allowlist. Wildcard (`*`) is never used.
- `Vary: Origin` is set to prevent cache poisoning.
- `localhost:*` is allowed only in development. Preview deployments are allowed via a `*.ev2090.pages.dev` pattern.

**Input handling**
- Chat messages are truncated at 200 characters; nicknames at 16 characters. Chat is rate-limited to 5 messages per 10-second window per IP.
- Community board posts are truncated at 280 characters and 10 words. The board is rate-limited to 3 notes per 30-second window per IP.
- All SQL queries in the economy engine use parameterized statements (`?` placeholders) — no string concatenation.
- Planet and commodity IDs in URL paths are validated against `\w+` regex.
- The `mutate_db` tool blocks `DROP` and `ALTER` statements.
- The price-history endpoint caps the `?hours=` parameter to a maximum of 24 hours.

**Ship Forge**
- Generation is rate-limited to 100 concepts per day per IP fingerprint (SHA-256 hashed with `FORGE_API_KEY` as the salt — the salt is a Cloudflare secret, not hardcoded).
- In production builds, `VITE_FORGE_API_KEY` resolves to an empty string — the key is never baked into the JS bundle.

**MCP server**
- All MCP responses include `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, and `Referrer-Policy` security headers.
- Request bodies are validated against a 64 KB maximum size limit before processing.
- All MCP write operations are recorded via `auditLog()` to Cloudflare Worker logs (Worker Logs / Logpush).

**Secrets**
- All production API keys are stored as Cloudflare Worker secrets (`wrangler secret put`) and are never committed to source.
- `.env`, `.env.*`, and `.dev.vars` files are gitignored.
- No credentials, API keys, or secrets are hardcoded anywhere in source — all are loaded from environment variables or Cloudflare Worker secrets.

**Frontend**
- All user-generated content in player-facing components (chat, board, nickname) is rendered as React text nodes — no `innerHTML` or `dangerouslySetInnerHTML` is used in player-facing code.
- No `eval()` or `Function()` anywhere in the codebase.

---

## Planned Fixes

The following are actively being worked on, roughly in priority order:

1. **CSP header** — Add a Content-Security-Policy via `_headers` (Cloudflare Pages) and game worker responses. The MCP server already sends most other security headers.
2. **Timing-safe auth in the game worker** — Replace `===` / `!==` comparisons with `constantTimeCompare()` in `admin.ts` and `ship-forge.ts`. The MCP server already does this correctly.
3. **Fix Forge race condition** — Use a transactional check-and-increment before the pipeline starts, not after.
4. **Rate limit Forge pipeline stages** — Independent limits on `/generate-render` and `/generate-3d` to prevent cost amplification.
5. **Restrict `mutate_db`** — Move toward an allowlist of safe operation types or remove the tool in favour of targeted MCP tools.
6. **Audit logging for game worker admin** — Extend the MCP audit logging pattern to `admin.ts` and `ship-forge.ts`.
7. **Reserve system nicknames** — Block "ADMIN", "SYSTEM", and similar names at registration in `chat-room.ts` and `board-room.ts`.
8. **SRI for Google Fonts** — Add `integrity` and `crossorigin` attributes to CDN font links.
9. **Remove `admin.ev2090.com` from CORS allowlist** — Either deploy the admin dashboard behind auth at that domain, or remove the origin from the allowlist in `cors.ts`.
10. **Use `constantTimeCompare()` in `verifyPkce()`** — Replace `===` with the timing-safe comparison already available in the auth module.
11. **Remove hardcoded wildcard CORS from `admin.ts` `json()` helper** — The `applyCors()` router override makes it safe today, but the wildcard should not exist in the first place.

---

## For Self-Hosters

If you are deploying your own instance:

- **Always set `OAUTH_HMAC_SECRET`** as a separate Cloudflare secret. Do not rely on the fallback.
- **Never set `VITE_FORGE_API_KEY`** as a `VITE_*` environment variable during production builds — Vite bakes it into the bundle.
- **Rotate all API keys** if your private fork is shared with anyone you do not fully trust.
- **Never deploy the admin dashboard to a public host** — it has not been hardened for production use. There is no IP restriction, no rate limiting, no session expiry, and the API key is stored in plain text in `localStorage`. Use the MCP server for remote admin access instead.
- **Review `.gitignore`** before adding new sensitive files — ensure any local credential notes or config files are excluded from version control.

---

## Related Docs

- [backend-guide.md](./backend-guide.md) — CORS, admin auth implementation
- [mcp-guide.md](./mcp-guide.md) — API key tiers, OAuth flow
- [forge-guide.md](./forge-guide.md) — Rate limiting, Forge pipeline
- [cloudflare-setup.md](./cloudflare-setup.md) — Secret configuration
