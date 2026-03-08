import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Zap } from "lucide-react";
import { api } from "../api";
import type {
  AdminRegionSummary,
  AdminRegionDetail,
  CommodityCategory,
} from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { Sparkline } from "../components/Sparkline";
import { PriceCell } from "../components/PriceCell";

interface EconomyOverviewProps {
  onSelectRegion: (regionId: string) => void;
}

/** Top 6 commodities to show in the overview table */
const OVERVIEW_COMMODITIES = [
  "iron",
  "grain",
  "fuel-cells",
  "microchips",
  "quantum-cores",
  "steel",
];

export function EconomyOverview({ onSelectRegion }: EconomyOverviewProps) {
  const [summaries, setSummaries] = useState<AdminRegionSummary[]>([]);
  const [detail, setDetail] = useState<AdminRegionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [seeding, setSeeding] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setError("");
      const regions = await api.getRegions();
      setSummaries(regions);

      // Fetch detail for the first region (Phase 1: only "core-worlds")
      if (regions.length > 0 && regions[0]!.tickNumber > 0) {
        const d = await api.getRegionDetail(regions[0]!.regionId);
        setDetail(d);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    try {
      await api.seed();
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setSeeding(false);
    }
  }, [fetchData]);

  if (loading) {
    return <div className="loading">LOADING ECONOMY DATA...</div>;
  }

  const summary = summaries[0];
  const needsSeed =
    !summary || summary.tickNumber === 0 || summary.health === "red";

  return (
    <div className="economy-overview">
      {error && <div className="error-banner">{error}</div>}

      {/* ── Header stats ── */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="label">Regions</div>
          <div className="value">{summaries.length}</div>
          <div className="sub">active</div>
        </div>
        <div className="stat-card">
          <div className="label">Planets</div>
          <div className="value">{summary?.planetCount || 0}</div>
          <div className="sub">simulated</div>
        </div>
        <div className="stat-card">
          <div className="label">Commodities</div>
          <div className="value">{summary?.commodityCount || 0}</div>
          <div className="sub">types</div>
        </div>
        <div className="stat-card">
          <div className="label">Last Tick</div>
          <div className="value">
            {summary?.lastTickAt
              ? formatAge(summary.lastTickAt)
              : "---"}
          </div>
          <div className="sub">
            {summary ? (
              <StatusBadge status={summary.health} />
            ) : (
              "not running"
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Disruptions</div>
          <div className="value">{summary?.activeDisruptions || 0}</div>
          <div className="sub">active</div>
        </div>
      </div>

      {/* ── Seed button if economy not running ── */}
      {needsSeed && (
        <div className="panel" style={{ marginBottom: 20, textAlign: "center" }}>
          <p className="mono text-secondary" style={{ marginBottom: 12 }}>
            Economy not initialized. Seed commodity data and run 24h warmup
            simulation.
          </p>
          <button
            className="btn btn-primary"
            onClick={handleSeed}
            disabled={seeding}
          >
            <Zap size={12} style={{ marginRight: 6 }} />
            {seeding ? "SEEDING & WARMING UP..." : "SEED & WARMUP"}
          </button>
        </div>
      )}

      {/* ── Region price table ── */}
      {detail && (
        <div className="panel">
          <div className="panel-header">
            <span>
              REGION: CORE WORLDS
              <span className="text-dim" style={{ marginLeft: 12 }}>
                TICK #{summary?.tickNumber}
              </span>
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                onClick={() => onSelectRegion("core-worlds")}
              >
                DETAIL VIEW
              </button>
              <button className="btn" onClick={fetchData}>
                <RefreshCw size={11} />
              </button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Planet</th>
                <th>Type</th>
                {OVERVIEW_COMMODITIES.map((id) => (
                  <th key={id} style={{ textAlign: "right" }}>
                    {getCommodityShortName(id, detail)}
                  </th>
                ))}
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {detail.planets.map((planet) => {
                // Aggregate sparkline from all commodities
                const aggSparkline = getAggregateSparkline(planet.commodities);

                return (
                  <tr
                    key={planet.planetId}
                    style={{ cursor: "pointer" }}
                    onClick={() => onSelectRegion("core-worlds")}
                  >
                    <td style={{ fontWeight: 600 }}>{planet.name}</td>
                    <td className="text-secondary">{planet.economyType}</td>
                    {OVERVIEW_COMMODITIES.map((id) => {
                      const c = planet.commodities.find(
                        (c) => c.commodityId === id,
                      );
                      return (
                        <td key={id} style={{ textAlign: "right" }}>
                          {c ? (
                            <PriceCell
                              price={c.currentPrice}
                              basePrice={c.basePrice}
                              change24h={c.priceChange24h}
                            />
                          ) : (
                            <span className="text-dim">---</span>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      <Sparkline data={aggSparkline} width={80} height={24} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── System-wide commodity balance ── */}
      {detail && <CommodityBalanceReport detail={detail} />}

      <style>{`
        .price-cell {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-family: var(--font-mono);
        }
        .trend-icon {
          display: inline-flex;
          align-items: center;
        }
        .trend-icon.up { color: var(--accent-green); }
        .trend-icon.down { color: var(--accent-red); }
        .trend-icon.flat { color: var(--text-dim); }

        /* ── Commodity Balance Report ── */
        .balance-table td,
        .balance-table th {
          padding: 6px 10px;
        }
        .balance-deficit {
          background: rgba(255, 60, 60, 0.06);
        }
        .balance-surplus {
          background: rgba(255, 200, 40, 0.06);
        }
        .balance-badge {
          display: inline-block;
          padding: 1px 8px;
          border-radius: 3px;
          font-size: 0.65rem;
          font-weight: 700;
          letter-spacing: 0.5px;
          font-family: var(--font-mono);
        }
        .balance-badge--deficit {
          background: rgba(255, 60, 60, 0.15);
          color: var(--accent-red);
          border: 1px solid rgba(255, 60, 60, 0.3);
        }
        .balance-badge--surplus {
          background: rgba(255, 200, 40, 0.15);
          color: var(--accent-yellow);
          border: 1px solid rgba(255, 200, 40, 0.3);
        }
        .balance-badge--balanced {
          background: rgba(0, 255, 136, 0.1);
          color: var(--accent-green);
          border: 1px solid rgba(0, 255, 136, 0.2);
        }
      `}</style>
    </div>
  );
}

// ── Commodity Balance Report ──

interface CommodityBalance {
  commodityId: string;
  name: string;
  icon: string;
  category: CommodityCategory;
  totalProduction: number;
  totalConsumption: number;
  netFlow: number; // production - consumption
  over85: string[]; // planet names with fill > 85%
  under15: string[]; // planet names with fill < 15%
}

const CATEGORY_ORDER: CommodityCategory[] = [
  "minerals",
  "food",
  "tech",
  "industrial",
  "luxury",
];

function CommodityBalanceReport({ detail }: { detail: AdminRegionDetail }) {
  const balances = useMemo(() => {
    const map = new Map<string, CommodityBalance>();

    for (const planet of detail.planets) {
      for (const c of planet.commodities) {
        const existing = map.get(c.commodityId);
        if (existing) {
          existing.totalProduction += c.production;
          existing.totalConsumption += c.consumption;
          existing.netFlow = existing.totalProduction - existing.totalConsumption;
          if (c.fillRatio >= 0.85) existing.over85.push(planet.name);
          if (c.fillRatio <= 0.15) existing.under15.push(planet.name);
        } else {
          map.set(c.commodityId, {
            commodityId: c.commodityId,
            name: c.name,
            icon: c.icon,
            category: c.category,
            totalProduction: c.production,
            totalConsumption: c.consumption,
            netFlow: c.production - c.consumption,
            over85: c.fillRatio >= 0.85 ? [planet.name] : [],
            under15: c.fillRatio <= 0.15 ? [planet.name] : [],
          });
        }
      }
    }

    // Sort by category order, then by name
    return [...map.values()].sort((a, b) => {
      const catDiff =
        CATEGORY_ORDER.indexOf(a.category) -
        CATEGORY_ORDER.indexOf(b.category);
      if (catDiff !== 0) return catDiff;
      return a.name.localeCompare(b.name);
    });
  }, [detail]);

  const deficitCount = balances.filter((b) => b.netFlow < 0).length;
  const surplusCount = balances.filter((b) => b.netFlow > 0).length;
  const balancedCount = balances.filter((b) => b.netFlow === 0).length;

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-header">
        <span>
          SOLAR SYSTEM COMMODITY BALANCE
          <span className="text-dim" style={{ marginLeft: 12 }}>
            {deficitCount > 0 && (
              <span style={{ color: "var(--accent-red)", marginRight: 10 }}>
                {deficitCount} DEFICIT
              </span>
            )}
            {surplusCount > 0 && (
              <span style={{ color: "var(--accent-yellow)", marginRight: 10 }}>
                {surplusCount} SURPLUS
              </span>
            )}
            {balancedCount > 0 && (
              <span style={{ color: "var(--accent-green)" }}>
                {balancedCount} BALANCED
              </span>
            )}
          </span>
        </span>
      </div>

      <table className="balance-table">
        <thead>
          <tr>
            <th>Commodity</th>
            <th>Category</th>
            <th style={{ textAlign: "center" }} title="Planets where fill ratio is 85% or above (saturated)">
              85%+
            </th>
            <th style={{ textAlign: "center" }} title="Planets where fill ratio is 15% or below (starving)">
              15%-
            </th>
            <th style={{ textAlign: "right" }}>Production</th>
            <th style={{ textAlign: "right" }}>Consumption</th>
            <th style={{ textAlign: "right" }}>Net Flow</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => {
            const isDeficit = b.netFlow < -0.001;
            const isSurplus = b.netFlow > 0.001;

            return (
              <tr
                key={b.commodityId}
                className={
                  isDeficit ? "balance-deficit" : isSurplus ? "balance-surplus" : ""
                }
              >
                <td>
                  <span style={{ marginRight: 6 }}>{b.icon}</span>
                  {b.name}
                </td>
                <td className="text-secondary">{b.category}</td>
                <td
                  className="tooltip-cell"
                  style={{
                    textAlign: "center",
                    fontFamily: "var(--font-mono)",
                    color: b.over85.length > 0 ? "var(--accent-yellow)" : "var(--text-dim)",
                  }}
                  data-tooltip={b.over85.length > 0 ? `Saturated (85%+): ${b.over85.join(", ")}` : "No planets above 85%"}
                >
                  {b.over85.length || "—"}
                </td>
                <td
                  className="tooltip-cell"
                  style={{
                    textAlign: "center",
                    fontFamily: "var(--font-mono)",
                    color: b.under15.length > 0 ? "var(--accent-red)" : "var(--text-dim)",
                  }}
                  data-tooltip={b.under15.length > 0 ? `Starving (15%-): ${b.under15.join(", ")}` : "No planets below 15%"}
                >
                  {b.under15.length || "—"}
                </td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
                  {b.totalProduction.toFixed(2)}
                </td>
                <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
                  {b.totalConsumption.toFixed(2)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    color: isDeficit
                      ? "var(--accent-red)"
                      : isSurplus
                        ? "var(--accent-yellow)"
                        : "var(--accent-green)",
                  }}
                >
                  {b.netFlow > 0 ? "+" : ""}
                  {b.netFlow.toFixed(2)}
                </td>
                <td>
                  {isDeficit ? (
                    <span className="balance-badge balance-badge--deficit">
                      DEFICIT
                    </span>
                  ) : isSurplus ? (
                    <span className="balance-badge balance-badge--surplus">
                      SURPLUS
                    </span>
                  ) : (
                    <span className="balance-badge balance-badge--balanced">
                      BALANCED
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div
        className="text-dim"
        style={{ padding: "8px 12px", fontSize: "0.75rem", lineHeight: 1.5 }}
      >
        <span style={{ color: "var(--accent-red)" }}>RED / DEFICIT</span> = system
        consumes more than it produces — commodity will collapse even with trade
        routes.{" "}
        <span style={{ color: "var(--accent-yellow)" }}>YELLOW / SURPLUS</span> =
        system produces more than it consumes — commodity will saturate over time.
        Players can profit by trading surplus to deficit zones.
      </div>
    </div>
  );
}

// ── Helpers ──

function formatAge(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function getCommodityShortName(
  id: string,
  detail: AdminRegionDetail,
): string {
  const planet = detail.planets[0];
  if (!planet) return id;
  const c = planet.commodities.find((c) => c.commodityId === id);
  if (!c) return id;
  // Short name: first word
  return c.name.split(" ")[0] || id;
}

function getAggregateSparkline(
  commodities: { sparkline: number[]; basePrice: number }[],
): number[] {
  // Average the normalized price ratios across all commodities
  const withData = commodities.filter((c) => c.sparkline.length > 0);
  if (withData.length === 0) return [];

  const maxLen = Math.max(...withData.map((c) => c.sparkline.length));
  const result: number[] = [];

  for (let i = 0; i < maxLen; i++) {
    let sum = 0;
    let count = 0;
    for (const c of withData) {
      const idx = i - (maxLen - c.sparkline.length);
      if (idx >= 0 && idx < c.sparkline.length) {
        sum += c.sparkline[idx]! / c.basePrice;
        count++;
      }
    }
    result.push(count > 0 ? sum / count : 1);
  }

  return result;
}
