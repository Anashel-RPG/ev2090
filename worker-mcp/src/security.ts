/**
 * EV 2090 MCP Server — Security Utilities
 *
 * Timing-safe comparison, CORS, security headers, body validation.
 */

let _allowedOrigins: string[] = [];

export function initAllowedOrigins(envOrigins?: string): void {
  if (envOrigins) {
    _allowedOrigins = envOrigins
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  // Always allow Claude.ai origins
  const claudeOrigins = [
    "https://claude.ai",
    "https://www.claude.ai",
    "https://api.claude.ai",
  ];
  for (const o of claudeOrigins) {
    if (!_allowedOrigins.includes(o)) _allowedOrigins.push(o);
  }
}

// ── Timing-safe string comparison ──

export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do work to prevent length-based timing leaks
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i % b.length);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ── Origin validation ──

function isLocalDevOrigin(origin: string): boolean {
  return (
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("https://localhost:") ||
    origin.startsWith("https://127.0.0.1:")
  );
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (isLocalDevOrigin(origin)) return true;
  return _allowedOrigins.includes(origin);
}

// ── CORS headers ──

export function getCorsHeaders(
  origin?: string | null
): Record<string, string> {
  const allowedOrigin =
    origin && isAllowedOrigin(origin)
      ? origin
      : _allowedOrigins[0] || "https://claude.ai";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-API-Key, X-MCP-API-Key, X-Session-ID",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// ── Security headers ──

export function getSecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };
}

/**
 * Wrap a response with CORS + security headers.
 */
export function secureResponse(
  response: Response,
  origin: string | null
): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(getCorsHeaders(origin))) {
    headers.set(k, v);
  }
  for (const [k, v] of Object.entries(getSecurityHeaders())) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ── Body size validation ──

export const MAX_BODY_SIZE = 64 * 1024; // 64 KB

export function validateBodySize(request: Request): {
  valid: boolean;
  size: number;
} {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size)) {
      return { valid: size <= MAX_BODY_SIZE, size };
    }
  }
  return { valid: true, size: 0 };
}

// ── Audit logging ──

export function auditLog(
  action: string,
  details: Record<string, unknown>
): void {
  console.log(
    "[audit]",
    JSON.stringify({
      timestamp: new Date().toISOString(),
      action,
      ...details,
    })
  );
}
