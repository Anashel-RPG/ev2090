/**
 * EV 2090 MCP Server — Authentication
 *
 * 3-tier API key system (full/rw/ro) + OAuth 2.0 + PKCE for Claude.ai.
 */

import type { Env, MCPScope, AuthResult } from "./types";
import { constantTimeCompare } from "./security";

// ── API Key extraction ──

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function extractApiKey(headers: Headers): string | null {
  const fromHeader =
    headers.get("X-MCP-API-Key") ||
    headers.get("X-API-Key") ||
    headers.get("Authorization")?.replace(/^Bearer\s+/i, "");

  if (!isNonEmptyString(fromHeader)) return null;
  return fromHeader.trim();
}

// ── Scope resolution (timing-safe) ──

export function isMcpAuthConfigured(env: Env): boolean {
  return (
    isNonEmptyString(env.MCP_API_KEY) ||
    isNonEmptyString(env.MCP_API_KEY_RW) ||
    isNonEmptyString(env.MCP_API_KEY_RO)
  );
}

export function resolveScopeFromApiKey(
  apiKey: string | null,
  env: Env
): MCPScope {
  if (!apiKey) return "none";

  // Check ALL keys even if one matches (constant-time behavior)
  const isFullKey =
    isNonEmptyString(env.MCP_API_KEY) &&
    constantTimeCompare(apiKey, env.MCP_API_KEY);
  const isRwKey =
    isNonEmptyString(env.MCP_API_KEY_RW) &&
    constantTimeCompare(apiKey, env.MCP_API_KEY_RW);
  const isRoKey =
    isNonEmptyString(env.MCP_API_KEY_RO) &&
    constantTimeCompare(apiKey, env.MCP_API_KEY_RO);

  if (isFullKey) return "full";
  if (isRwKey) return "rw";
  if (isRoKey) return "ro";
  return "none";
}

export function getScopeFromRequest(request: Request, env: Env): MCPScope {
  const apiKey = extractApiKey(request.headers);
  return resolveScopeFromApiKey(apiKey, env);
}

// ── Request validation ──

export function validateRequest(request: Request, env: Env): AuthResult {
  if (!isMcpAuthConfigured(env)) {
    return {
      authorized: false,
      scope: "none",
      error: "Server misconfigured: MCP API keys not set",
    };
  }

  const scope = getScopeFromRequest(request, env);

  if (scope === "none") {
    return {
      authorized: false,
      scope: "none",
      error: "Unauthorized: Invalid or missing API key",
    };
  }

  return { authorized: true, scope };
}

// ── OAuth 2.0 + PKCE (stateless auth codes with HMAC) ──

async function hmacSign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmacVerify(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expected = await hmacSign(data, secret);
  return constantTimeCompare(expected, signature);
}

/**
 * Generate a stateless OAuth authorization code.
 * Payload: code_challenge + redirect_uri + client_id + timestamp
 * Format: base64(payload).hmac_signature
 */
export async function generateAuthCode(
  codeChallenge: string,
  redirectUri: string,
  clientId: string,
  secret: string
): Promise<string> {
  const payload = JSON.stringify({
    cc: codeChallenge,
    ru: redirectUri,
    ci: clientId,
    ts: Date.now(),
  });
  const encoded = btoa(payload)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const signature = await hmacSign(encoded, secret);
  return `${encoded}.${signature}`;
}

/**
 * Verify and decode a stateless auth code.
 * Returns null if invalid or expired (5 min TTL).
 */
export async function verifyAuthCode(
  code: string,
  secret: string
): Promise<{
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
} | null> {
  const parts = code.split(".");
  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;
  const valid = await hmacVerify(encoded, signature, secret);
  if (!valid) return null;

  try {
    // Reverse URL-safe base64 before decoding
    const standardB64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(standardB64));
    // 5-minute TTL
    if (Date.now() - payload.ts > 5 * 60 * 1000) return null;
    return {
      codeChallenge: payload.cc,
      redirectUri: payload.ru,
      clientId: payload.ci,
    };
  } catch {
    return null;
  }
}

/**
 * Verify PKCE: SHA-256(code_verifier) must match code_challenge.
 */
export async function verifyPkce(
  codeVerifier: string,
  codeChallenge: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(codeVerifier)
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return hash === codeChallenge;
}
