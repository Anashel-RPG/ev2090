/**
 * Frontend auth types — player identity and session state.
 *
 * The session token is an HMAC-signed string: {playerId}:{expiresAt}:{hmac}
 * The playerId is itself an HMAC hash of the email — doubly opaque.
 * No email is ever stored on the client or server.
 */

/** Auth state exposed by the useAuth hook */
export interface AuthState {
  /** True when a valid session token exists */
  isAuthenticated: boolean;
  /** True when no session token exists (playing as guest) */
  isGuest: boolean;
  /** True during initial session validation on mount */
  loading: boolean;
  /** Player identity (null if guest) */
  player: PlayerIdentity | null;
}

/** Minimal player identity decoded from the session token */
export interface PlayerIdentity {
  playerId: string;       // HMAC hash — not the email
  nickname: string;
}

/** Actions exposed by the useAuth hook */
export interface AuthActions {
  /** Send a magic link to the given email */
  requestMagicLink: (email: string) => Promise<{ ok: boolean; error?: string }>;
  /** Verify a magic link token (from URL param) and establish session */
  verifyToken: (token: string) => Promise<{ ok: boolean; error?: string }>;
  /** Clear session token and return to guest mode */
  logout: () => void;
  /** Get the raw session token for API calls (null if guest) */
  getSessionToken: () => string | null;
}

/** Features that require an authenticated account */
export type GatedFeature =
  | "trading"          // Server-authoritative market buy/sell
  | "hangar"           // Ship hangar access
  | "forge"            // Ship Forge commission tab
  | "stats"            // Lifetime stats & achievements
  | "leaderboards";    // Future leaderboard access

/** Map of features to their gated status */
export const GATED_FEATURES: Record<GatedFeature, { label: string; description: string }> = {
  trading:      { label: "Market",       description: "Create an account to trade on the galactic market" },
  hangar:       { label: "Hangar",       description: "Create an account to manage your fleet" },
  forge:        { label: "Commission",   description: "Create an account to commission custom ships" },
  stats:        { label: "Pilot Stats",  description: "Create an account to track your career" },
  leaderboards: { label: "Leaderboards", description: "Create an account to compete on the boards" },
};

// ── localStorage keys ──

export const SESSION_STORAGE_KEY = "ev-session";
export const MIGRATED_STORAGE_KEY = "ev-migrated";
