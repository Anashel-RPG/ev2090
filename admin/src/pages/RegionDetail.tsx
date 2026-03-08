import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo, Fragment } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, RefreshCw, AlertTriangle, Zap, X, TrendingUp, Truck, Package, Activity, Copy, Check, ArrowRightLeft, HelpCircle, ChevronRight } from "lucide-react";
import { api } from "../api";
import type {
  AdminRegionDetail,
  AdminPlanetMarketState,
  AdminCommodityState,
  AdminDisruptionView,
  EnrichedPriceHistoryPoint,
  EnrichedPriceHistoryResponse,
  NpcTradeEvent,
  NpcTradeRoute,
} from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { Sparkline } from "../components/Sparkline";
import { FillBar } from "../components/PriceCell";
import "./RegionDetail.css";

// ── Help Tooltip Component ──
// Small ? circle that shows a contextual tooltip on hover/click

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; flipped: boolean } | null>(null);

  // Phase 1: when open changes, render bubble with preliminary position (for measurement)
  useLayoutEffect(() => {
    if (!open || !iconRef.current) { setPos(null); return; }
    const rect = iconRef.current.getBoundingClientRect();
    const bubbleW = 280;

    let left = rect.left + rect.width / 2 - bubbleW / 2;
    if (left < 8) left = 8;
    if (left + bubbleW > window.innerWidth - 8) left = window.innerWidth - bubbleW - 8;

    // Preliminary: position above icon (will be corrected in phase 2)
    setPos({ top: rect.top - 8, left, flipped: false });
  }, [open]);

  // Phase 2: after bubble renders, measure its ACTUAL height and position correctly.
  // No CSS transform — all positioning computed in JS for accuracy.
  useLayoutEffect(() => {
    if (!open || !pos || !bubbleRef.current || !iconRef.current) return;
    const iconRect = iconRef.current.getBoundingClientRect();
    const bubbleH = bubbleRef.current.offsetHeight;

    // Check if there's room above the icon for the actual bubble height
    const flipped = iconRect.top - bubbleH - 8 < 0;
    const top = flipped
      ? iconRect.bottom + 8             // below icon
      : iconRect.top - bubbleH - 8;     // above icon (exact, no CSS transform)

    // Only update if position actually changed to avoid loops
    if (pos.top !== top || pos.flipped !== flipped) {
      setPos(prev => prev ? { top, left: prev.left, flipped } : null);
    }
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        iconRef.current && !iconRef.current.contains(e.target as Node) &&
        bubbleRef.current && !bubbleRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const arrowLeft = (iconRef.current && pos)
    ? iconRef.current.getBoundingClientRect().left + iconRef.current.getBoundingClientRect().width / 2 - pos.left
    : 140;

  return (
    <span className="help-tip" ref={iconRef}>
      <span
        className="help-tip-icon"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        <HelpCircle size={11} />
      </span>
      {open && pos && createPortal(
        <div
          ref={bubbleRef}
          className={`help-tip-bubble ${pos.flipped ? "help-tip-flipped" : ""}`}
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {text}
          <span className="help-tip-arrow" style={{ left: arrowLeft }} />
        </div>,
        document.body
      )}
    </span>
  );
}

// ── Shared Health Status Computation ──

type HealthStatus = {
  label: string;
  color: string;
  bg: string;
  icon: string;
  description: string;
};

function computeHealthStatus(
  commodity: AdminCommodityState,
  planetId: string,
  planetName: string,
  allPlanets: AdminPlanetMarketState[],
  routes: NpcTradeRoute[],
  disruptions: AdminDisruptionView[],
): HealthStatus {
  const relatedRoutes = routes.filter(
    (r) => r.commodityId === commodity.commodityId &&
      (r.sourcePlanet === planetId || r.destPlanet === planetId),
  );
  const inboundRoutes = relatedRoutes.filter(r => r.destPlanet === planetId);
  const outboundRoutes = relatedRoutes.filter(r => r.sourcePlanet === planetId);
  const crossPlanetPrices = allPlanets.map(p => {
    const c = p.commodities.find(c2 => c2.commodityId === commodity.commodityId);
    return c ? { production: c.production, consumption: c.consumption } : null;
  }).filter(Boolean) as { production: number; consumption: number }[];

  const anyProducesAnywhere = crossPlanetPrices.some(p => p.production > 0);
  const thisProduces = commodity.production > 0;
  const thisConsumes = commodity.consumption > 0;
  const fill = commodity.fillRatio;
  const netFlow = commodity.production - commodity.consumption;
  const priceRatio = commodity.currentPrice / commodity.basePrice;

  const relatedDisruptions = disruptions.filter(
    (d) => d.planetId === planetId && (!d.commodityId || d.commodityId === commodity.commodityId),
  );

  // HALTED: stock is at 0 — no trade possible (price locked at max)
  if (commodity.quantity === 0 || fill < 0.005) {
    return { label: "HALTED", color: "#ff2244", bg: "rgba(255, 34, 68, 0.15)", icon: "⛔",
      description: `${commodity.name} at ${planetName} is completely depleted — 0 stock. Trade is halted. Buy price is locked at maximum (${commodity.basePrice ? "ceiling" : "max"} price). ${thisProduces ? "Production will slowly refill stock." : "No local production — needs trade route delivery or player import."}` };
  }
  if (!anyProducesAnywhere && inboundRoutes.length === 0 && thisConsumes) {
    return { label: "ORPHAN", color: "#ff4466", bg: "rgba(255, 68, 102, 0.12)", icon: "⚠",
      description: `No planet produces ${commodity.name}. This commodity has no supply chain — consumption drains stock with no replenishment. Stock will reach 0 and trade will halt. Player-only commodity.` };
  }
  if (!thisProduces && inboundRoutes.length === 0 && thisConsumes && anyProducesAnywhere) {
    return { label: "NO SUPPLY", color: "#ff8c42", bg: "rgba(255, 140, 66, 0.12)", icon: "🚫",
      description: `${commodity.name} is produced at other planets but no NPC trade route delivers it to ${planetName}. Stock will drain to 0 over time. A trade route or player import is needed.` };
  }
  if (netFlow < -1 && fill < 0.20 && (inboundRoutes.length > 0 || thisProduces)) {
    return { label: "UNDERSUPPLIED", color: "#ffcc00", bg: "rgba(255, 204, 0, 0.10)", icon: "📉",
      description: `${planetName} has supply for ${commodity.name} (${thisProduces ? "local production" : "trade routes"}), but consumption outpaces it. Fill is at ${(fill * 100).toFixed(0)}% — the supply chain can't keep up with demand of ${commodity.consumption.toFixed(1)}/tick.` };
  }
  if (netFlow > 1 && outboundRoutes.length === 0 && fill > 0.5) {
    return { label: "EXPORT OPP", color: "#00ccff", bg: "rgba(0, 204, 255, 0.10)", icon: "💎",
      description: `${planetName} produces more ${commodity.name} than it consumes and no NPC route exports it. Stock is piling up at ${(fill * 100).toFixed(0)}% fill — prices are below base. A player (or new route) buying cheap here and selling elsewhere would be pure profit.` };
  }
  if (fill > 0.75) {
    return { label: "OVERSUPPLIED", color: "#6699ff", bg: "rgba(102, 153, 255, 0.10)", icon: "📦",
      description: `${planetName} has ${(fill * 100).toFixed(0)}% fill for ${commodity.name} — well above the 50% equilibrium. Prices are depressed at ${priceRatio.toFixed(2)}x base. Supply exceeds demand here.` };
  }
  if (relatedDisruptions.length > 0) {
    return { label: "DISRUPTED", color: "#ff66cc", bg: "rgba(255, 102, 204, 0.10)", icon: "⚡",
      description: `An active disruption is affecting ${commodity.name} at ${planetName}: ${relatedDisruptions[0]!.type.replace(/_/g, " ")}. Normal production/consumption patterns are altered.` };
  }
  return { label: "BALANCED", color: "#44cc88", bg: "rgba(68, 204, 136, 0.10)", icon: "✓",
    description: `${commodity.name} at ${planetName} is in a healthy state — fill is ${(fill * 100).toFixed(0)}%, net flow is ${netFlow > 0 ? "+" : ""}${netFlow.toFixed(1)}/tick. Supply and demand are roughly in balance${inboundRoutes.length > 0 ? ` with ${inboundRoutes.length} inbound trade route${inboundRoutes.length > 1 ? "s" : ""}` : ""}.` };
}

const FILTER_STORAGE_KEY = "ev2090:priceFilterMinutes";

const TIME_FILTERS = [
  { label: "10m", minutes: 10 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "ALL", minutes: 0 },
] as const;

/** Threshold: below this absolute % change the row is considered "no change" */
const CHANGE_THRESHOLD = 0.3;

/** Sparkline entries are ~30 min apart. Map filter minutes → how many sparkline entries back to look. */
function sparklineWindowEntries(filterMinutes: number): number {
  if (filterMinutes === 0) return 48; // ALL = full sparkline
  return Math.max(1, Math.ceil(filterMinutes / 30));
}

/** Compute % change from sparkline within the time window. */
function sparklineChange(sparkline: number[], filterMinutes: number): number {
  if (sparkline.length < 2) return 0;
  const latest = sparkline[sparkline.length - 1]!;
  const lookback = sparklineWindowEntries(filterMinutes);
  const idx = Math.max(0, sparkline.length - 1 - lookback);
  const ref = sparkline[idx]!;
  if (ref === 0) return 0;
  return ((latest - ref) / ref) * 100;
}

interface RegionDetailProps {
  regionId: string;
  onBack: () => void;
}

export function RegionDetail({ regionId, onBack }: RegionDetailProps) {
  const [detail, setDetail] = useState<AdminRegionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedPlanet, setSelectedPlanet] = useState<string | null>(null);
  const [selectedCommodity, setSelectedCommodity] = useState<string | null>(
    null,
  );
  const [historyResponse, setHistoryResponse] =
    useState<EnrichedPriceHistoryResponse | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  // Trade route detail modal
  const [selectedRoute, setSelectedRoute] = useState<NpcTradeRoute | null>(null);

  // Disruption form state
  const [disruptType, setDisruptType] = useState("production_halt");
  const [disruptPlanet, setDisruptPlanet] = useState("");
  const [disruptCommodity, setDisruptCommodity] = useState("iron");
  const [disruptDuration, setDisruptDuration] = useState("2");
  const [disrupting, setDisrupting] = useState(false);

  // Auto-refresh countdown
  const [refreshCountdown, setRefreshCountdown] = useState(30);

  // Price filter — persisted in localStorage
  const [filterMinutes, setFilterMinutes] = useState(() => {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY);
    return stored ? parseInt(stored, 10) : 0;
  });
  const handleFilterChange = useCallback((minutes: number) => {
    setFilterMinutes(minutes);
    localStorage.setItem(FILTER_STORAGE_KEY, String(minutes));
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setError("");
      const d = await api.getRegionDetail(regionId);
      setDetail(d);

      if (!selectedPlanet && d.planets.length > 0) {
        setSelectedPlanet(d.planets[0]!.planetId);
        setDisruptPlanet(d.planets[0]!.planetId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [regionId, selectedPlanet]);

  // Main data refresh + countdown
  useEffect(() => {
    fetchData();
    setRefreshCountdown(30);

    const dataInterval = setInterval(() => {
      fetchData();
      setRefreshCountdown(30);
    }, 30_000);

    const countdownInterval = setInterval(() => {
      setRefreshCountdown((c) => Math.max(0, c - 1));
    }, 1_000);

    return () => {
      clearInterval(dataInterval);
      clearInterval(countdownInterval);
    };
  }, [fetchData]);

  // Fetch chart data when commodity selected (with auto-refresh)
  const fetchChart = useCallback(async () => {
    if (!selectedPlanet || !selectedCommodity) {
      setHistoryResponse(null);
      return;
    }
    setChartLoading(true);
    try {
      const resp = await api.getEnrichedHistory(
        regionId,
        selectedPlanet,
        selectedCommodity,
        24,
      );
      setHistoryResponse(resp);
    } catch {
      setHistoryResponse(null);
    } finally {
      setChartLoading(false);
    }
  }, [regionId, selectedPlanet, selectedCommodity]);

  useEffect(() => {
    fetchChart();
    // Also refresh chart data every 30s
    const interval = setInterval(fetchChart, 30_000);
    return () => clearInterval(interval);
  }, [fetchChart]);

  const handleDisrupt = useCallback(async () => {
    setDisrupting(true);
    try {
      await api.triggerDisruption(regionId, {
        type: disruptType,
        planetId: disruptPlanet,
        commodityId: disruptCommodity,
        multiplier: disruptType === "production_halt" ? undefined : 2.5,
        durationMs: parseFloat(disruptDuration) * 3_600_000,
      });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disruption failed");
    } finally {
      setDisrupting(false);
    }
  }, [
    regionId,
    disruptType,
    disruptPlanet,
    disruptCommodity,
    disruptDuration,
    fetchData,
  ]);

  const closeSidebar = useCallback(() => {
    setSelectedCommodity(null);
    setHistoryResponse(null);
  }, []);

  if (loading) return <div className="loading">LOADING REGION DATA...</div>;
  if (!detail) return <div className="loading">NO DATA</div>;

  const activePlanet = detail.planets.find(
    (p) => p.planetId === selectedPlanet,
  );

  const activeCommodity = activePlanet?.commodities.find(
    (c) => c.commodityId === selectedCommodity,
  );

  return (
    <div className="region-detail">
      {error && <div className="error-banner">{error}</div>}

      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button className="btn" onClick={onBack}>
          <ArrowLeft size={12} /> BACK
        </button>
        <h2
          className="mono"
          style={{ fontSize: 14, letterSpacing: "0.1em", flex: 1 }}
        >
          REGION: {regionId.toUpperCase().replace("-", " ")}
        </h2>
        <StatusBadge
          status={
            detail.tickStats.warmupComplete
              ? Date.now() - detail.tickStats.lastTickAt < 120_000
                ? "ok"
                : "delayed"
              : "stopped"
          }
        />
        <span className="mono text-dim" style={{ fontSize: 10 }}>
          TICK #{detail.tickStats.tickNumber} | AVG{" "}
          {detail.tickStats.avgTickDurationMs.toFixed(1)}ms
        </span>
        <div className="auto-refresh">
          <span className="refresh-dot" />
          {refreshCountdown}s
        </div>
        <button className="btn" onClick={fetchData}>
          <RefreshCw size={11} />
        </button>
      </div>

      {/* ── Main content + sidebar layout ── */}
      <div className="region-detail-layout">
        {/* ── Left: main content ── */}
        <div
          className={`region-main${selectedCommodity && activeCommodity ? " sidebar-open" : ""}`}
        >
          {/* ── Planet tabs ── */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {detail.planets.map((p) => (
              <button
                key={p.planetId}
                className={`btn ${selectedPlanet === p.planetId ? "btn-primary" : ""}`}
                onClick={() => {
                  setSelectedPlanet(p.planetId);
                  setSelectedCommodity(null);
                  setHistoryResponse(null);
                }}
              >
                {p.name.toUpperCase()}
                <span
                  className="text-dim"
                  style={{ marginLeft: 6, fontSize: 9 }}
                >
                  {p.economyType}
                </span>
              </button>
            ))}
          </div>

          {/* ── Commodity table ── */}
          {activePlanet && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-header">
                {activePlanet.name} — COMMODITIES
                <span className="text-dim" style={{ fontSize: 9 }}>
                  CLICK ROW FOR DETAILS
                </span>
              </div>
              {/* ── Time filter (shared with sidebar log) ── */}
              <div className="table-filter-bar">
                <span className="table-filter-label">WINDOW</span>
                <div className="log-filter-row" style={{ marginBottom: 0 }}>
                  {TIME_FILTERS.map((f) => (
                    <button
                      key={f.label}
                      className={`log-filter-chip ${filterMinutes === f.minutes ? "active" : ""}`}
                      onClick={() => handleFilterChange(f.minutes)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <CommodityTable
                planet={activePlanet}
                allPlanets={detail.planets}
                routes={detail.routes}
                selectedId={selectedCommodity}
                filterMinutes={filterMinutes}
                onSelect={(id) =>
                  setSelectedCommodity(
                    id === selectedCommodity ? null : id,
                  )
                }
              />
            </div>
          )}

          {/* ── Trade routes (grouped by source planet) ── */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-header">NPC TRADE ROUTES</div>
            {detail.routes.length === 0 ? (
              <div
                className="text-dim mono"
                style={{ fontSize: 11, padding: 10 }}
              >
                No trade routes active
              </div>
            ) : (() => {
              // Group routes by source planet
              const grouped = new Map<string, NpcTradeRoute[]>();
              for (const r of detail.routes) {
                const list = grouped.get(r.sourcePlanet) ?? [];
                list.push(r);
                grouped.set(r.sourcePlanet, list);
              }
              return (
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 24 }}></th>
                      <th>Commodity</th>
                      <th>Dest</th>
                      <th>Trip</th>
                      <th>ETA</th>
                      <th>Status</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(grouped.entries()).map(([sourcePlanet, routes]) => {
                      // Dim group if no route in this group involves the selected planet
                      const groupRelevant = !selectedPlanet ||
                        sourcePlanet === selectedPlanet ||
                        routes.some(r => r.destPlanet === selectedPlanet);
                      // Direction label relative to selected planet
                      const isOutbound = selectedPlanet && sourcePlanet === selectedPlanet;
                      const isInbound = selectedPlanet && !isOutbound && routes.some(r => r.destPlanet === selectedPlanet);
                      return (
                        <Fragment key={sourcePlanet}>
                          <tr className="route-group-header" style={{ opacity: groupRelevant ? 1 : 0.2, transition: "opacity 0.2s" }}>
                            <td colSpan={7} style={{
                              padding: "8px 10px 4px",
                              fontFamily: "var(--font-mono)",
                              fontWeight: 600,
                              fontSize: "0.82rem",
                              letterSpacing: "0.04em",
                              color: "var(--text-primary)",
                              borderBottom: "1px solid var(--border)",
                            }}>
                              ▸ {sourcePlanet.toUpperCase()}
                              {isOutbound && (
                                <span style={{ marginLeft: 10, fontSize: "0.7rem", color: "var(--accent-yellow)", letterSpacing: "0.08em" }}>
                                  OUTBOUND
                                </span>
                              )}
                              {isInbound && (
                                <span style={{ marginLeft: 10, fontSize: "0.7rem", color: "var(--accent-blue)", letterSpacing: "0.08em" }}>
                                  INBOUND
                                </span>
                              )}
                            </td>
                          </tr>
                          {routes.map((r) => {
                            const tripM = Math.round(r.tripDurationMs / 60_000);
                            const rHealth = computeRouteHealth(r, detail.planets, detail.routes);

                            // ETA: time remaining if in transit
                            let eta = "—";
                            if (r.inTransit && r.lastDeparture > 0) {
                              const elapsed = Math.round((Date.now() - r.lastDeparture) / 60_000);
                              const remaining = tripM - elapsed;
                              eta = remaining > 0 ? `${remaining}m` : "arriving";
                            }

                            // Notes: forecast summary
                            const destPlanetData = detail.planets.find(p => p.planetId === r.destPlanet);
                            const destC = destPlanetData?.commodities.find(c => c.commodityId === r.commodityId);
                            let note = "";
                            if (destC) {
                              const dNet = (destC.production ?? 0) - (destC.consumption ?? 0);
                              const dFill = destC.fillRatio;
                              const dCap = destC.capacity ?? 50000;
                              if (destC.quantity === 0 || dFill < 0.005) {
                                note = "Halted";
                              } else if (dNet < 0) {
                                const hrs = (dFill * dCap) / (Math.abs(dNet) * 60);
                                note = hrs < 24 ? `Depletes ~${hrs < 1 ? `${(hrs * 60).toFixed(0)}m` : `${hrs.toFixed(0)}h`}` : "Slow drain";
                              } else {
                                note = "Stable";
                              }
                            }

                            const noteColor = note === "Halted" ? "var(--accent-red)"
                              : note.startsWith("Depletes") ? "var(--accent-red)"
                              : note === "Stable" ? "var(--text-dim)" : "var(--text-dim)";

                            const routeRelevant = !selectedPlanet ||
                              r.sourcePlanet === selectedPlanet ||
                              r.destPlanet === selectedPlanet;

                            return (
                              <tr
                                key={r.id}
                                style={{ cursor: "pointer", opacity: routeRelevant ? 1 : 0.2, transition: "opacity 0.2s" }}
                                onClick={() => setSelectedRoute(r)}
                                title={rHealth.status === "grey" ? "Click for details" : `${rHealth.status === "red" ? "🔴" : "🟡"} ${rHealth.reason}`}
                              >
                                <td>
                                  <span className={`health-indicator health-indicator--${rHealth.status}`} />
                                </td>
                                <td>{r.commodityId}</td>
                                <td>{r.destPlanet}</td>
                                <td>{tripM}m</td>
                                <td style={{ color: eta === "arriving" ? "var(--accent-green)" : "var(--text-dim)" }}>{eta}</td>
                                <td>
                                  <StatusBadge
                                    status={r.inTransit ? "ok" : "stopped"}
                                    label={r.inTransit ? "IN TRANSIT" : "IDLE"}
                                  />
                                </td>
                                <td style={{ color: noteColor, fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{note}</td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </div>

          {/* ── Active disruptions ── */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-header">
              <span>
                <AlertTriangle size={12} style={{ marginRight: 6 }} />
                ACTIVE DISRUPTIONS
              </span>
              <span className="text-dim">
                {detail.disruptions.length} active
              </span>
            </div>
            {detail.disruptions.length === 0 ? (
              <div
                className="text-dim mono"
                style={{ fontSize: 11, padding: 10 }}
              >
                No active disruptions
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Planet</th>
                    <th>Commodity</th>
                    <th>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.disruptions.map((d) => (
                    <tr key={d.id}>
                      <td className="text-yellow">
                        {d.type.replace(/_/g, " ")}
                      </td>
                      <td>{d.planetId}</td>
                      <td>{d.commodityId || "---"}</td>
                      <td>{formatDuration(d.remainingMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Trigger disruption ── */}
          <div className="panel">
            <div className="panel-header">
              <Zap size={12} style={{ marginRight: 6 }} />
              TRIGGER DISRUPTION
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "end",
                flexWrap: "wrap",
              }}
            >
              <label className="form-field">
                <span className="form-label">Type</span>
                <select
                  value={disruptType}
                  onChange={(e) => setDisruptType(e.target.value)}
                >
                  <option value="production_halt">Production Halt</option>
                  <option value="production_boost">Production Boost</option>
                  <option value="demand_surge">Demand Surge</option>
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">Planet</span>
                <select
                  value={disruptPlanet}
                  onChange={(e) => setDisruptPlanet(e.target.value)}
                >
                  {detail.planets.map((p) => (
                    <option key={p.planetId} value={p.planetId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">Commodity</span>
                <select
                  value={disruptCommodity}
                  onChange={(e) => setDisruptCommodity(e.target.value)}
                >
                  {activePlanet?.commodities.map((c) => (
                    <option key={c.commodityId} value={c.commodityId}>
                      {c.name}
                    </option>
                  )) || null}
                </select>
              </label>
              <label className="form-field">
                <span className="form-label">Duration (h)</span>
                <input
                  type="number"
                  value={disruptDuration}
                  onChange={(e) => setDisruptDuration(e.target.value)}
                  min="0.5"
                  max="12"
                  step="0.5"
                  style={{ width: 60 }}
                />
              </label>
              <button
                className="btn btn-danger"
                onClick={handleDisrupt}
                disabled={disrupting}
              >
                {disrupting ? "TRIGGERING..." : "TRIGGER"}
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* ── Right: Commodity detail sidebar (overlays from header down) ── */}
      {selectedCommodity && activeCommodity && (
        <CommoditySidebar
          commodity={activeCommodity}
          planetName={activePlanet?.name || ""}
          planetId={activePlanet?.planetId || ""}
          allPlanets={detail.planets}
          routes={detail.routes}
          disruptions={detail.disruptions}
          historyResponse={historyResponse}
          chartLoading={chartLoading}
          filterMinutes={filterMinutes}
          onFilterChange={handleFilterChange}
          onClose={closeSidebar}
        />
      )}

      {/* ── Trade Route Detail Modal ── */}
      {selectedRoute && detail && (
        <TradeRouteModal
          route={selectedRoute}
          allPlanets={detail.planets}
          allRoutes={detail.routes}
          onClose={() => setSelectedRoute(null)}
        />
      )}

      <style>{`
        .form-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .form-label {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-dim);
        }
      `}</style>
    </div>
  );
}

// ── Trade Route Detail Modal ──

/**
 * Trade route health: 3-tier assessment
 *
 *  🔴 RED    = route will NEVER send a ship (structurally impossible)
 *             - source has zero production for this commodity
 *             - source stock is 0 and no production to refill
 *             - source fill permanently below 30% (NPC trade threshold)
 *               because production < consumption and no inbound routes
 *
 *  🟡 YELLOW = route works but combined supply can't meet dest deficit
 *             - all sibling routes' delivery < dest net consumption
 *
 *  ⚪ GREY   = healthy arbitrage — prices fluctuate, route triggers
 *               naturally when margins appear
 */
type RouteHealth = { status: "red" | "yellow" | "grey"; reason: string };

function computeRouteHealth(
  route: NpcTradeRoute,
  allPlanets: AdminPlanetMarketState[],
  allRoutes: NpcTradeRoute[],
): RouteHealth {
  const sourcePlanet = allPlanets.find(p => p.planetId === route.sourcePlanet);
  const destPlanet = allPlanets.find(p => p.planetId === route.destPlanet);
  const sourceC = sourcePlanet?.commodities.find(c => c.commodityId === route.commodityId);
  const destC = destPlanet?.commodities.find(c => c.commodityId === route.commodityId);
  if (!sourceC || !destC) return { status: "red", reason: "Missing market data" };

  // ── RED: source has no production and stock is depleted ──
  // If source doesn't produce this commodity AND fill is near-zero, ship will never fly
  if (sourceC.production === 0 && sourceC.fillRatio < 0.05) {
    return { status: "red", reason: "Source has no production — stock depleted" };
  }

  // ── RED: source will never reach 30% fill (NPC minimum to depart) ──
  // If source net flow is negative (consuming faster than producing)
  // and no inbound routes feed this commodity to the source
  if (sourceC.production === 0) {
    const inboundToSource = allRoutes.filter(
      r => r.commodityId === route.commodityId && r.destPlanet === route.sourcePlanet,
    );
    if (inboundToSource.length === 0) {
      return { status: "red", reason: "Source has no production and no inbound routes" };
    }
  }

  // ── RED: source production < source consumption with no outside help ──
  const sourceNet = sourceC.production - sourceC.consumption;
  if (sourceNet < 0 && sourceC.fillRatio < 0.30) {
    const inboundToSource = allRoutes.filter(
      r => r.commodityId === route.commodityId && r.destPlanet === route.sourcePlanet,
    );
    if (inboundToSource.length === 0) {
      return { status: "red", reason: `Source draining (net ${sourceNet.toFixed(1)}/tick) — will never reach 30% fill` };
    }
  }

  // ── YELLOW: combined supply from all routes can't meet dest deficit ──
  const destNet = destC.production - destC.consumption; // dest's own net (usually negative)
  if (destNet < 0) {
    // How much do ALL sibling routes deliver per hour to this dest for this commodity?
    const siblingRoutes = allRoutes.filter(
      r => r.commodityId === route.commodityId && r.destPlanet === route.destPlanet,
    );
    let totalDeliveryPerH = 0;
    for (const sr of siblingRoutes) {
      const tripM = Math.round(sr.tripDurationMs / 60_000);
      const cycleM = tripM + Math.round(tripM * 1.5);
      totalDeliveryPerH += cycleM > 0 ? (sr.volumePerTrip / cycleM) * 60 : 0;
    }
    const deficitPerH = Math.abs(destNet) * 60; // dest's net deficit per hour
    if (totalDeliveryPerH < deficitPerH) {
      return {
        status: "yellow",
        reason: `Supply ${totalDeliveryPerH.toFixed(1)}u/h < deficit ${deficitPerH.toFixed(1)}u/h (${siblingRoutes.length} route${siblingRoutes.length !== 1 ? "s" : ""})`,
      };
    }
  }

  // ── GREY: healthy arbitrage — route fires when margins appear ──
  return { status: "grey", reason: "Healthy — arbitrage-driven" };
}

function TradeRouteModal({
  route,
  allPlanets,
  allRoutes,
  onClose,
}: {
  route: NpcTradeRoute;
  allPlanets: AdminPlanetMarketState[];
  allRoutes: NpcTradeRoute[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const sourcePlanet = allPlanets.find(p => p.planetId === route.sourcePlanet);
  const destPlanet = allPlanets.find(p => p.planetId === route.destPlanet);
  const sourceCommodity = sourcePlanet?.commodities.find(c => c.commodityId === route.commodityId);
  const destCommodity = destPlanet?.commodities.find(c => c.commodityId === route.commodityId);

  const tripMin = Math.round(route.tripDurationMs / 60_000);
  const cooldownMin = Math.round(tripMin * 1.5);
  const cycleMin = tripMin + cooldownMin;

  const sourcePrice = sourceCommodity?.currentPrice ?? 0;
  const destPrice = destCommodity?.currentPrice ?? 0;
  const margin = sourcePrice > 0 ? ((destPrice - sourcePrice) / sourcePrice) * 100 : 0;
  const profitPerTrip = (destPrice - sourcePrice) * route.volumePerTrip;
  const profitPerHour = cycleMin > 0 ? (profitPerTrip / cycleMin) * 60 : 0;
  const meetsThreshold = margin >= 15;

  const destConsumption = destCommodity?.consumption ?? 0;
  const consumptionPerHour = destConsumption * 60;

  // Consumption share: what % of dest consumption does this route's delivery rate cover?
  const routeDeliveryPerH = cycleMin > 0 ? (route.volumePerTrip / cycleMin) * 60 : 0;
  const consumptionSharePct = consumptionPerHour > 0
    ? (routeDeliveryPerH / consumptionPerHour) * 100
    : Infinity;

  const destNet = (destCommodity?.production ?? 0) - destConsumption;
  const destFill = destCommodity?.fillRatio ?? 0;
  const destCapacity = destCommodity?.capacity ?? 50000;

  // Sibling routes
  const siblingRoutes = allRoutes.filter(r => r.commodityId === route.commodityId && r.destPlanet === route.destPlanet);
  let totalDeliveryPerH = 0;
  for (const sr of siblingRoutes) {
    const tM = Math.round(sr.tripDurationMs / 60_000);
    const cM = tM + Math.round(tM * 1.5);
    totalDeliveryPerH += cM > 0 ? (sr.volumePerTrip / cM) * 60 : 0;
  }
  const totalCoverage = consumptionPerHour > 0 ? totalDeliveryPerH / consumptionPerHour : Infinity;

  // Depletion timing
  const destCurrentUnits = destFill * destCapacity;
  const destNetAllRoutes = destNet + (totalDeliveryPerH / 60);
  const hoursToDepletion = (destNetAllRoutes < 0 && destCurrentUnits > 0)
    ? destCurrentUnits / Math.abs(destNetAllRoutes) / 60
    : null;

  const timeSinceDepart = route.lastDeparture > 0
    ? Math.round((Date.now() - route.lastDeparture) / 60_000)
    : null;

  // Likely outcome (short)
  const likelyOutcome = !meetsThreshold
    ? "Route inactive — prices too close"
    : totalCoverage >= 1
      ? "Destination stabilizing"
      : hoursToDepletion && hoursToDepletion < 24
        ? `Destination depletes in ~${hoursToDepletion.toFixed(0)}h`
        : totalCoverage >= 0.5
          ? "Slow drain — needs more routes"
          : "Severe shortage — demand far exceeds supply";

  const handleCopy = () => {
    const payload = {
      route: { commodity: route.commodityId, source: sourcePlanet?.name, dest: destPlanet?.name },
      config: { volumePerTrip: Math.round(route.volumePerTrip), tripMin, cycleMin },
      status: { enabled: route.enabled, inTransit: route.inTransit, margin: `${margin.toFixed(1)}%`, meetsThreshold, lastDeparture: timeSinceDepart !== null ? `${timeSinceDepart}m ago` : "Never" },
      prices: { source: sourcePrice, dest: destPrice, profitPerHour: Math.round(profitPerHour) },
      economics: { consumptionShare: `${consumptionSharePct === Infinity ? "∞" : consumptionSharePct.toFixed(1)}%`, coverage: `${(totalCoverage * 100).toFixed(0)}%`, siblingRoutes: siblingRoutes.length },
      forecast: { hoursToDepletion: hoursToDepletion ? `${hoursToDepletion.toFixed(1)}h` : null, likelyOutcome },
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="drilldown-overlay" onClick={onClose}>
      <div className="drilldown-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="drilldown-header">
          <h4>
            <Truck size={14} style={{ marginRight: 6 }} />
            {route.commodityId} Route
          </h4>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="text-dim">{sourcePlanet?.name} → {destPlanet?.name}</span>
            <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={handleCopy}>
              {copied ? <Check size={10} /> : <Copy size={10} />}
              <span style={{ marginLeft: 4 }}>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button className="sidebar-close" onClick={onClose}>
              <X size={12} />
            </button>
          </div>
        </div>

        {/* ── Route + Status side by side ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          <div className="drilldown-section">
            <div className="drilldown-label">Route</div>
            <div className="drilldown-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="dd-stat"><span className="dd-key">Trip Duration</span><span className="dd-val">{tripMin}m</span></div>
              <div className="dd-stat"><span className="dd-key">Full Cycle</span><span className="dd-val">{cycleMin}m ({(cycleMin / 60).toFixed(1)}h)</span></div>
              <div className="dd-stat"><span className="dd-key">Last Volume</span><span className="dd-val">{Math.round(route.volumePerTrip)}u</span></div>
            </div>
          </div>

          <div className="drilldown-section">
            <div className="drilldown-label">Status</div>
            <div className="drilldown-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="dd-stat">
                <span className="dd-key">Status</span>
                <span className="dd-val" style={{ color: route.inTransit ? "var(--accent-green)" : "var(--text-dim)" }}>
                  {route.inTransit ? "IN TRANSIT" : "IDLE"}
                </span>
              </div>
              <div className="dd-stat">
                <span className="dd-key">Will Trade?</span>
                <span className="dd-val" style={{ color: meetsThreshold ? "var(--accent-green)" : "var(--accent-red)" }}>
                  {meetsThreshold ? "YES" : "NO — margin too low"}
                </span>
              </div>
              <div className="dd-stat"><span className="dd-key">Last Departure</span><span className="dd-val">{timeSinceDepart !== null ? `${timeSinceDepart}m ago` : "Never"}</span></div>
            </div>
          </div>
        </div>

        {/* ── Price Comparison (simplified) ── */}
        <div className="drilldown-section">
          <div className="drilldown-label">Prices</div>
          <div className="route-price-compare">
            <div className="route-planet-card">
              <div className="rpc-label">SOURCE: {sourcePlanet?.name?.toUpperCase()}</div>
              <div className="rpc-price">{sourcePrice.toFixed(1)} cr</div>
            </div>
            <div className="route-arrow">→</div>
            <div className="route-planet-card">
              <div className="rpc-label">DEST: {destPlanet?.name?.toUpperCase()}</div>
              <div className="rpc-price">{destPrice.toFixed(1)} cr</div>
            </div>
          </div>
        </div>

        {/* ── Economics + Forecast side by side ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          <div className="drilldown-section" style={{ borderBottom: "none" }}>
            <div className="drilldown-label">Economics</div>
            <div className="drilldown-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="dd-stat">
                <span className="dd-key">Profit/Hour</span>
                <span className="dd-val" style={{ color: profitPerHour > 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                  {profitPerHour > 0 ? "+" : ""}{profitPerHour >= 1000 ? `${(profitPerHour / 1000).toFixed(1)}K` : profitPerHour.toFixed(0)} cr/h
                </span>
              </div>
              <div className="dd-stat">
                <span className="dd-key">Consumption Share</span>
                <span className="dd-val">
                  {consumptionSharePct === Infinity ? "—" : `${consumptionSharePct.toFixed(1)}%`}
                </span>
              </div>
            </div>
          </div>

          <div className="drilldown-section" style={{ borderBottom: "none" }}>
            <div className="drilldown-label">Forecast</div>
            <div className="drilldown-grid" style={{ gridTemplateColumns: "1fr" }}>
              <div className="dd-stat">
                <span className="dd-key">Coverage</span>
                <span className="dd-val" style={{ color: totalCoverage >= 1 ? "var(--accent-green)" : totalCoverage >= 0.5 ? "var(--accent-yellow, #ffcc00)" : "var(--accent-red)" }}>
                  {(totalCoverage * 100).toFixed(0)}%
                </span>
              </div>
              <div className="dd-stat">
                <span className="dd-key">Depletes In</span>
                <span className="dd-val" style={{ color: hoursToDepletion ? "var(--accent-red)" : "var(--text-dim)" }}>
                  {hoursToDepletion
                    ? `~${hoursToDepletion < 1 ? `${(hoursToDepletion * 60).toFixed(0)}m` : `${hoursToDepletion.toFixed(1)}h`}`
                    : "Stable"
                  }
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Likely Outcome (footer) ── */}
        <div style={{ padding: "8px 16px 14px" }}>
          <div className="route-outcome-notice" style={{
            padding: "8px 12px",
            borderRadius: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.04em",
            background: totalCoverage >= 1
              ? "color-mix(in srgb, var(--accent-green) 6%, transparent)"
              : hoursToDepletion
                ? "color-mix(in srgb, var(--accent-red) 8%, transparent)"
                : "var(--bg-card)",
            border: `1px solid ${totalCoverage >= 1 ? "color-mix(in srgb, var(--accent-green) 15%, transparent)" : hoursToDepletion ? "color-mix(in srgb, var(--accent-red) 15%, transparent)" : "var(--border)"}`,
            color: totalCoverage >= 1 ? "var(--accent-green)" : hoursToDepletion ? "var(--accent-red)" : "var(--text-secondary)",
          }}>
            {likelyOutcome}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Commodity Detail Sidebar ──

function CommoditySidebar({
  commodity,
  planetName,
  planetId,
  allPlanets,
  routes,
  disruptions,
  historyResponse,
  chartLoading,
  filterMinutes,
  onFilterChange,
  onClose,
}: {
  commodity: AdminCommodityState;
  planetName: string;
  planetId: string;
  allPlanets: AdminPlanetMarketState[];
  routes: NpcTradeRoute[];
  disruptions: AdminDisruptionView[];
  historyResponse: EnrichedPriceHistoryResponse | null;
  chartLoading: boolean;
  filterMinutes: number;
  onFilterChange: (m: number) => void;
  onClose: () => void;
}) {
  const [drillDownPoint, setDrillDownPoint] = useState<EnrichedPriceHistoryPoint | null>(null);
  const [drillDownPrev, setDrillDownPrev] = useState<EnrichedPriceHistoryPoint | null>(null);
  const [copied, setCopied] = useState(false);
  const [chartMode, setChartMode] = useState<ChartMode>("candle");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    crossPlanet: true,
    tradeRoutes: true,
    priceChanges: true,
    tradeEvents: true,
  });
  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const priceRatio = commodity.currentPrice / commodity.basePrice;
  const priceColor =
    priceRatio < 0.85
      ? "var(--accent-green)"
      : priceRatio > 1.15
        ? "var(--accent-red)"
        : "var(--text-primary)";

  // Calculate net flow (production - consumption)
  const netFlow = commodity.production - commodity.consumption;
  const netFlowLabel = netFlow > 0 ? "SURPLUS" : netFlow < 0 ? "DEFICIT" : "BALANCED";
  const netFlowColor = netFlow > 1 ? "var(--accent-green)" : netFlow < -1 ? "var(--accent-red)" : "var(--text-secondary)";

  // Related trade routes (involving this commodity + this planet)
  const relatedRoutes = routes.filter(
    (r) =>
      r.commodityId === commodity.commodityId &&
      (r.sourcePlanet === planetId || r.destPlanet === planetId),
  );

  // Active disruptions affecting this commodity at this planet
  const relatedDisruptions = disruptions.filter(
    (d) =>
      d.planetId === planetId &&
      (!d.commodityId || d.commodityId === commodity.commodityId),
  );

  // Cross-planet prices for the same commodity
  const crossPlanetPrices = allPlanets
    .map((p) => {
      const c = p.commodities.find(
        (c) => c.commodityId === commodity.commodityId,
      );
      return c
        ? {
            planetId: p.planetId,
            name: p.name,
            price: c.currentPrice,
            fill: c.fillRatio,
            production: c.production,
            consumption: c.consumption,
          }
        : null;
    })
    .filter(Boolean) as {
    planetId: string;
    name: string;
    price: number;
    fill: number;
    production: number;
    consumption: number;
  }[];

  // ── Health Status Indicator ──
  const healthStatus = computeHealthStatus(commodity, planetId, planetName, allPlanets, routes, disruptions);

  // Aggregate trade events from enriched history
  const allTradeEvents: NpcTradeEvent[] = historyResponse
    ? historyResponse.points.flatMap((p) => p.tradeEvents || [])
    : [];
  const seenIds = new Set<string>();
  const uniqueTradeEvents = allTradeEvents.filter((e) => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  }).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);

  // ── Copy all sidebar data as formatted text ──
  const handleCopy = useCallback(() => {
    const lines: string[] = [];
    const ts = new Date().toLocaleString();
    lines.push(`═══ ${commodity.name} @ ${planetName} ═══`);
    lines.push(`Snapshot: ${ts}`);
    lines.push(`Health: ${healthStatus.icon} ${healthStatus.label}`);
    lines.push("");

    lines.push("── Current State ──");
    lines.push(`Price: ${commodity.currentPrice.toFixed(1)} (base: ${commodity.basePrice.toFixed(1)}, ratio: ${priceRatio.toFixed(2)}x)`);
    lines.push(`Fill: ${(commodity.fillRatio * 100).toFixed(1)}% (${commodity.quantity}/${commodity.capacity})`);
    lines.push(`24h Change: ${commodity.priceChange24h > 0 ? "+" : ""}${commodity.priceChange24h.toFixed(1)}%`);
    lines.push(`Production: ${commodity.production > 0 ? `+${commodity.production.toFixed(1)}/tick` : "none"}`);
    lines.push(`Consumption: ${commodity.consumption > 0 ? `-${commodity.consumption.toFixed(1)}/tick` : "none"}`);
    lines.push(`Net Flow: ${netFlow > 0 ? "+" : ""}${netFlow.toFixed(1)}/tick (${netFlowLabel})`);
    lines.push("");

    lines.push("── Cross-Planet Prices ──");
    const cpSorted = [...crossPlanetPrices].sort((a, b) => a.price - b.price);
    for (const cp of cpSorted) {
      const marker = cp.planetId === planetId ? " ◄ current" : "";
      lines.push(`  ${cp.name}: ${cp.price.toFixed(1)} (fill ${(cp.fill * 100).toFixed(0)}%, prod ${cp.production > 0 ? `+${cp.production.toFixed(1)}` : "---"}, cons ${cp.consumption > 0 ? `-${cp.consumption.toFixed(1)}` : "---"})${marker}`);
    }
    if (cpSorted.length >= 2) {
      const cpCheap = cpSorted[0]!;
      const cpExp = cpSorted[cpSorted.length - 1]!;
      const cpSpread = cpExp.price - cpCheap.price;
      const cpSpreadPct = cpCheap.price > 0 ? (cpSpread / cpCheap.price) * 100 : 0;
      const cpCheapQty = cpCheap.fill * commodity.capacity;
      const cpMaxProfit = cpSpread * cpCheapQty;
      lines.push(`  Spread: ${cpSpread.toFixed(1)} (${cpSpreadPct.toFixed(0)}%)`);
      lines.push(`  Max Arbitrage: Buy ${cpCheap.name} (${Math.round(cpCheapQty)}u @ ${cpCheap.price.toFixed(1)}) → Sell ${cpExp.name} (@ ${cpExp.price.toFixed(1)}) = ${cpMaxProfit >= 1000 ? `${(cpMaxProfit / 1000).toFixed(1)}K` : cpMaxProfit.toFixed(0)} cr profit`);
    }
    lines.push("");

    lines.push("── Trade Routes (this commodity + planet) ──");
    if (relatedRoutes.length === 0) {
      lines.push("  No active routes.");
    } else {
      for (const r of relatedRoutes) {
        const dir = r.sourcePlanet === planetId ? `${planetName} → ${r.destPlanet}` : `${r.sourcePlanet} → ${planetName}`;
        const role = r.sourcePlanet === planetId ? "EXPORTING" : "IMPORTING";
        lines.push(`  ${role}: ${dir} | ${Math.round(r.volumePerTrip)}u/trip | ${Math.round(r.tripDurationMs / 60_000)}m trip | ${r.inTransit ? "IN TRANSIT" : "IDLE"}${!r.enabled ? " [PAUSED]" : ""}`);
      }
    }
    lines.push("");

    if (relatedDisruptions.length > 0) {
      lines.push("── Active Disruptions ──");
      for (const d of relatedDisruptions) {
        lines.push(`  ${d.type.replace(/_/g, " ")} | ${d.commodityId || "all commodities"} | ${formatDuration(d.remainingMs)} remaining${d.multiplier ? ` | ${d.multiplier}x` : ""}`);
      }
      lines.push("");
    }

    if (historyResponse && historyResponse.points.length > 1) {
      const pts = historyResponse.points;
      const prices = pts.map((p) => p.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      const totalChange = ((last.price - first.price) / first.price) * 100;
      lines.push("── Price History (24h summary) ──");
      lines.push(`  Range: ${minPrice.toFixed(1)} – ${maxPrice.toFixed(1)}`);
      lines.push(`  Trend: ${first.price.toFixed(1)} → ${last.price.toFixed(1)} (${totalChange > 0 ? "+" : ""}${totalChange.toFixed(2)}%)`);
      lines.push(`  Points: ${pts.length}`);
      lines.push("");

      lines.push("── Recent Price Changes ──");
      const recent = [...pts].reverse().slice(0, 10);
      for (let i = 0; i < recent.length; i++) {
        const p = recent[i]!;
        const prev = i < recent.length - 1 ? recent[i + 1] : null;
        const chg = prev ? ((p.price - prev.price) / prev.price) * 100 : 0;
        const isLive = p.timestamp > historyResponse.warmupCompletedAt;
        lines.push(`  ${formatTime(p.timestamp)} | ${isLive ? "LIVE" : "SEED"} | ${p.price.toFixed(1)} | ${chg > 0 ? "+" : ""}${chg.toFixed(2)}% | fill ${(p.fillRatio * 100).toFixed(0)}%`);
      }
    }

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [commodity, planetName, planetId, priceRatio, netFlow, netFlowLabel, crossPlanetPrices, relatedRoutes, relatedDisruptions, historyResponse, healthStatus]);

  return (
    <div className="commodity-sidebar">
      {/* ── Header ── */}
      <div className="sidebar-header">
        <h3>
          <span style={{ fontSize: 16 }}>{commodity.icon}</span>
          {commodity.name}
          <span className="text-dim" style={{ fontSize: 10 }}>
            @ {planetName}
          </span>
        </h3>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className="sidebar-copy"
            onClick={handleCopy}
            title="Copy all data to clipboard"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "COPIED" : "COPY"}
          </button>
          <button className="sidebar-close" onClick={onClose}>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── Health Status Badge ── */}
      <div className="health-badge-row" style={{ background: healthStatus.bg }}>
        <span
          className="health-badge"
          style={{ color: healthStatus.color, borderColor: healthStatus.color }}
        >
          {healthStatus.icon} {healthStatus.label}
        </span>
        <span className="health-desc">{healthStatus.description}</span>
        <HelpTip text={`Economy health — pure supply/demand (no artificial stabilization):\n\n⛔ HALTED = stock is 0, trade frozen, price at maximum\n⚠ ORPHAN = no planet produces this commodity — player-only\n🚫 NO SUPPLY = produced elsewhere but no route here — will drain to 0\n📉 UNDERSUPPLIED = has supply but can't keep up with consumption\n⚡ DISRUPTED = active disruption event\n📦 OVERSUPPLIED = stock piling up, prices depressed\n💎 EXPORT OPP = surplus with no outbound route — profit opportunity\n✓ BALANCED = healthy supply/demand equilibrium`} />
      </div>

      {/* ── Stats grid ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Current State</div>
        <div className="commodity-stats">
          <div className="commodity-stat">
            <div className="cs-label">
              Price
              <HelpTip text={`${commodity.name} currently costs ${commodity.currentPrice.toFixed(1)} cr per unit at ${planetName}. Price is driven by a sigmoid curve tied to inventory: when stock is low, price rises sharply; when stock is high, price drops. At ${(commodity.fillRatio * 100).toFixed(0)}% fill, the price sits at ${priceRatio.toFixed(2)}x the base price.`} />
            </div>
            <div className="cs-value" style={{ color: priceColor }}>
              {commodity.currentPrice.toFixed(1)}
            </div>
          </div>
          <div className="commodity-stat">
            <div className="cs-label">
              Base Price
              <HelpTip text={`The galactic equilibrium price (${commodity.basePrice.toFixed(1)} cr) is what ${commodity.name} costs when a planet's inventory is exactly 50% full. Below 50% fill → price above base. Above 50% → price below base. Current ratio: ${priceRatio.toFixed(2)}x base.`} />
            </div>
            <div className="cs-value" style={{ color: "var(--text-secondary)" }}>
              {commodity.basePrice.toFixed(1)}
            </div>
          </div>
          <div className="commodity-stat">
            <div className="cs-label">
              Fill
              <HelpTip text={`${planetName} has ${commodity.quantity} of ${commodity.capacity} units of ${commodity.name} in stock (${(commodity.fillRatio * 100).toFixed(1)}% full). 50% is equilibrium. At ${(commodity.fillRatio * 100).toFixed(0)}%, the station is ${commodity.fillRatio < 0.5 ? "undersupplied — prices are above base" : "oversupplied — prices are below base"}. Every tick (60s), production adds stock and consumption drains it.`} />
            </div>
            <div className="cs-value">
              {(commodity.fillRatio * 100).toFixed(0)}%
              <span
                className="text-dim"
                style={{ fontSize: 10, marginLeft: 4 }}
              >
                {commodity.quantity}/{commodity.capacity}
              </span>
            </div>
          </div>
          <div className="commodity-stat">
            <div className="cs-label">
              24h Change
              <HelpTip text={`The price of ${commodity.name} has ${commodity.priceChange24h > 0 ? "increased" : "decreased"} by ${Math.abs(commodity.priceChange24h).toFixed(1)}% over the last 24 hours. This reflects all forces: NPC production/consumption, trade route deliveries, disruptions, and the natural mean-reversion drift that pushes prices back toward base.`} />
            </div>
            <div
              className="cs-value"
              style={{
                color:
                  commodity.priceChange24h > 2
                    ? "var(--accent-green)"
                    : commodity.priceChange24h < -2
                      ? "var(--accent-red)"
                      : "var(--text-secondary)",
              }}
            >
              {commodity.priceChange24h > 0 ? "+" : ""}
              {commodity.priceChange24h.toFixed(1)}%
            </div>
          </div>
          <div className="commodity-stat">
            <div className="cs-label">
              Production
              <HelpTip text={commodity.production > 0 ? `NPC factories at ${planetName} produce +${commodity.production.toFixed(1)} units of ${commodity.name} every tick (60 seconds). This adds stock, increases fill ratio, and pushes the price down over time.` : `${planetName} does not produce ${commodity.name}. This station relies entirely on NPC trade routes importing from other planets to replenish stock. Without imports, consumption will drain inventory to zero.`} />
            </div>
            <div className="cs-value text-green">
              {commodity.production > 0
                ? `+${commodity.production.toFixed(1)}`
                : "---"}
            </div>
          </div>
          <div className="commodity-stat">
            <div className="cs-label">
              Consumption
              <HelpTip text={commodity.consumption > 0 ? `NPC demand at ${planetName} consumes ${commodity.consumption.toFixed(1)} units of ${commodity.name} every tick (60 seconds). This drains stock, lowers fill ratio, and pushes the price up. At the current rate, the station will ${commodity.production > 0 ? `${netFlow > 0 ? "still gain stock (production exceeds consumption)" : `run out in roughly ${Math.round(commodity.quantity / commodity.consumption)} ticks (~${Math.round(commodity.quantity / commodity.consumption / 60)}h) without trade imports`}` : `run out in roughly ${Math.round(commodity.quantity / commodity.consumption)} ticks (~${Math.round(commodity.quantity / commodity.consumption / 60)}h) without trade imports`}.` : `No NPC consumption of ${commodity.name} at ${planetName}. The station acts as a storage or transit point only.`} />
            </div>
            <div className="cs-value text-red">
              {commodity.consumption > 0
                ? `-${commodity.consumption.toFixed(1)}`
                : "---"}
            </div>
          </div>
        </div>
        {/* ── Economy Balance Score ── */}
        <div className="balance-score" style={{ marginTop: 8 }}>
          <div className="balance-bar">
            <div className="balance-label">
              <Activity size={10} style={{ marginRight: 4 }} />
              NET FLOW
              <HelpTip text={`Net flow = production (${commodity.production > 0 ? `+${commodity.production.toFixed(1)}` : "0"}) minus consumption (${commodity.consumption > 0 ? commodity.consumption.toFixed(1) : "0"}) = ${netFlow > 0 ? "+" : ""}${netFlow.toFixed(1)} units/tick. One tick = 60 real seconds. ${netFlow < 0 ? `DEFICIT means ${planetName} is bleeding ${Math.abs(netFlow).toFixed(1)} units of ${commodity.name} every minute. Without trade imports, inventory will drain completely.` : netFlow > 0 ? `SURPLUS means ${planetName} gains ${netFlow.toFixed(1)} units every minute. Stock is building and prices should drift downward.` : `BALANCED means supply exactly matches demand. Price will fluctuate from noise and trade events only.`}`} />
            </div>
            <div className="balance-value" style={{ color: netFlowColor }}>
              {netFlow > 0 ? "+" : ""}{netFlow.toFixed(1)}/tick
              <span className="balance-tag" style={{ background: netFlowColor + "18", color: netFlowColor }}>
                {netFlowLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Cross-Planet Prices ── */}
      {crossPlanetPrices.length > 1 && (() => {
        const sorted = [...crossPlanetPrices].sort((a, b) => a.price - b.price);
        const cheapest = sorted[0]!;
        const expensive = sorted[sorted.length - 1]!;
        const spread = expensive.price - cheapest.price;
        const spreadPct = cheapest.price > 0 ? (spread / cheapest.price) * 100 : 0;
        // Arbitrage: buy all cheap inventory, sell at most expensive
        // cheapest quantity = fill × capacity (we approximate from fillRatio × commodity.capacity)
        const cheapQty = cheapest.fill * commodity.capacity;
        const maxProfit = spread * cheapQty;
        return (
          <div className="sidebar-section">
            <div className="sidebar-section-label sidebar-section-toggle" onClick={() => toggleSection("crossPlanet")}>
              <span>
                <ChevronRight size={10} className={`collapse-arrow${collapsed.crossPlanet ? "" : " open"}`} />
                <ArrowRightLeft size={10} style={{ marginRight: 4 }} />Cross-Planet Prices
                <HelpTip text={`Shows the current price of ${commodity.name} on every planet in the region, sorted cheapest to most expensive. The cheapest planet (${cheapest.name} at ${cheapest.price.toFixed(1)} cr) has the most stock (${(cheapest.fill * 100).toFixed(0)}% fill). The most expensive (${expensive.name} at ${expensive.price.toFixed(1)} cr) has the least (${(expensive.fill * 100).toFixed(0)}% fill). The +value column shows how much more expensive each planet is compared to the cheapest. "LOW" marks the best buy price in the system.`} />
              </span>
            </div>
            {!collapsed.crossPlanet && <><div className="cross-planet-list">
              {sorted.map((cp) => {
                  const isCurrent = cp.planetId === planetId;
                  const priceDiff = cp.price - cheapest.price;
                  return (
                    <div
                      key={cp.planetId}
                      className={`cross-planet-row ${isCurrent ? "current" : ""}`}
                    >
                      <span className="cp-name">{cp.name}</span>
                      <span className="cp-price">{cp.price.toFixed(1)}</span>
                      <span className="cp-fill">{(cp.fill * 100).toFixed(0)}%</span>
                      <span className="cp-diff" style={{
                        color: priceDiff === 0 ? "var(--accent-green)" : "var(--text-dim)",
                      }}>
                        {priceDiff === 0 ? "LOW" : `+${priceDiff.toFixed(1)}`}
                      </span>
                    </div>
                  );
                })}
            </div>
            {spread > 1 && (
              <div className="arbitrage-summary">
                <div className="arb-row">
                  <span className="arb-label">
                    Spread
                    <HelpTip text={`The price gap between the cheapest planet (${cheapest.name}: ${cheapest.price.toFixed(1)} cr) and the most expensive (${expensive.name}: ${expensive.price.toFixed(1)} cr) is ${spread.toFixed(1)} cr per unit (${spreadPct.toFixed(0)}%). This spread is the arbitrage opportunity — the profit margin a trader earns per unit by buying low and selling high. Larger spreads attract more NPC/player trades, which narrows the gap over time.`} />
                  </span>
                  <span className="arb-value">
                    {spread.toFixed(1)} <span className="text-dim">({spreadPct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="arb-row">
                  <span className="arb-label">
                    Buy {cheapest.name} → Sell {expensive.name}
                    <HelpTip text={`If a player bought ALL ${Math.round(cheapQty)} units available at ${cheapest.name} (${cheapest.price.toFixed(1)} cr each) and sold them at ${expensive.name} (${expensive.price.toFixed(1)} cr), the total profit would be ${maxProfit >= 1000 ? `${(maxProfit / 1000).toFixed(1)}K` : maxProfit.toFixed(0)} cr. In practice, buying large quantities would drain ${cheapest.name}'s stock (raising its price) and flood ${expensive.name} (dropping its price), so the actual profit would be lower. This is the max theoretical inflation the economy is generating through this spread.`} />
                  </span>
                  <span className="arb-value arb-profit">
                    {maxProfit >= 1000 ? `${(maxProfit / 1000).toFixed(1)}K` : maxProfit.toFixed(0)} cr
                  </span>
                </div>
                <div className="arb-row arb-note">
                  <span className="text-dim">
                    {Math.round(cheapQty)}u available @ {cheapest.price.toFixed(1)} → {expensive.price.toFixed(1)}
                  </span>
                </div>
              </div>
            )}
          </>}
          </div>
        );
      })()}

      {/* ── Related Trade Routes ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label sidebar-section-toggle" onClick={() => toggleSection("tradeRoutes")}>
          <span>
            <ChevronRight size={10} className={`collapse-arrow${collapsed.tradeRoutes ? "" : " open"}`} />
            <Truck size={10} style={{ marginRight: 4 }} />Trade Routes
            <HelpTip text={`Permanent NPC hauler routes that ship ${commodity.name} to or from ${planetName}. These are generated at simulation startup based on which planets produce vs. consume each commodity. EXP = this planet exports (ships out). IMP = this planet imports (receives). Volume = units per trip. TRANSIT = NPC currently en route with cargo. IDLE = NPC waiting for profitable margin (>15%) before departing. ${relatedRoutes.length === 0 ? `No routes exist because no planet in the region produces ${commodity.name} for ${planetName}, or vice versa.` : `${relatedRoutes.length} route(s) serve this commodity here.`}`} />
          </span>
          <span style={{ float: "right", color: "var(--text-dim)" }}>
            {relatedRoutes.length} route{relatedRoutes.length !== 1 ? "s" : ""}
          </span>
        </div>
        {!collapsed.tradeRoutes && (relatedRoutes.length === 0 ? (
          <div className="sidebar-empty" style={{ padding: "10px 0" }}>
            No NPC trade routes for {commodity.name} at {planetName}.
          </div>
        ) : (
          <div className="trade-route-list">
            {relatedRoutes.map((r) => {
              const isExport = r.sourcePlanet === planetId;
              return (
                <div key={r.id} className="trade-route-row">
                  <span className={`tr-role ${isExport ? "export" : "import"}`}>
                    {isExport ? "EXP" : "IMP"}
                  </span>
                  <span className="tr-path">
                    {isExport
                      ? `→ ${r.destPlanet}`
                      : `← ${r.sourcePlanet}`}
                  </span>
                  <span className="tr-vol">{Math.round(r.volumePerTrip)}u</span>
                  <span className="tr-trip">{Math.round(r.tripDurationMs / 60_000)}m</span>
                  <span className={`tr-status ${r.inTransit ? "active" : ""}`}>
                    {r.inTransit ? "TRANSIT" : "IDLE"}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Active Disruptions ── */}
      {relatedDisruptions.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-label">
            <span><AlertTriangle size={10} style={{ marginRight: 4, color: "var(--accent-yellow)" }} />Active Disruptions</span>
          </div>
          <div className="disruption-list">
            {relatedDisruptions.map((d) => (
              <div key={d.id} className="disruption-row">
                <span className="disrupt-type">{d.type.replace(/_/g, " ")}</span>
                <span className="disrupt-remaining">{formatDuration(d.remainingMs)}</span>
                {d.multiplier && <span className="disrupt-mult">{d.multiplier.toFixed(1)}x</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Price + Fill Ratio chart ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">
          <span>
            Price + Fill History
            <HelpTip text={chartMode === "candle"
              ? `OHLC candles = hourly Open/High/Low/Close price (left axis). Green candle = price rose that hour, red = fell. Wick shows high-low range. Blue line = fill % (right axis, 0-100%). Dimmed candles = warmup data (simulated 24h at startup). Bright = live data. Glow behind candle = NPC trade event (yellow = disruption). Y-axis is padded so small oscillations don't fill the chart.`
              : `Line chart shows raw price points over the last 4 hours. Green = live data, dashed = warmup. Blue line = fill %. Dots = trade events (blue) or disruptions (yellow). Y-axis is padded for context.`
            } />
          </span>
          <span className="chart-mode-toggle">
            <button
              className={`chart-mode-chip ${chartMode === "candle" ? "active" : ""}`}
              onClick={() => setChartMode("candle")}
            >24H</button>
            <button
              className={`chart-mode-chip ${chartMode === "line" ? "active" : ""}`}
              onClick={() => setChartMode("line")}
            >4H</button>
          </span>
        </div>
        {chartLoading ? (
          <div className="sidebar-empty">Loading chart data...</div>
        ) : historyResponse && historyResponse.points.length >= 2 ? (
          (() => {
            // Filter to last 4h for line mode
            const chartData = chartMode === "line"
              ? (() => {
                  const cutoff = Date.now() - 4 * 3600_000;
                  const filtered = historyResponse.points.filter(p => p.timestamp >= cutoff);
                  // Need at least 2 points; fall back to full data if too few
                  return filtered.length >= 2 ? filtered : historyResponse.points;
                })()
              : historyResponse.points;

            return (
              <div>
                <div className="chart-container">
                  <DualAxisPriceChart
                    data={chartData}
                    warmupCompletedAt={historyResponse.warmupCompletedAt}
                    mode={chartMode}
                  />
                </div>
                <div className="chart-legend">
                  {chartMode === "candle" ? (
                    <>
                      <div className="legend-item">
                        <span className="legend-candle up" />
                        UP
                      </div>
                      <div className="legend-item">
                        <span className="legend-candle down" />
                        DOWN
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="legend-item">
                        <span className="legend-line live" />
                        PRICE
                      </div>
                    </>
                  )}
                  <div className="legend-item">
                    <span className="legend-line warmup" />
                    WARMUP
                  </div>
                  <div className="legend-item">
                    <span className="legend-line fill-ratio" />
                    FILL %
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <div className="sidebar-empty">
            No price history available yet.
            <br />
            Data appears after warmup or first ticks.
          </div>
        )}
      </div>

      {/* ── Price change log (clickable) ── */}
      <div className="sidebar-section" style={{ paddingBottom: collapsed.priceChanges ? undefined : 8 }}>
        <div className="sidebar-section-label sidebar-section-toggle" onClick={() => toggleSection("priceChanges")}>
          <span>
            <ChevronRight size={10} className={`collapse-arrow${collapsed.priceChanges ? "" : " open"}`} />
            Price Changes
          </span>
          {historyResponse && historyResponse.points.length > 0 && (
            <span style={{ float: "right", color: "var(--text-dim)" }}>
              {historyResponse.points.length} pts
            </span>
          )}
        </div>
        {!collapsed.priceChanges && (historyResponse && historyResponse.points.length > 0 ? (
          <PriceChangeLogContent
            points={historyResponse.points}
            warmupCompletedAt={historyResponse.warmupCompletedAt}
            filterMinutes={filterMinutes}
            onFilterChange={onFilterChange}
            onDrillDown={(point, prev) => {
              setDrillDownPoint(point);
              setDrillDownPrev(prev);
            }}
          />
        ) : (
          <div className="sidebar-empty">No data</div>
        ))}
      </div>

      {/* ── Trade event feed ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label sidebar-section-toggle" onClick={() => toggleSection("tradeEvents")}>
          <span>
            <ChevronRight size={10} className={`collapse-arrow${collapsed.tradeEvents ? "" : " open"}`} />
            <Truck size={10} style={{ marginRight: 4 }} />NPC Trade Events
          </span>
          <span style={{ float: "right", color: "var(--text-dim)" }}>
            {uniqueTradeEvents.length} recent
          </span>
        </div>
        {!collapsed.tradeEvents && (uniqueTradeEvents.length === 0 ? (
          <div className="sidebar-empty" style={{ padding: "14px 0" }}>
            No trade events recorded yet.
            <br />
            Events appear after worker deployment.
          </div>
        ) : (
          <div className="trade-event-feed">
            {uniqueTradeEvents.map((event) => (
              <TradeEventRow key={event.id} event={event} />
            ))}
          </div>
        ))}
      </div>

      {/* ── Drill-down modal ── */}
      {drillDownPoint && (
        <PriceDrillDownModal
          point={drillDownPoint}
          prevPoint={drillDownPrev}
          planetName={planetName}
          planetId={planetId}
          commodityName={commodity.name}
          relatedRoutes={relatedRoutes}
          relatedDisruptions={relatedDisruptions}
          crossPlanetPrices={crossPlanetPrices}
          onClose={() => { setDrillDownPoint(null); setDrillDownPrev(null); }}
        />
      )}
    </div>
  );
}

// ── OHLC Bucket for candle aggregation ──

interface OHLCBucket {
  open: number;
  high: number;
  low: number;
  close: number;
  avgFill: number;
  timestamp: number;
  count: number;
  isWarmup: boolean;
  hasEvents: boolean;
  hasDisruptions: boolean;
}

/** Aggregate raw price points into hourly OHLC candle buckets. */
function aggregateToOHLC(
  data: EnrichedPriceHistoryPoint[],
  warmupCompletedAt: number,
): OHLCBucket[] {
  if (data.length === 0) return [];

  const BUCKET_MS = 60 * 60_000; // 1 hour
  const buckets: OHLCBucket[] = [];
  const first = data[0]!;

  let bucketStart = Math.floor(first.timestamp / BUCKET_MS) * BUCKET_MS;
  let bucket: OHLCBucket = {
    open: first.price, high: first.price,
    low: first.price, close: first.price,
    avgFill: 0, timestamp: bucketStart, count: 0,
    isWarmup: first.timestamp <= warmupCompletedAt,
    hasEvents: false, hasDisruptions: false,
  };
  let fillSum = 0;

  for (const pt of data) {
    const ptBucket = Math.floor(pt.timestamp / BUCKET_MS) * BUCKET_MS;

    if (ptBucket !== bucketStart) {
      bucket.avgFill = bucket.count > 0 ? fillSum / bucket.count : 0;
      buckets.push(bucket);

      bucketStart = ptBucket;
      bucket = {
        open: pt.price, high: pt.price,
        low: pt.price, close: pt.price,
        avgFill: 0, timestamp: ptBucket, count: 0,
        isWarmup: pt.timestamp <= warmupCompletedAt,
        hasEvents: false, hasDisruptions: false,
      };
      fillSum = 0;
    }

    bucket.high = Math.max(bucket.high, pt.price);
    bucket.low = Math.min(bucket.low, pt.price);
    bucket.close = pt.price;
    bucket.count++;
    fillSum += pt.fillRatio;
    if ((pt.tradeEvents?.length || 0) > 0) bucket.hasEvents = true;
    if ((pt.activeDisruptions?.length || 0) > 0) bucket.hasDisruptions = true;
    // Once any live data enters the bucket, mark it live
    if (pt.timestamp > warmupCompletedAt) bucket.isWarmup = false;
  }

  bucket.avgFill = bucket.count > 0 ? fillSum / bucket.count : 0;
  buckets.push(bucket);

  return buckets;
}

// ── Dual-Axis Price + Fill Ratio Chart ──
// mode="candle" → OHLC candles (24h aggregated), mode="line" → raw line (4h window).
// Y-axis has padding so small oscillations don't fill the entire chart.

type ChartMode = "candle" | "line";

function DualAxisPriceChart({
  data,
  warmupCompletedAt,
  mode = "candle",
}: {
  data: EnrichedPriceHistoryPoint[];
  warmupCompletedAt: number;
  mode?: ChartMode;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 388;
  const height = 200;
  const pad = { top: 10, right: 42, bottom: 25, left: 48 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  // ── OHLC aggregation ──
  const candles = aggregateToOHLC(data, warmupCompletedAt);
  const useCandles = mode === "candle" && candles.length >= 3;

  // ── Y-axis scaling with padding ──
  // Problem: auto-scaling to exact data range makes tiny oscillations fill
  // the chart. Fix: ensure minimum range = 20% of mid price, then add 15%
  // padding top and bottom so the data "breathes".
  const allPrices = useCandles
    ? candles.flatMap((c) => [c.high, c.low])
    : data.map((d) => d.price);
  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const rawRange = rawMax - rawMin;
  const midPrice = (rawMin + rawMax) / 2;

  // Floor: range must be at least 20% of the average price
  const minRange = midPrice * 0.2;
  const effectiveRange = Math.max(rawRange, minRange);

  // Add 30% padding (15% each side)
  const maxP = midPrice + effectiveRange * 0.65;
  const minP = Math.max(0, midPrice - effectiveRange * 0.65);
  const range = maxP - minP || 1;

  // Y-coordinate for a price value
  const yPrice = (p: number) => pad.top + ((maxP - p) / range) * chartH;

  // ── Fill ratio line (always 0-100% on right axis) ──
  const fillLinePoints: string[] = [];
  if (useCandles) {
    candles.forEach((c, i) => {
      const x = pad.left + ((i + 0.5) / candles.length) * chartW;
      const y = pad.top + ((1 - c.avgFill) * chartH);
      fillLinePoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
  } else {
    data.forEach((d, i) => {
      const x = pad.left + (i / Math.max(1, data.length - 1)) * chartW;
      const y = pad.top + ((1 - d.fillRatio) * chartH);
      fillLinePoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
  }

  // Fill area path
  const lastFillX = useCandles
    ? pad.left + ((candles.length - 0.5) / candles.length) * chartW
    : pad.left + chartW;
  const fillAreaPath = fillLinePoints.length > 0
    ? `M${fillLinePoints[0]} ${fillLinePoints.slice(1).map((p) => `L${p}`).join(" ")} L${lastFillX.toFixed(1)},${pad.top + chartH} L${pad.left},${pad.top + chartH} Z`
    : "";

  // ── Warmup / live transition ──
  let transitionX: number | null = null;
  if (useCandles) {
    const liveIdx = candles.findIndex((c) => !c.isWarmup);
    if (liveIdx > 0) {
      transitionX = pad.left + (liveIdx / candles.length) * chartW;
    }
  } else {
    // Find last warmup point (polyfill for findLastIndex)
    let ti = -1;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i]!.timestamp <= warmupCompletedAt) { ti = i; break; }
    }
    if (ti >= 0 && ti < data.length - 1) {
      transitionX = pad.left + (ti / Math.max(1, data.length - 1)) * chartW;
    }
  }

  // ── Time labels ──
  const first = data[0]!;
  const last = data[data.length - 1]!;
  const mid = data[Math.floor(data.length / 2)]!;

  // ── Line mode: precompute point positions ──
  const linePts = !useCandles ? data.map((d, i) => ({
    x: pad.left + (i / Math.max(1, data.length - 1)) * chartW,
    y: yPrice(d.price),
    isWarmup: d.timestamp <= warmupCompletedAt,
    hasEvents: (d.tradeEvents?.length || 0) > 0,
    hasDisruptions: (d.activeDisruptions?.length || 0) > 0,
  })) : [];

  // ── Mouse handler: find nearest point, bias toward event dots ──
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (useCandles || linePts.length === 0) return;
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    // Convert mouse position to SVG viewBox coordinates
    const scaleX = width / rect.width;
    const mx = (e.clientX - rect.left) * scaleX;

    // Find nearest event dot within 20px (priority), else nearest point within 12px
    const EVENT_SNAP = 20;
    const LINE_SNAP = 12;

    let bestEvent = -1;
    let bestEventDist = Infinity;
    let bestAny = -1;
    let bestAnyDist = Infinity;

    for (let i = 0; i < linePts.length; i++) {
      const dx = Math.abs(linePts[i]!.x - mx);
      if (dx < bestAnyDist) { bestAnyDist = dx; bestAny = i; }
      if ((linePts[i]!.hasEvents || linePts[i]!.hasDisruptions) && dx < bestEventDist) {
        bestEventDist = dx; bestEvent = i;
      }
    }

    // Prefer event dot if close enough, else fall back to nearest line point
    if (bestEvent >= 0 && bestEventDist < EVENT_SNAP) {
      setHoverIdx(bestEvent);
    } else if (bestAny >= 0 && bestAnyDist < LINE_SNAP) {
      setHoverIdx(bestAny);
    } else {
      setHoverIdx(null);
    }
  }, [useCandles, linePts, width]);

  // Hovered data
  const hoverData = hoverIdx !== null ? data[hoverIdx] ?? null : null;
  const hoverPt = hoverIdx !== null ? linePts[hoverIdx] ?? null : null;
  const hoverPrev = hoverIdx !== null && hoverIdx > 0 ? data[hoverIdx - 1] ?? null : null;

  return (
    <div style={{ position: "relative" }}>
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ display: "block", width: "100%" }}
      viewBox={`0 0 ${width} ${height}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {/* Price grid lines (left axis) */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const y = pad.top + pct * chartH;
        const price = maxP - pct * range;
        return (
          <g key={pct}>
            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y}
              stroke="var(--border)" strokeWidth={0.5} />
            <text x={pad.left - 6} y={y + 3} textAnchor="end"
              fill="var(--text-dim)" fontSize={9} fontFamily="var(--font-mono)">
              {price.toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Fill ratio right axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const y = pad.top + (1 - pct) * chartH;
        return (
          <text key={`fill-${pct}`} x={width - pad.right + 6} y={y + 3}
            textAnchor="start" fill="var(--accent-blue)" fontSize={8}
            fontFamily="var(--font-mono)" opacity={0.5}>
            {(pct * 100).toFixed(0)}%
          </text>
        );
      })}

      {/* Fill ratio area (subtle blue) */}
      {fillAreaPath && (
        <path d={fillAreaPath} fill="var(--accent-blue)" opacity={0.06} />
      )}

      {/* Fill ratio line */}
      {fillLinePoints.length >= 2 && (
        <polyline points={fillLinePoints.join(" ")}
          fill="none" stroke="var(--accent-blue)" strokeWidth={1}
          strokeLinecap="round" strokeLinejoin="round" opacity={0.35} />
      )}

      {/* Warmup/live transition line */}
      {transitionX !== null && (
        <>
          <line x1={transitionX} y1={pad.top} x2={transitionX} y2={pad.top + chartH}
            stroke="var(--accent-yellow)" strokeWidth={0.8} strokeDasharray="3,3" opacity={0.5} />
          <text x={transitionX} y={pad.top - 2} textAnchor="middle"
            fill="var(--accent-yellow)" fontSize={7} fontFamily="var(--font-mono)" opacity={0.7}>
            LIVE
          </text>
        </>
      )}

      {/* ── OHLC Candles (24h aggregated view) ── */}
      {useCandles && candles.map((c, i) => {
        const candleW = Math.max(4, (chartW / candles.length) * 0.55);
        const x = pad.left + ((i + 0.5) / candles.length) * chartW;
        const isUp = c.close >= c.open;
        const color = isUp ? "var(--accent-green)" : "var(--accent-red)";
        const opacity = c.isWarmup ? 0.35 : 0.85;

        const bodyTop = yPrice(Math.max(c.open, c.close));
        const bodyBot = yPrice(Math.min(c.open, c.close));
        const bodyH = Math.max(1.5, bodyBot - bodyTop);

        const wickTop = yPrice(c.high);
        const wickBot = yPrice(c.low);

        // Event dot sits behind the candle at body midpoint
        const bodyMid = bodyTop + bodyH / 2;

        return (
          <g key={i} opacity={opacity}>
            {/* Trade event glow (behind candle) */}
            {c.hasEvents && (
              <circle cx={x} cy={bodyMid} r={candleW * 0.8}
                fill={c.hasDisruptions ? "var(--accent-yellow)" : "var(--accent-blue)"}
                opacity={0.25} />
            )}
            {/* Wick (high-low range) */}
            <line x1={x} y1={wickTop} x2={x} y2={wickBot}
              stroke={color} strokeWidth={1} />
            {/* Body (open-close) */}
            <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH}
              fill={color} stroke={color} strokeWidth={0.5} rx={0.5} />
          </g>
        );
      })}

      {/* ── Line chart (4h view or fallback) ── */}
      {!useCandles && (() => {
        const warmupPts: string[] = [];
        const livePts: string[] = [];
        let transIdx = -1;

        linePts.forEach((p, i) => {
          const pt = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          if (p.isWarmup) {
            warmupPts.push(pt);
            transIdx = i;
          } else {
            livePts.push(pt);
          }
        });

        // Bridge for line continuity
        if (transIdx >= 0 && livePts.length > 0) {
          const p = linePts[transIdx]!;
          livePts.unshift(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        }

        return (
          <>
            {warmupPts.length >= 2 && (
              <polyline points={warmupPts.join(" ")} fill="none"
                stroke="var(--text-dim)" strokeWidth={1.2} strokeDasharray="4,3"
                strokeLinecap="round" strokeLinejoin="round" opacity={0.45} />
            )}
            {livePts.length >= 2 && (
              <polyline points={livePts.join(" ")} fill="none"
                stroke="var(--accent-green)" strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" />
            )}
            {/* Fallback: all same segment */}
            {warmupPts.length < 2 && livePts.length < 2 && data.length >= 2 && (() => {
              const lastPt = data[data.length - 1]!;
              const isLive = lastPt.timestamp > warmupCompletedAt;
              return (
                <polyline points={linePts.map((p) =>
                  `${p.x.toFixed(1)},${p.y.toFixed(1)}`
                ).join(" ")} fill="none"
                  stroke={isLive ? "var(--accent-green)" : "var(--text-dim)"}
                  strokeWidth={isLive ? 2 : 1.2}
                  strokeDasharray={isLive ? undefined : "4,3"}
                  strokeLinecap="round" strokeLinejoin="round"
                  opacity={isLive ? 1 : 0.45} />
              );
            })()}

            {/* Visible event dots (blue = trade, yellow = disruption) */}
            {linePts.map((p, i) => {
              if (!p.hasEvents && !p.hasDisruptions) return null;
              return (
                <circle key={`dot-${i}`} cx={p.x} cy={p.y}
                  r={hoverIdx === i ? 5 : 3.5}
                  fill={p.hasDisruptions ? "var(--accent-yellow)" : "var(--accent-blue)"}
                  opacity={hoverIdx === i ? 1 : 0.7} />
              );
            })}

            {/* Hover crosshair + ring */}
            {hoverPt && (
              <>
                <line x1={hoverPt.x} y1={pad.top} x2={hoverPt.x} y2={pad.top + chartH}
                  stroke="var(--text-dim)" strokeWidth={0.5} opacity={0.3} />
                <circle cx={hoverPt.x} cy={hoverPt.y} r={4}
                  fill="none" stroke="var(--accent-green)" strokeWidth={1.5} />
              </>
            )}
          </>
        );
      })()}

      {/* Time labels */}
      <text x={pad.left} y={height - 4} fill="var(--text-dim)" fontSize={9} fontFamily="var(--font-mono)">
        {formatTime(first.timestamp)}
      </text>
      <text x={pad.left + chartW / 2} y={height - 4} textAnchor="middle"
        fill="var(--text-dim)" fontSize={9} fontFamily="var(--font-mono)">
        {formatTime(mid.timestamp)}
      </text>
      <text x={width - pad.right} y={height - 4} textAnchor="end"
        fill="var(--text-dim)" fontSize={9} fontFamily="var(--font-mono)">
        {formatTime(last.timestamp)}
      </text>
    </svg>

    {/* ── Hover tooltip (rendered OUTSIDE SVG to avoid clipping) ── */}
    {hoverData && hoverPt && !useCandles && (() => {
      const xPct = (hoverPt.x / width) * 100;
      const yPct = (hoverPt.y / height) * 100;
      const tipOnLeft = xPct > 55;

      const events = hoverData.tradeEvents || [];
      const disruptions = hoverData.activeDisruptions || [];
      const deliveries = events.filter(e => e.type === "delivery");
      const departures = events.filter(e => e.type === "departure");

      // Before = previous point, After = this point
      const bPrice = hoverPrev ? hoverPrev.price : null;
      const bFill = hoverPrev ? Math.round(hoverPrev.fillRatio * 100) : null;
      const aPrice = hoverData.price;
      const aFill = Math.round(hoverData.fillRatio * 100);

      return (
        <div className="chart-tooltip" style={{
          position: "absolute",
          top: `${yPct}%`,
          ...(tipOnLeft
            ? { right: `${100 - xPct + 4}%` }
            : { left: `${xPct + 4}%` }),
          transform: "translateY(-50%)",
          pointerEvents: "none",
          zIndex: 10,
        }}>
          {/* Timestamp */}
          <div className="chart-tooltip-time">
            {new Date(hoverData.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>

          {/* ── BEFORE → AFTER ── */}
          {bPrice !== null ? (
            <div className="chart-tooltip-ba">
              <div className="chart-tooltip-ba-col">
                <div className="chart-tooltip-ba-label">BEFORE</div>
                <div className="chart-tooltip-ba-price">{bPrice.toFixed(1)}<span className="chart-tooltip-unit"> CR</span></div>
                <div className="chart-tooltip-ba-fill">{bFill}%<span className="chart-tooltip-unit"> fill</span></div>
              </div>
              <div className="chart-tooltip-ba-arrow">→</div>
              <div className="chart-tooltip-ba-col">
                <div className="chart-tooltip-ba-label">AFTER</div>
                <div className="chart-tooltip-ba-price" style={{ color: aPrice > bPrice ? "var(--accent-red)" : aPrice < bPrice ? "var(--accent-green)" : "var(--text-primary)" }}>
                  {aPrice.toFixed(1)}<span className="chart-tooltip-unit"> CR</span>
                </div>
                <div className="chart-tooltip-ba-fill" style={{ color: aFill > bFill! ? "var(--accent-green)" : aFill < bFill! ? "var(--accent-red)" : "var(--text-primary)" }}>
                  {aFill}%<span className="chart-tooltip-unit"> fill</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="chart-tooltip-ba">
              <div className="chart-tooltip-ba-col">
                <div className="chart-tooltip-ba-price">{aPrice.toFixed(1)}<span className="chart-tooltip-unit"> CR</span></div>
                <div className="chart-tooltip-ba-fill">{aFill}%<span className="chart-tooltip-unit"> fill</span></div>
              </div>
            </div>
          )}

          {/* ── WHAT HAPPENED ── */}
          <div className="chart-tooltip-what">
            {deliveries.map((ev, i) => (
              <div key={`d${i}`} className="chart-tooltip-event">
                <span style={{ color: "var(--accent-blue)" }}>NPC delivery</span>
                <span className="chart-tooltip-event-detail">
                  +{Math.round(ev.quantity)}u from {ev.sourcePlanet}
                </span>
              </div>
            ))}
            {departures.map((ev, i) => (
              <div key={`s${i}`} className="chart-tooltip-event">
                <span style={{ color: "var(--accent-blue)" }}>NPC departure</span>
                <span className="chart-tooltip-event-detail">
                  −{Math.round(ev.quantity)}u to {ev.destPlanet}
                </span>
              </div>
            ))}
            {disruptions.map((dis, i) => (
              <div key={`x${i}`} className="chart-tooltip-event">
                <span style={{ color: "var(--accent-yellow)" }}>⚠ {dis.type.replace(/_/g, " ")}</span>
                {dis.multiplier ? <span className="chart-tooltip-event-detail">{dis.multiplier.toFixed(1)}×</span> : null}
              </div>
            ))}
            {deliveries.length === 0 && departures.length === 0 && disruptions.length === 0 && (
              <div className="chart-tooltip-event" style={{ color: "var(--text-dim)" }}>
                Production + consumption tick
              </div>
            )}
          </div>
        </div>
      );
    })()}
    </div>
  );
}

// ── Price Change Log (uses shared filter from parent) ──
//
// Filter is entry-count based (not timestamp-based) to stay consistent
// with the sparkline comparison used in the commodity table.
// Price history is recorded every ~30 min, so:
//   10m/30m → last 2 entries, 1h → 3, 6h → 13, 24h/ALL → all

function filterEntryCount(filterMinutes: number): number {
  if (filterMinutes === 0) return Infinity; // ALL
  // +1 for context (need N+1 entries to compute N changes)
  return Math.max(2, Math.ceil(filterMinutes / 30) + 1);
}

function PriceChangeLogContent({
  points,
  warmupCompletedAt,
  filterMinutes,
  onFilterChange,
  onDrillDown,
}: {
  points: EnrichedPriceHistoryPoint[];
  warmupCompletedAt: number;
  filterMinutes: number;
  onFilterChange: (m: number) => void;
  onDrillDown: (point: EnrichedPriceHistoryPoint, prevPoint: EnrichedPriceHistoryPoint | null) => void;
}) {
  // Most recent first
  const allRecent = [...points].reverse();

  // Slice to the right number of entries for this window
  const maxEntries = filterEntryCount(filterMinutes);
  const filtered = allRecent.slice(0, maxEntries);

  return (
    <>
      <div className="log-filter-row">
        {TIME_FILTERS.map((f) => (
          <button
            key={f.label}
            className={`log-filter-chip ${filterMinutes === f.minutes ? "active" : ""}`}
            onClick={() => onFilterChange(f.minutes)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Log entries (clickable) ── */}
      <div className="price-log">
        {filtered.length === 0 ? (
          <div className="sidebar-empty" style={{ padding: "14px 0" }}>
            No data in this time range
          </div>
        ) : (
          filtered.map((point, i) => {
            const prevPoint =
              i < filtered.length - 1 ? filtered[i + 1] : null;
            const change = prevPoint
              ? ((point.price - prevPoint.price) / prevPoint.price) * 100
              : 0;
            const hasChange =
              i < filtered.length - 1 &&
              Math.abs(change) >= CHANGE_THRESHOLD;
            const isLive = point.timestamp > warmupCompletedAt;
            const hasEvents = (point.tradeEvents?.length || 0) > 0;
            const hasDisruptions = (point.activeDisruptions?.length || 0) > 0;

            return (
              <div
                className={`price-log-entry ${hasEvents || hasDisruptions ? "has-context" : ""}`}
                key={point.timestamp}
                style={{ opacity: hasChange ? 1 : 0.3, cursor: "pointer" }}
                onClick={() => onDrillDown(point, prevPoint || null)}
                title="Click for details"
              >
                <span className="price-log-time">
                  {formatTime(point.timestamp)}
                </span>
                <span
                  className={`price-log-badge ${isLive ? "live" : "warmup"}`}
                >
                  {isLive ? "LIVE" : "SEED"}
                </span>
                <span className="price-log-price">
                  {point.price.toFixed(1)}
                </span>
                <span
                  className="price-log-change"
                  style={{
                    color: hasChange
                      ? change > 0
                        ? "var(--accent-green)"
                        : "var(--accent-red)"
                      : "var(--text-dim)",
                  }}
                >
                  {i < filtered.length - 1
                    ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%`
                    : "---"}
                </span>
                <span className="price-log-fill">
                  {(point.fillRatio * 100).toFixed(0)}%
                </span>
                {/* Indicator icons for context */}
                <span className="price-log-icons">
                  {hasEvents && <Truck size={9} style={{ color: "var(--accent-blue)" }} />}
                  {hasDisruptions && <AlertTriangle size={9} style={{ color: "var(--accent-yellow)" }} />}
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

// ── Trade Event Row ──

function TradeEventRow({ event }: { event: NpcTradeEvent }) {
  const isDeparture = event.type === "departure";
  const Icon = isDeparture ? Package : TrendingUp;
  const label = isDeparture
    ? `${event.sourcePlanet} → ${event.destPlanet}`
    : `→ ${event.destPlanet}`;

  return (
    <div className="trade-event-row">
      <span className="te-icon">
        <Icon size={10} style={{ color: isDeparture ? "var(--accent-yellow)" : "var(--accent-green)" }} />
      </span>
      <span className="te-type">
        {isDeparture ? "DEP" : "DEL"}
      </span>
      <span className="te-route">{label}</span>
      <span className="te-qty">{event.quantity.toFixed(0)}u</span>
      <span className="te-margin" style={{
        color: event.margin > 0.2 ? "var(--accent-green)" : event.margin > 0.1 ? "var(--text-secondary)" : "var(--accent-red)",
      }}>
        {(event.margin * 100).toFixed(0)}%
      </span>
      <span className="te-time">{formatTime(event.timestamp)}</span>
    </div>
  );
}

// ── Price Drill-Down Modal ──

function PriceDrillDownModal({
  point,
  prevPoint,
  planetName,
  planetId,
  commodityName,
  relatedRoutes,
  relatedDisruptions,
  crossPlanetPrices,
  onClose,
}: {
  point: EnrichedPriceHistoryPoint;
  prevPoint: EnrichedPriceHistoryPoint | null;
  planetName: string;
  planetId: string;
  commodityName: string;
  relatedRoutes: NpcTradeRoute[];
  relatedDisruptions: AdminDisruptionView[];
  crossPlanetPrices: { planetId: string; name: string; price: number; fill: number; production: number; consumption: number }[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const priceChange = prevPoint
    ? ((point.price - prevPoint.price) / prevPoint.price) * 100
    : 0;
  const fillChange = prevPoint
    ? (point.fillRatio - prevPoint.fillRatio) * 100
    : 0;

  // Determine likely cause — filtered by planet perspective
  const causes: string[] = [];
  if (point.tradeEvents?.length) {
    // Deliveries TO this planet = goods arrived here → local supply increased → price ↓
    const localDeliveries = point.tradeEvents.filter(
      (e) => e.type === "delivery" && e.destPlanet === planetId,
    );
    // Departures FROM this planet = goods left here → local supply decreased → price ↑
    const localDepartures = point.tradeEvents.filter(
      (e) => e.type === "departure" && e.sourcePlanet === planetId,
    );
    // Events on other planets (not directly affecting local supply)
    const otherEvents = point.tradeEvents.filter(
      (e) =>
        (e.type === "delivery" && e.destPlanet !== planetId) ||
        (e.type === "departure" && e.sourcePlanet !== planetId),
    );
    if (localDeliveries.length > 0)
      causes.push(`${localDeliveries.length} NPC delivery(s) increased local supply → price ↓`);
    if (localDepartures.length > 0)
      causes.push(`${localDepartures.length} NPC departure(s) reduced local supply → price ↑`);
    if (otherEvents.length > 0)
      causes.push(`${otherEvents.length} NPC trade event(s) on other planets`);
  }
  if (point.activeDisruptions?.length) {
    for (const d of point.activeDisruptions) {
      causes.push(`${d.type.replace(/_/g, " ")} on ${d.commodityId || "all"}`);
    }
  }
  if (relatedDisruptions.length > 0 && !point.activeDisruptions?.length) {
    for (const d of relatedDisruptions) {
      causes.push(`Active: ${d.type.replace(/_/g, " ")} (${formatDuration(d.remainingMs)} left)`);
    }
  }
  if (causes.length === 0) {
    // Provide more context about what IS driving the price
    const routeCount = relatedRoutes.length;
    if (routeCount > 0) {
      const inTransitCount = relatedRoutes.filter((r) => r.inTransit).length;
      causes.push(`Mean reversion + noise (${routeCount} route${routeCount > 1 ? "s" : ""} configured, ${inTransitCount} in transit)`);
    } else {
      causes.push("Mean reversion + noise (no trade routes serve this commodity here)");
    }
  }

  const handleCopyDrillDown = useCallback(() => {
    const lines: string[] = [];
    lines.push(`${commodityName} @ ${planetName}`);
    lines.push(`Snapshot: ${new Date(point.timestamp).toLocaleString()}`);
    lines.push("");
    lines.push("── Price Movement ──");
    if (prevPoint) lines.push(`Price: ${prevPoint.price.toFixed(1)} → ${point.price.toFixed(1)} (${priceChange > 0 ? "+" : ""}${priceChange.toFixed(2)}%)`);
    else lines.push(`Price: ${point.price.toFixed(1)}`);
    lines.push("");
    lines.push("── Inventory ──");
    if (prevPoint) lines.push(`Fill: ${(prevPoint.fillRatio * 100).toFixed(1)}% → ${(point.fillRatio * 100).toFixed(1)}% (${fillChange > 0 ? "+" : ""}${fillChange.toFixed(2)}pp)`);
    else lines.push(`Fill: ${(point.fillRatio * 100).toFixed(1)}%`);
    lines.push(`Production: ${point.production > 0 ? `+${point.production.toFixed(1)}/tick` : "---"}`);
    lines.push(`Consumption: ${point.consumption > 0 ? `-${point.consumption.toFixed(1)}/tick` : "---"}`);
    lines.push("");
    lines.push("── Likely Cause ──");
    causes.forEach((c) => lines.push(c));
    if (relatedRoutes.length > 0) {
      lines.push("");
      lines.push(`── Trade Routes (${relatedRoutes.length}) ──`);
      relatedRoutes.forEach((r) => {
        const role = r.sourcePlanet === planetId ? "EXP" : "IMP";
        lines.push(`  ${role}: ${r.sourcePlanet} → ${r.destPlanet} | ${Math.round(r.volumePerTrip)}u/trip | ${Math.round(r.tripDurationMs / 60_000)}m trip | ${r.inTransit ? "IN TRANSIT" : "IDLE"}${!r.enabled ? " [PAUSED]" : ""}`);
      });
    }
    if (crossPlanetPrices.length > 1) {
      lines.push("");
      lines.push("── Cross-Planet Prices ──");
      [...crossPlanetPrices].sort((a, b) => a.price - b.price).forEach((cp) => {
        lines.push(`  ${cp.name}: ${cp.price.toFixed(1)} (fill ${(cp.fill * 100).toFixed(0)}%)`);
      });
    }
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [point, prevPoint, planetName, planetId, commodityName, causes, relatedRoutes, crossPlanetPrices, priceChange, fillChange]);

  return (
    <div className="drilldown-overlay" onClick={onClose}>
      <div className="drilldown-modal" onClick={(e) => e.stopPropagation()}>
        <div className="drilldown-header">
          <h4>{commodityName} @ {planetName}</h4>
          <span className="text-dim">{formatTime(point.timestamp)}</span>
          <button
            className="sidebar-copy"
            onClick={handleCopyDrillDown}
            title="Copy drill-down data"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "COPIED" : "COPY"}
          </button>
          <button className="sidebar-close" onClick={onClose}>
            <X size={12} />
          </button>
        </div>

        {/* ── Price Movement ── */}
        <div className="drilldown-section">
          <div className="drilldown-label">
            Price Movement
            <HelpTip text={prevPoint ? `Between this snapshot and the previous one (30 min apart), ${commodityName} ${priceChange > 0 ? "increased" : "decreased"} from ${prevPoint.price.toFixed(1)} to ${point.price.toFixed(1)} cr (${priceChange > 0 ? "+" : ""}${priceChange.toFixed(2)}%). ${Math.abs(priceChange) > 5 ? "This is a large move — likely caused by a trade delivery, disruption, or significant inventory change." : Math.abs(priceChange) < 0.5 ? "This is a minor fluctuation from the natural mean-reversion noise in the simulation." : "A moderate change driven by normal supply/demand dynamics."}` : `Current price of ${commodityName} at this point in time.`} />
          </div>
          <div className="drilldown-grid">
            <div className="dd-stat">
              <span className="dd-key">Price</span>
              <span className="dd-val">
                {prevPoint ? `${prevPoint.price.toFixed(1)} → ` : ""}{point.price.toFixed(1)}
              </span>
            </div>
            <div className="dd-stat">
              <span className="dd-key">Change</span>
              <span className="dd-val" style={{
                color: Math.abs(priceChange) > 0.3
                  ? priceChange > 0 ? "var(--accent-green)" : "var(--accent-red)"
                  : "var(--text-dim)",
              }}>
                {priceChange > 0 ? "+" : ""}{priceChange.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* ── Fill Ratio ── */}
        <div className="drilldown-section">
          <div className="drilldown-label">
            Inventory
            <HelpTip text={prevPoint ? `Fill went from ${(prevPoint.fillRatio * 100).toFixed(1)}% to ${(point.fillRatio * 100).toFixed(1)}% (${fillChange > 0 ? "+" : ""}${fillChange.toFixed(2)} percentage points). ${fillChange > 0 ? `Stock INCREASED — this could be from a trade delivery arriving, production output, or the mean-reversion process pushing inventory back toward 50%.` : fillChange < 0 ? `Stock DECREASED — consumption is draining inventory, an NPC departed with cargo, or a demand surge disruption is active.` : `Stock was unchanged this interval.`} "pp" means percentage points — the raw difference in fill %, not a percentage of a percentage.` : `Current inventory fill level for this snapshot.`} />
          </div>
          <div className="drilldown-grid">
            <div className="dd-stat">
              <span className="dd-key">Fill</span>
              <span className="dd-val">
                {prevPoint ? `${(prevPoint.fillRatio * 100).toFixed(1)}% → ` : ""}
                {(point.fillRatio * 100).toFixed(1)}%
              </span>
            </div>
            <div className="dd-stat">
              <span className="dd-key">
                Fill Delta
                <HelpTip text={`"pp" = percentage points. This is the absolute change in fill ratio, not a relative percentage. For example, going from 6.6% to 17.4% is +10.86pp (not +165%). A large positive delta means a lot of stock was added (trade delivery or production burst). A large negative delta means heavy consumption or an NPC departure removed cargo.`} />
              </span>
              <span className="dd-val" style={{
                color: Math.abs(fillChange) > 0.5
                  ? fillChange > 0 ? "var(--accent-green)" : "var(--accent-red)"
                  : "var(--text-dim)",
              }}>
                {fillChange > 0 ? "+" : ""}{fillChange.toFixed(2)}pp
              </span>
            </div>
            <div className="dd-stat">
              <span className="dd-key">Production</span>
              <span className="dd-val text-green">
                {point.production > 0 ? `+${point.production.toFixed(1)}/tick` : "---"}
              </span>
            </div>
            <div className="dd-stat">
              <span className="dd-key">Consumption</span>
              <span className="dd-val text-red">
                {point.consumption > 0 ? `-${point.consumption.toFixed(1)}/tick` : "---"}
              </span>
            </div>
          </div>
        </div>

        {/* ── Likely Cause ── */}
        <div className="drilldown-section">
          <div className="drilldown-label">
            Likely Cause
            <HelpTip text={`The engine's best guess at what drove this price change. Possible causes: NPC trade deliveries (increase supply → price drops), NPC departures (remove stock → price rises), active disruptions (production halts, demand surges), or mean reversion + noise (the natural Ornstein-Uhlenbeck process that pushes fill ratios back toward 50%). When no specific event is detected, prices drift organically with random noise.`} />
          </div>
          <div className="drilldown-causes">
            {causes.map((cause, i) => (
              <div key={i} className="dd-cause">{cause}</div>
            ))}
          </div>
        </div>

        {/* ── Trade Routes Context ── */}
        {relatedRoutes.length > 0 && (
          <div className="drilldown-section">
            <div className="drilldown-label">
              <Truck size={10} style={{ marginRight: 4 }} />
              Trade Routes ({relatedRoutes.length})
            </div>
            <div className="drilldown-trades">
              {relatedRoutes.map((r) => (
                <div key={r.id} className="dd-trade">
                  <span className={`dd-trade-type ${r.inTransit ? "delivery" : "departure"}`}>
                    {r.sourcePlanet === planetName ? "EXP" : "IMP"}
                  </span>
                  <span className="dd-trade-route">
                    {r.sourcePlanet} → {r.destPlanet}
                  </span>
                  <span className="dd-trade-qty">{Math.round(r.volumePerTrip)}u</span>
                  <span className="dd-trade-prices">
                    {Math.round(r.tripDurationMs / 60_000)}m trip
                  </span>
                  <span className="dd-trade-margin" style={{
                    color: r.inTransit ? "var(--accent-green)" : "var(--text-dim)",
                  }}>
                    {r.inTransit ? "IN TRANSIT" : "IDLE"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Cross-Planet Comparison ── */}
        {crossPlanetPrices.length > 1 && (() => {
          const cpSorted = [...crossPlanetPrices].sort((a, b) => a.price - b.price);
          const cpCheap = cpSorted[0]!;
          const cpExp = cpSorted[cpSorted.length - 1]!;
          const cpSpread = cpExp.price - cpCheap.price;
          const cpSpreadPct = cpCheap.price > 0 ? (cpSpread / cpCheap.price) * 100 : 0;
          return (
            <div className="drilldown-section">
              <div className="drilldown-label">
                <ArrowRightLeft size={10} style={{ marginRight: 4 }} />
                Cross-Planet Prices
                {cpSpread > 1 && (
                  <span className="text-dim" style={{ marginLeft: 8, fontSize: 9 }}>
                    spread: {cpSpread.toFixed(1)} ({cpSpreadPct.toFixed(0)}%)
                  </span>
                )}
              </div>
              <div className="drilldown-grid" style={{ gridTemplateColumns: "1fr" }}>
                {cpSorted.map((cp) => (
                  <div key={cp.planetId} className="dd-stat" style={{ justifyContent: "space-between" }}>
                    <span className="dd-key">{cp.name}</span>
                    <span className="dd-val">
                      {cp.price.toFixed(1)}
                      <span className="text-dim" style={{ marginLeft: 6, fontSize: 9 }}>
                        fill {(cp.fill * 100).toFixed(0)}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Trade Events in Window ── */}
        {point.tradeEvents && point.tradeEvents.length > 0 && (
          <div className="drilldown-section">
            <div className="drilldown-label">Trade Events in Window</div>
            <div className="drilldown-trades">
              {point.tradeEvents.map((event) => (
                <div key={event.id} className="dd-trade">
                  <span className={`dd-trade-type ${event.type}`}>
                    {event.type === "departure" ? "DEP" : "DEL"}
                  </span>
                  <span className="dd-trade-route">
                    {event.sourcePlanet} → {event.destPlanet}
                  </span>
                  <span className="dd-trade-qty">{event.quantity.toFixed(0)}u</span>
                  <span className="dd-trade-prices">
                    {event.sourcePrice.toFixed(1)} → {event.destPrice.toFixed(1)}
                  </span>
                  <span className="dd-trade-margin" style={{
                    color: event.margin > 0.15 ? "var(--accent-green)" : "var(--text-dim)",
                  }}>
                    {(event.margin * 100).toFixed(0)}% margin
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Active Disruptions ── */}
        {(point.activeDisruptions?.length || relatedDisruptions.length > 0) && (
          <div className="drilldown-section">
            <div className="drilldown-label">
              <AlertTriangle size={10} style={{ marginRight: 4, color: "var(--accent-yellow)" }} />
              Active Disruptions
            </div>
            <div className="drilldown-disruptions">
              {(point.activeDisruptions && point.activeDisruptions.length > 0
                ? point.activeDisruptions.map((d) => (
                    <div key={d.id} className="dd-disruption">
                      <span className="dd-disrupt-type">{d.type.replace(/_/g, " ")}</span>
                      <span className="dd-disrupt-target">{d.planetId} / {d.commodityId || "all"}</span>
                      {d.multiplier && (
                        <span className="dd-disrupt-mult">{d.multiplier.toFixed(1)}x</span>
                      )}
                    </div>
                  ))
                : relatedDisruptions.map((d) => (
                    <div key={d.id} className="dd-disruption">
                      <span className="dd-disrupt-type">{d.type.replace(/_/g, " ")}</span>
                      <span className="dd-disrupt-target">{formatDuration(d.remainingMs)} left</span>
                      {d.multiplier && (
                        <span className="dd-disrupt-mult">{d.multiplier.toFixed(1)}x</span>
                      )}
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Commodity Table (sub-component) ──

type SortKey = "name" | "price" | "fill" | "prod" | "cons" | "net" | "chg" | "health";
type SortDir = "asc" | "desc";

const HEALTH_PRIORITY: Record<string, number> = {
  HALTED: 0, ORPHAN: 1, "NO SUPPLY": 2, UNDERSUPPLIED: 3, DISRUPTED: 4,
  OVERSUPPLIED: 5, "EXPORT OPP": 6, BALANCED: 7,
};

function CommodityTable({
  planet,
  allPlanets,
  routes,
  selectedId,
  filterMinutes,
  onSelect,
}: {
  planet: AdminPlanetMarketState;
  allPlanets: AdminPlanetMarketState[];
  routes: NpcTradeRoute[];
  selectedId: string | null;
  filterMinutes: number;
  onSelect: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc"); // numeric defaults descending
    }
  };

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  // Precompute route counts per commodity for this planet
  const routeCounts = useMemo(() => {
    const map = new Map<string, { inbound: string[]; outbound: string[] }>();
    for (const r of routes) {
      const entry = map.get(r.commodityId) ?? { inbound: [], outbound: [] };
      if (r.destPlanet === planet.planetId) {
        entry.inbound.push(r.sourcePlanet);
      }
      if (r.sourcePlanet === planet.planetId) {
        entry.outbound.push(r.destPlanet);
      }
      map.set(r.commodityId, entry);
    }
    return map;
  }, [routes, planet.planetId]);

  // Precompute derived data for sorting
  const rows = planet.commodities.map((c) => {
    const windowChange = filterMinutes === 0 || filterMinutes === 1440
      ? c.priceChange24h
      : sparklineChange(c.sparkline, filterMinutes);
    const net = c.production - c.consumption;
    const health = computeHealthStatus(c, planet.planetId, planet.name, allPlanets, routes, []);
    const rc = routeCounts.get(c.commodityId) ?? { inbound: [], outbound: [] };
    return { c, windowChange, net, health, inbound: rc.inbound, outbound: rc.outbound };
  });

  // Sort
  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name": return dir * a.c.name.localeCompare(b.c.name);
      case "price": return dir * (a.c.currentPrice - b.c.currentPrice);
      case "fill": return dir * (a.c.fillRatio - b.c.fillRatio);
      case "prod": return dir * (a.c.production - b.c.production);
      case "cons": return dir * (a.c.consumption - b.c.consumption);
      case "net": return dir * (a.net - b.net);
      case "chg": return dir * (a.windowChange - b.windowChange);
      case "health": return dir * ((HEALTH_PRIORITY[a.health.label] ?? 6) - (HEALTH_PRIORITY[b.health.label] ?? 6));
      default: return 0;
    }
  });

  return (
    <table>
      <thead>
        <tr>
          <th className="sortable-th" onClick={() => handleSort("health")} title="Economy health — grey = ok, red = needs attention" style={{ width: 28 }}>
            <span className="health-indicator health-indicator--ok" style={{ width: 7, height: 7 }} />{sortArrow("health")}
          </th>
          <th></th>
          <th className="sortable-th" onClick={() => handleSort("name")}>
            Commodity{sortArrow("name")}
          </th>
          <th className="sortable-th" style={{ textAlign: "right" }} onClick={() => handleSort("price")}>
            Price{sortArrow("price")}
          </th>
          <th className="sortable-th" onClick={() => handleSort("fill")}>
            Fill{sortArrow("fill")}
          </th>
          <th style={{ textAlign: "center", fontSize: "0.7rem", color: "var(--accent-blue)" }} title="Inbound routes delivering this commodity here">
            In
          </th>
          <th style={{ textAlign: "center", fontSize: "0.7rem", color: "var(--accent-yellow)" }} title="Outbound routes exporting this commodity from here">
            Out
          </th>
          <th className="sortable-th" style={{ textAlign: "right" }} onClick={() => handleSort("prod")}>
            Prod{sortArrow("prod")}
          </th>
          <th className="sortable-th" style={{ textAlign: "right" }} onClick={() => handleSort("cons")}>
            Cons{sortArrow("cons")}
          </th>
          <th className="sortable-th" style={{ textAlign: "right" }} onClick={() => handleSort("net")}>
            Net{sortArrow("net")}
          </th>
          <th className="sortable-th" style={{ textAlign: "right" }} onClick={() => handleSort("chg")}>
            Chg{sortArrow("chg")}
          </th>
          <th>Trend</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(({ c, windowChange, net, health, inbound, outbound }) => {
          const isActive = Math.abs(windowChange) >= CHANGE_THRESHOLD;
          const isSelected = selectedId === c.commodityId;
          const netColor = net > 1 ? "var(--accent-green)" : net < -1 ? "var(--accent-red)" : "var(--text-dim)";

          return (
            <tr
              key={c.commodityId}
              style={{
                cursor: "pointer",
                opacity: isActive || isSelected ? 1 : 0.3,
                background: isSelected
                  ? "color-mix(in srgb, var(--accent-green) 6%, transparent)"
                  : undefined,
                borderLeft: isSelected
                  ? "2px solid var(--accent-green)"
                  : "2px solid transparent",
              }}
              onClick={() => onSelect(c.commodityId)}
            >
              <td title={`${health.label}: ${health.description}`}>
                <span className={`health-indicator ${
                  health.label === "BALANCED" || health.label === "EXPORT OPP" || health.label === "OVERSUPPLIED"
                    ? "health-indicator--grey"
                    : health.label === "UNDERSUPPLIED"
                      ? "health-indicator--yellow"
                      : "health-indicator--red"
                }`} />
              </td>
              <td>{c.icon}</td>
              <td>
                {c.name}
                <span className="text-dim" style={{ marginLeft: 6, fontSize: 9 }}>
                  {c.category}
                </span>
              </td>
              <td style={{ textAlign: "right" }}>
                <PriceValue price={c.currentPrice} basePrice={c.basePrice} />
              </td>
              <td>
                <FillBar ratio={c.fillRatio} />
              </td>
              <td
                className="tooltip-cell"
                style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: inbound.length > 0 ? "var(--accent-blue)" : "var(--text-dim)" }}
                data-tooltip={inbound.length > 0 ? `Inbound from: ${inbound.join(", ")}` : "No inbound routes"}
              >
                {inbound.length || "—"}
              </td>
              <td
                className="tooltip-cell"
                style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: outbound.length > 0 ? "var(--accent-yellow)" : "var(--text-dim)" }}
                data-tooltip={outbound.length > 0 ? `Outbound to: ${outbound.join(", ")}` : "No outbound routes"}
              >
                {outbound.length || "—"}
              </td>
              <td style={{ textAlign: "right" }}>
                {c.production > 0 ? `+${c.production.toFixed(1)}` : "---"}
              </td>
              <td style={{ textAlign: "right" }}>
                {c.consumption > 0 ? `-${c.consumption.toFixed(1)}` : "---"}
              </td>
              <td style={{ textAlign: "right", color: netColor, fontWeight: Math.abs(net) > 5 ? 600 : 400 }}>
                {net > 0 ? "+" : ""}{net.toFixed(1)}
              </td>
              <td
                style={{
                  textAlign: "right",
                  color: windowChange > CHANGE_THRESHOLD
                    ? "var(--accent-green)"
                    : windowChange < -CHANGE_THRESHOLD
                      ? "var(--accent-red)"
                      : "var(--text-dim)",
                }}
              >
                {windowChange > 0 ? "+" : ""}
                {windowChange.toFixed(1)}%
              </td>
              <td>
                <Sparkline data={c.sparkline} width={60} height={20} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Price Value ──

function PriceValue({
  price,
  basePrice,
}: {
  price: number;
  basePrice: number;
}) {
  const ratio = price / basePrice;
  const color =
    ratio < 0.85
      ? "var(--accent-green)"
      : ratio > 1.15
        ? "var(--accent-red)"
        : "var(--text-primary)";

  return (
    <span style={{ color, fontFamily: "var(--font-mono)" }}>
      {price.toFixed(1)}
    </span>
  );
}

// ── Helpers ──

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
