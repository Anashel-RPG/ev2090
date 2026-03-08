/**
 * EV 2090 MCP Server — Main Entry Point
 *
 * Cloudflare Worker that provides MCP (Model Context Protocol) access
 * to the EV 2090 game universe for Claude.ai as a dungeon master co-pilot.
 *
 * Routes:
 *   /.well-known/oauth-authorization-server  → OAuth metadata (RFC 8414)
 *   /.well-known/oauth-protected-resource    → Protected resource metadata (RFC 9728)
 *   /authorize                                → OAuth authorize endpoint
 *   /oauth/token                              → OAuth token endpoint
 *   /health                                   → Public health check
 *   /mcp/*                                    → MCP session (WebSocket/SSE/HTTP)
 */

export { MCPSession } from "./mcp-session";

import type { Env } from "./types";
import { Logger } from "./logger";
import {
  validateRequest,
  generateAuthCode,
  verifyAuthCode,
  verifyPkce,
  extractApiKey,
  resolveScopeFromApiKey,
} from "./auth";
import {
  initAllowedOrigins,
  secureResponse,
  getCorsHeaders,
  getSecurityHeaders,
  validateBodySize,
  auditLog,
  isAllowedOrigin,
} from "./security";

const SERVER_NAME = "ev2090-mcp";

function jsonResponse(
  data: unknown,
  status = 200,
  origin?: string | null
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getCorsHeaders(origin),
    ...getSecurityHeaders(),
  };
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(
  message: string,
  status: number,
  origin?: string | null
): Response {
  return jsonResponse({ error: message }, status, origin);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    initAllowedOrigins(env.ALLOWED_ORIGINS);

    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const logger = new Logger(env.LOG_LEVEL || "info");

    // ── CORS preflight ──
    if (request.method === "OPTIONS") {
      return secureResponse(new Response(null, { status: 204 }), origin);
    }

    // ── Public endpoints (no auth required) ──

    // SSE on root path (some MCP clients use server URL directly)
    if (
      url.pathname === "/" &&
      request.method === "GET" &&
      (request.headers.get("Accept") || "").includes("text/event-stream")
    ) {
      // Auth required for SSE — route through MCP session handler
      const authResult = validateRequest(request, env);
      if (!authResult.authorized) {
        return errorResponse(authResult.error || "Unauthorized", 401, origin);
      }
      return handleMCPSession(request, env, url, logger, authResult.scope, origin);
    }

    // Health check (GET/HEAD only — POST / is MCP transport)
    if ((url.pathname === "/health" || url.pathname === "/") && (request.method === "GET" || request.method === "HEAD")) {
      return jsonResponse(
        {
          status: "ok",
          service: SERVER_NAME,
          version: env.WORKER_VERSION,
          hardened: true,
          timestamp: new Date().toISOString(),
        },
        200,
        origin
      );
    }

    // OAuth Authorization Server Metadata (RFC 8414)
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      const baseUrl = `${url.protocol}//${url.host}`;
      return jsonResponse(
        {
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/oauth/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        },
        200,
        origin
      );
    }

    // Protected Resource Metadata (RFC 9728)
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      const baseUrl = `${url.protocol}//${url.host}`;
      return jsonResponse(
        {
          resource: baseUrl,
          authorization_servers: [baseUrl],
          bearer_methods_supported: ["header"],
        },
        200,
        origin
      );
    }

    // ── OAuth endpoints ──

    // Authorize: generates a stateless auth code
    if (url.pathname === "/authorize" && request.method === "GET") {
      const codeChallenge = url.searchParams.get("code_challenge");
      const codeChallengeMethod = url.searchParams.get(
        "code_challenge_method"
      );
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      const clientId = url.searchParams.get("client_id") || "claude";

      if (!codeChallenge || codeChallengeMethod !== "S256" || !redirectUri) {
        return errorResponse(
          "Missing or invalid PKCE parameters",
          400,
          origin
        );
      }

      // Validate redirect URI against allowlist
      const allowedCallbacks = [
        "https://claude.ai/api/mcp/auth_callback",
        "https://www.claude.ai/api/mcp/auth_callback",
        "https://claude.com/api/mcp/auth_callback",
        "http://localhost",
      ];
      const redirectAllowed = allowedCallbacks.some(
        (cb) => redirectUri === cb || redirectUri.startsWith(cb)
      );
      if (!redirectAllowed) {
        auditLog("oauth_redirect_blocked", { redirectUri: redirectUri.slice(0, 80) });
        return errorResponse(
          "Invalid redirect_uri: not in allowlist",
          400,
          origin
        );
      }

      const secret = env.OAUTH_HMAC_SECRET || env.MCP_API_KEY || "";
      if (!secret) {
        return errorResponse("OAuth not configured", 500, origin);
      }

      const code = await generateAuthCode(
        codeChallenge,
        redirectUri,
        clientId,
        secret
      );

      // Redirect back with the code
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      if (state) redirect.searchParams.set("state", state);

      auditLog("oauth_authorize", { clientId, redirectUri: redirectUri.slice(0, 60) });

      return Response.redirect(redirect.toString(), 302);
    }

    // Token exchange: verify PKCE + client_secret (= API key)
    if (url.pathname === "/oauth/token" && request.method === "POST") {
      try {
        // Support HTTP Basic auth (client_secret_basic): Authorization: Basic base64(client_id:client_secret)
        let basicClientId: string | null = null;
        let basicClientSecret: string | null = null;
        const authHeader = request.headers.get("Authorization") || "";
        if (authHeader.toLowerCase().startsWith("basic ")) {
          try {
            const decoded = atob(authHeader.slice(6).trim());
            const sep = decoded.indexOf(":");
            if (sep !== -1) {
              basicClientId = decoded.slice(0, sep);
              basicClientSecret = decoded.slice(sep + 1);
            }
          } catch {
            // Ignore malformed Basic auth; fall back to body params
          }
        }

        let body: Record<string, string>;
        const contentType = request.headers.get("Content-Type") || "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const text = await request.text();
          body = Object.fromEntries(new URLSearchParams(text));
        } else {
          body = (await request.json()) as Record<string, string>;
        }

        const grant_type = body.grant_type;
        const code = body.code;
        const code_verifier = body.code_verifier;
        const redirect_uri = body.redirect_uri;
        // Body params override Basic auth (same as 11labs)
        const client_secret = body.client_secret || basicClientSecret;
        const client_id = body.client_id || basicClientId;

        // Support client_credentials grant (simple API key exchange)
        if (grant_type === "client_credentials") {
          if (!client_secret) {
            return jsonResponse({ error: "invalid_client", error_description: "client_secret is required" }, 401, origin);
          }
          const scope = resolveScopeFromApiKey(client_secret, env);
          if (scope === "none") {
            auditLog("oauth_token_failed", { reason: "invalid_client_credentials" });
            return jsonResponse({ error: "invalid_client", error_description: "Invalid credentials" }, 401, origin);
          }
          auditLog("oauth_token_issued", { scope, clientId: client_id || "unknown", grant: "client_credentials" });
          return jsonResponse({ access_token: client_secret, token_type: "Bearer", scope }, 200, origin);
        }

        if (grant_type !== "authorization_code") {
          return jsonResponse({ error: "unsupported_grant_type" }, 400, origin);
        }

        if (!code || !client_secret) {
          auditLog("oauth_token_failed", { reason: "missing_params", hasCode: !!code, hasSecret: !!client_secret });
          return jsonResponse({ error: "invalid_request", error_description: "code and client_secret are required" }, 400, origin);
        }

        // Verify the auth code
        const secret = env.OAUTH_HMAC_SECRET || env.MCP_API_KEY || "";
        const decoded = await verifyAuthCode(code, secret);
        if (!decoded) {
          auditLog("oauth_token_failed", { reason: "invalid_code" });
          return jsonResponse({ error: "invalid_grant", error_description: "Invalid or expired authorization code" }, 401, origin);
        }

        // Verify PKCE — required; /authorize always binds a code_challenge
        if (!code_verifier) {
          auditLog("oauth_token_failed", { reason: "missing_code_verifier" });
          return jsonResponse({ error: "invalid_request", error_description: "code_verifier is required" }, 400, origin);
        }
        const pkceValid = await verifyPkce(code_verifier, decoded.codeChallenge);
        if (!pkceValid) {
          auditLog("oauth_token_failed", { reason: "pkce_mismatch" });
          return jsonResponse({ error: "invalid_grant", error_description: "PKCE verification failed" }, 401, origin);
        }

        // Verify redirect URI matches
        if (redirect_uri && redirect_uri !== decoded.redirectUri) {
          auditLog("oauth_token_failed", { reason: "redirect_mismatch" });
          return jsonResponse({ error: "invalid_grant", error_description: "Redirect URI mismatch" }, 401, origin);
        }

        // Verify client_secret IS a valid API key
        const scope = resolveScopeFromApiKey(client_secret, env);
        if (scope === "none") {
          auditLog("oauth_token_failed", { reason: "invalid_client_secret" });
          return jsonResponse({ error: "invalid_client", error_description: "Invalid credentials" }, 401, origin);
        }

        // The access_token IS the API key (same pattern as mcp-11labs)
        auditLog("oauth_token_issued", { scope, clientId: decoded.clientId, grant: "authorization_code" });

        return jsonResponse(
          { access_token: client_secret, token_type: "Bearer", scope },
          200,
          origin
        );
      } catch {
        return jsonResponse({ error: "invalid_request" }, 400, origin);
      }
    }

    // ── ZERO TRUST: All remaining endpoints require auth ──

    const authResult = validateRequest(request, env);
    if (!authResult.authorized) {
      const ip =
        request.headers.get("CF-Connecting-IP") || "unknown";
      auditLog("auth_denied", {
        ip,
        path: url.pathname,
        error: authResult.error,
      });
      return errorResponse(
        authResult.error || "Unauthorized",
        401,
        origin
      );
    }

    // Validate body size for POST requests
    if (request.method === "POST") {
      const { valid, size } = validateBodySize(request);
      if (!valid) {
        return errorResponse(
          `Request body too large (${size} bytes, max 64KB)`,
          413,
          origin
        );
      }
    }

    // ── MCP session routing ──

    // /mcp* or /session* prefix routes
    if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/session")) {
      return handleMCPSession(request, env, url, logger, authResult.scope, origin);
    }

    // SSE endpoint
    if (url.pathname === "/sse") {
      return handleMCPSession(request, env, url, logger, authResult.scope, origin);
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return handleMCPSession(request, env, url, logger, authResult.scope, origin);
    }

    // Streamable HTTP: POST / or /rpc (Claude.ai uses this after OAuth)
    if ((url.pathname === "/" || url.pathname === "/rpc") && request.method === "POST") {
      return handleMCPSession(request, env, url, logger, authResult.scope, origin);
    }

    return errorResponse("Not found", 404, origin);
  },
};

// ── Session routing ──

async function handleMCPSession(
  request: Request,
  env: Env,
  url: URL,
  logger: Logger,
  scope: string,
  origin: string | null
): Promise<Response> {
  try {
    // Get or create session ID
    let sessionId =
      url.searchParams.get("session") ||
      request.headers.get("X-Session-ID");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
    }

    logger.info("MCP session request", {
      sessionId: sessionId.slice(0, 8),
      method: request.method,
      path: url.pathname,
      upgrade: request.headers.get("Upgrade"),
      scope,
    });

    const id = env.MCP_SESSION.idFromName(sessionId);
    const stub = env.MCP_SESSION.get(id);

    // Forward request to DO (pass URL through, add session param — same as 11labs)
    const doUrl = new URL(request.url);
    doUrl.searchParams.set("session", sessionId);

    const response = await stub.fetch(
      new Request(doUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      })
    );

    // Build headers (CORS + security) for ALL responses including WebSocket
    const headers = new Headers(response.headers);
    headers.set("X-Session-ID", sessionId);
    for (const [k, v] of Object.entries(getCorsHeaders(origin))) {
      headers.set(k, v);
    }
    for (const [k, v] of Object.entries(getSecurityHeaders())) {
      headers.set(k, v);
    }

    // Return response (with webSocket passthrough when present)
    return new Response(response.webSocket ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
      webSocket: response.webSocket,
    });
  } catch (error) {
    logger.error("Failed to handle MCP session", error);
    return errorResponse("Internal server error", 500, origin);
  }
}
