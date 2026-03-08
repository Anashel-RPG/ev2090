/**
 * useAuth — manages player authentication state.
 *
 * On mount: checks localStorage for an existing session token,
 * decodes the HMAC token for playerId (no server call needed for identity).
 *
 * Exposes login/logout actions and an isAuthenticated flag that
 * downstream components use for feature gating.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { API_BASE } from "@/config/urls";
import type { AuthState, AuthActions, PlayerIdentity } from "@/types/auth";
import { SESSION_STORAGE_KEY } from "@/types/auth";

const AUTH_API = `${API_BASE}/api/auth`;

// ── Token helpers ──

/** Decode playerId from an HMAC session token without server validation */
function decodeToken(token: string): { playerId: string; expiresAt: number } | null {
  const parts = token.split(":");
  if (parts.length !== 3) return null;
  const [playerId, expiresAtStr] = parts;
  const expiresAt = Number(expiresAtStr);
  if (!playerId || isNaN(expiresAt)) return null;
  if (Date.now() > expiresAt) return null; // expired
  return { playerId: playerId!, expiresAt };
}

function loadStoredToken(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // localStorage unavailable — session won't persist across refresh
  }
}

function clearToken(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ── Hook ──

export function useAuth(): AuthState & AuthActions {
  const [state, setState] = useState<AuthState>(() => {
    const token = loadStoredToken();
    if (!token) return { isAuthenticated: false, isGuest: true, loading: false, player: null };

    const decoded = decodeToken(token);
    if (!decoded) {
      clearToken();
      return { isAuthenticated: false, isGuest: true, loading: false, player: null };
    }

    // Optimistic — token looks valid locally, will validate with server
    return {
      isAuthenticated: true,
      isGuest: false,
      loading: true,
      player: { playerId: decoded.playerId, nickname: "" },
    };
  });

  const tokenRef = useRef(loadStoredToken());

  // Validate session with server on mount (if we have a token)
  useEffect(() => {
    if (!state.loading) return;
    const token = tokenRef.current;
    if (!token) {
      setState({ isAuthenticated: false, isGuest: true, loading: false, player: null });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${AUTH_API}/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;

        if (!res.ok) {
          clearToken();
          tokenRef.current = null;
          setState({ isAuthenticated: false, isGuest: true, loading: false, player: null });
          return;
        }

        const data = (await res.json()) as { playerId: string; nickname: string };
        setState({
          isAuthenticated: true,
          isGuest: false,
          loading: false,
          player: { playerId: data.playerId, nickname: data.nickname },
        });
      } catch {
        if (cancelled) return;
        // Network error — treat as unauthenticated; server validation is required.
        // Do NOT trust the unverified local token as proof of identity.
        setState({ isAuthenticated: false, isGuest: true, loading: false, player: null });
      }
    })();

    return () => { cancelled = true; };
  }, [state.loading]);

  // ── Actions ──

  const requestMagicLink = useCallback(async (email: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`${AUTH_API}/request-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      return data;
    } catch {
      return { ok: false, error: "Network error — please try again" };
    }
  }, []);

  const verifyToken = useCallback(async (token: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`${AUTH_API}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        sessionToken?: string;
        player?: PlayerIdentity;
      };

      if (data.ok && data.sessionToken && data.player) {
        storeToken(data.sessionToken);
        tokenRef.current = data.sessionToken;
        setState({
          isAuthenticated: true,
          isGuest: false,
          loading: false,
          player: data.player,
        });
      }

      return { ok: data.ok, error: data.error };
    } catch {
      return { ok: false, error: "Network error — please try again" };
    }
  }, []);

  const logout = useCallback(() => {
    const token = tokenRef.current;
    clearToken();
    tokenRef.current = null;
    setState({ isAuthenticated: false, isGuest: true, loading: false, player: null });

    // Fire-and-forget server logout (add to revocation list)
    if (token) {
      fetch(`${AUTH_API}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }, []);

  const getSessionToken = useCallback(() => tokenRef.current, []);

  return {
    ...state,
    requestMagicLink,
    verifyToken,
    logout,
    getSessionToken,
  };
}
