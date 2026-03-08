/**
 * useMarketPrices — fetches market prices from the live economy snapshot.
 *
 * Production: reads from the CDN-cached R2 snapshot (60s write / 15s cache).
 * Local dev:  reads directly from the EconomyRegion DO via /api/market/snapshot
 *             (Vite proxy → local Wrangler worker), so no CDN is required.
 *
 * Re-fetches every 20s while docked.
 */

import { useState, useEffect, useCallback } from "react";
import { CDN_BASE } from "@/config/urls";
import type { MarketSnapshot } from "@/types/economy";

const REFETCH_INTERVAL_MS = 20_000; // 20s (CDN cache is 15s)

// In dev: Vite proxy routes /api/market/* → local Wrangler worker → EconomyRegion DO.
// In prod: read the R2 file served by the CDN (no DO load per player).
const SNAPSHOT_URL = import.meta.env.DEV
  ? "/api/market/snapshot"
  : `${CDN_BASE}/market/regions/core-worlds.json`;

export function useMarketPrices(
  _marketApiUrl: string,  // kept for API compat, no longer used
  docked: boolean,
): { snapshot: MarketSnapshot | null; loading: boolean; error: string | null } {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(SNAPSHOT_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MarketSnapshot;
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on dock, re-fetch on interval while docked
  useEffect(() => {
    if (!docked) return;

    fetchPrices();
    const interval = setInterval(fetchPrices, REFETCH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [docked, fetchPrices]);

  return { snapshot, loading, error };
}
