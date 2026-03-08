/**
 * Admin API client for EV 2090 dashboard.
 */

import type {
  AdminRegionSummary,
  AdminRegionDetail,
  AdminInfraHealth,
  PriceHistoryResponse,
  EnrichedPriceHistoryResponse,
  TradeEventsResponse,
  CommodityDef,
  EconomyDiagnostics,
} from "./types";

const STORAGE_KEY = "ev2090:adminApiKey";

class AdminAPI {
  private baseUrl: string;

  constructor() {
    // In dev, Vite proxy handles /api/admin → ws.ev2090.com
    // In production, admin.ev2090.com talks directly to ws.ev2090.com
    this.baseUrl =
      import.meta.env.DEV
        ? ""
        : "https://ws.ev2090.com";
  }

  getApiKey(): string | null {
    return (
      localStorage.getItem(STORAGE_KEY) ||
      import.meta.env.VITE_FORGE_API_KEY ||
      // In local dev the worker bypasses auth when ADMIN_API_KEY is unset,
      // so any key works. Skip the login screen automatically.
      (import.meta.env.DEV ? "dev" : null)
    );
  }

  setApiKey(key: string): void {
    localStorage.setItem(STORAGE_KEY, key);
  }

  clearApiKey(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error("Not authenticated");

    const res = await fetch(`${this.baseUrl}/api/admin${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...options.headers,
      },
    });

    if (res.status === 401 || res.status === 403) {
      this.clearApiKey();
      throw new Error("Authentication failed");
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  // ── Economy ──

  async getRegions(): Promise<AdminRegionSummary[]> {
    return this.request("/economy/regions");
  }

  async getRegionDetail(regionId: string): Promise<AdminRegionDetail> {
    return this.request(`/economy/region/${regionId}`);
  }

  async getRegionHistory(
    regionId: string,
    planetId: string,
    commodityId: string,
    hours = 24,
  ): Promise<PriceHistoryResponse> {
    return this.request(
      `/economy/region/${regionId}/history?planet=${planetId}&commodity=${commodityId}&hours=${hours}`,
    );
  }

  async getEnrichedHistory(
    regionId: string,
    planetId: string,
    commodityId: string,
    hours = 24,
  ): Promise<EnrichedPriceHistoryResponse> {
    // Try enriched endpoint first; fall back to basic history if worker not yet deployed
    try {
      return await this.request<EnrichedPriceHistoryResponse>(
        `/economy/region/${regionId}/history/enriched?planet=${planetId}&commodity=${commodityId}&hours=${hours}`,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        const basic = await this.request<PriceHistoryResponse>(
          `/economy/region/${regionId}/history?planet=${planetId}&commodity=${commodityId}&hours=${hours}`,
        );
        return {
          points: basic.points.map((p) => ({
            ...p,
            tradeEvents: [],
            activeDisruptions: [],
            production: 0,
            consumption: 0,
          })),
          warmupCompletedAt: basic.warmupCompletedAt,
        };
      }
      throw err;
    }
  }

  async getTradeEvents(
    regionId: string,
    planetId: string,
    commodityId: string,
    hours = 24,
  ): Promise<TradeEventsResponse> {
    return this.request(
      `/economy/region/${regionId}/trade-events?planet=${planetId}&commodity=${commodityId}&hours=${hours}`,
    );
  }

  async triggerDisruption(
    regionId: string,
    disruption: {
      type: string;
      planetId: string;
      commodityId?: string;
      multiplier?: number;
      durationMs?: number;
    },
  ): Promise<{ ok: boolean; disruptionId: string }> {
    return this.request(`/economy/region/${regionId}/disrupt`, {
      method: "POST",
      body: JSON.stringify(disruption),
    });
  }

  async triggerWarmup(
    regionId: string,
  ): Promise<{ ok: boolean; ticksRun: number; durationMs: number }> {
    return this.request(`/economy/region/${regionId}/warmup`, {
      method: "POST",
    });
  }

  // ── Infrastructure ──

  async getInfraHealth(): Promise<AdminInfraHealth> {
    return this.request("/infra/health");
  }

  async getDiagnostics(regionId: string): Promise<EconomyDiagnostics> {
    return this.request(`/economy/region/${regionId}/diagnostics`);
  }

  // ── Commodities ──

  async getCommodities(): Promise<{
    commodities: CommodityDef[];
    categories: string[];
  }> {
    return this.request("/commodities");
  }

  // ── Seed ──

  async seed(): Promise<{ ok: boolean; commoditiesWritten: number }> {
    return this.request("/seed?force=true", { method: "POST" });
  }

  // ── Auth test ──

  async testConnection(): Promise<boolean> {
    try {
      await this.request("/economy/regions");
      return true;
    } catch {
      return false;
    }
  }
}

export const api = new AdminAPI();
