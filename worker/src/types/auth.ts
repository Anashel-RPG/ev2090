/**
 * Auth types — player identity, magic links, and sessions.
 *
 * Key design: emails are NEVER stored. Player identity is derived from
 * HMAC-SHA256(email, PLAYER_HASH_SECRET) → a 64-char hex playerId.
 * This hash is irreversible without the secret.
 */

/** Transient magic link token — stored in PlayerAuth DO for 15 minutes max. */
export interface MagicLinkToken {
  playerId: string;       // HMAC hash of the email (no email stored)
  expiresAt: number;      // unix ms, 15 minutes from creation
  used: boolean;
}

/** Rate limit tracking — per playerId per 15-minute window. */
export interface RateLimit {
  count: number;
  windowStart: number;    // unix ms
}

/** Response from /api/auth/request-link */
export interface RequestLinkResponse {
  ok: boolean;
  error?: string;
}

/** Response from /api/auth/verify */
export interface VerifyResponse {
  ok: boolean;
  error?: string;
  sessionToken?: string;  // HMAC-signed: {playerId}:{expiresAt}:{hmac}
  player?: {
    playerId: string;
    nickname: string;
    isNew: boolean;        // true if this was first-time registration
  };
}

/** Response from /api/auth/me — decoded from HMAC token, no DO call */
export interface MeResponse {
  playerId: string;
  nickname: string;
}

/** Result of HMAC session validation in the Worker router */
export interface AuthResult {
  playerId: string;
}

// ── R2 Player Data Shapes ──

/** players/{hash}/state.json */
export interface PlayerStateData {
  playerId: string;
  nickname: string;
  shipId: string;
  shipColor: string;
  credits: number;
  cargo: PlayerCargoItem[];
  settings: Record<string, unknown>;
  createdAt: number;      // unix ms
  updatedAt: number;      // unix ms
  version: number;
}

export interface PlayerCargoItem {
  commodityId: string;
  quantity: number;
  avgBuyPrice: number;
}

/** players/{hash}/stats.json */
export interface PlayerStatsData {
  totalTrades: number;
  totalTradeVolume: number;
  totalBuyVolume: number;
  totalSellVolume: number;
  distanceTraveled: number;
  planetsVisited: number;
  shipsOwned: number;
  timePlayedSeconds: number;
  totalDockings: number;
  cargoJettisoned: number;
  bestSingleTrade: number;
  missionsCompleted: number;
  creditsEarnedAllTime: number;
  achievements: PlayerAchievement[];
}

export interface PlayerAchievement {
  id: string;
  unlockedAt: number;     // unix ms
}

/** players/{hash}/quests.json */
export interface PlayerQuestsData {
  [questId: string]: {
    phase: string;
    data: Record<string, unknown>;
    startedAt: number;
    updatedAt: number;
    completedAt?: number;
  };
}

/** players/{hash}/history.json — last 200 trade transactions */
export interface PlayerTradeRecord {
  id: string;
  timestamp: number;
  planetId: string;
  commodityId: string;
  action: "buy" | "sell";
  quantity: number;
  pricePerUnit: number;
  total: number;
  creditsAfter: number;
}

// ── Constants ──

export const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000;   // 15 minutes
export const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;    // 15 minutes
export const RATE_LIMIT_MAX = 3;                         // max magic links per window
export const MAX_TRADE_HISTORY = 200;

// ── Defaults ──

export const DEFAULT_PLAYER_STATE: Omit<PlayerStateData, "playerId" | "createdAt" | "updatedAt"> = {
  nickname: "pilot",
  shipId: "striker",
  shipColor: "Blue",
  credits: 10_000,
  cargo: [],
  settings: {},
  version: 1,
};

export const DEFAULT_PLAYER_STATS: PlayerStatsData = {
  totalTrades: 0,
  totalTradeVolume: 0,
  totalBuyVolume: 0,
  totalSellVolume: 0,
  distanceTraveled: 0,
  planetsVisited: 0,
  shipsOwned: 0,
  timePlayedSeconds: 0,
  totalDockings: 0,
  cargoJettisoned: 0,
  bestSingleTrade: 0,
  missionsCompleted: 0,
  creditsEarnedAllTime: 0,
  achievements: [],
};
