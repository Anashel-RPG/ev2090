/**
 * 3D Trade Route Viewer — holographic economy visualization.
 * Canvas + floating overlay panels.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api } from "../api";
import {
  TradeMapRenderer,
  type SelectionInfo,
  type HoverInfo,
} from "../engine/TradeMapRenderer";
import { detectProblems, type ProblemSet } from "../lib/problemDetection";
import { runForecast } from "../lib/forecast";
import type {
  AdminRegionDetail,
  CommodityDef,
  CommodityCategory,
  EconomyDiagnostics,
  NpcTradeRoute,
  AdminPlanetMarketState,
} from "../types";
import "./TradeRouteViewer.css";

const ALL_CATEGORIES: CommodityCategory[] = [
  "minerals",
  "food",
  "tech",
  "industrial",
  "luxury",
];

const CATEGORY_COLORS: Record<CommodityCategory, string> = {
  minerals: "#ff8844",
  food: "#66cc44",
  tech: "#4488ff",
  industrial: "#aaaacc",
  luxury: "#ffaa44",
};

const REFRESH_INTERVAL = 15_000;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatAge(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatEta(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  return `${mins}m`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function TradeRouteViewer() {
  // ── Data state ──
  const [detail, setDetail] = useState<AdminRegionDetail | null>(null);
  const [commodities, setCommodities] = useState<CommodityDef[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<EconomyDiagnostics | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── UI state ──
  const [selectedCategories, setSelectedCategories] = useState<
    Set<CommodityCategory>
  >(new Set(ALL_CATEGORIES));
  const [forecastHours, setForecastHours] = useState(0);
  const [selection, setSelection] = useState<SelectionInfo>(null);
  const [hover, setHover] = useState<HoverInfo>(null);
  const [deadRouteMode, setDeadRouteMode] = useState(false);

  // ── Refs ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TradeMapRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Fetch data ──
  const fetchData = useCallback(async () => {
    try {
      const [d, coms, diag] = await Promise.allSettled([
        api.getRegionDetail("core-worlds"),
        api.getCommodities(),
        api.getDiagnostics("core-worlds"),
      ]);
      if (d.status === "fulfilled") setDetail(d.value);
      else setError("Failed to load region data");
      if (coms.status === "fulfilled") setCommodities(coms.value.commodities);
      if (diag.status === "fulfilled") setDiagnostics(diag.value);
      setLoading(false);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Initialize renderer ──
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!container) return;

    const renderer = new TradeMapRenderer(
      canvas,
      (sel) => setSelection(sel),
      (hov) => setHover(hov),
    );
    rendererRef.current = renderer;

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = w * Math.min(window.devicePixelRatio, 2);
      canvas.height = h * Math.min(window.devicePixelRatio, 2);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      renderer.resize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    return () => {
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // ── Push data to renderer ──
  useEffect(() => {
    if (!rendererRef.current || !detail || !commodities) return;
    rendererRef.current.updateData({
      planets: detail.planets,
      routes: detail.routes,
      disruptions: detail.disruptions,
      commodityDefs: commodities,
    });
  }, [detail, commodities]);

  // ── Update filters ──
  useEffect(() => {
    rendererRef.current?.setFilter(selectedCategories);
  }, [selectedCategories]);

  // ── Live updates ──
  useEffect(() => {
    if (!rendererRef.current || !detail) return;
    rendererRef.current.updateLive(detail.planets, detail.disruptions);
  }, [detail]);

  // ── Sync dead route mode on data refresh ──
  useEffect(() => {
    if (deadRouteMode && problems && rendererRef.current) {
      rendererRef.current.setDeadRouteMode(
        true,
        problems.deadRoutes.map((dr) => dr.routeId),
      );
    }
  }, [detail]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed: problems ──
  const problems = useMemo<ProblemSet | null>(() => {
    if (!detail) return null;
    return detectProblems(detail, diagnostics ?? undefined);
  }, [detail, diagnostics]);

  // ── Computed: forecast ──
  const forecastResult = useMemo(() => {
    if (!detail || !commodities || forecastHours <= 0) return null;
    return runForecast(
      detail.planets,
      detail.routes,
      detail.disruptions,
      commodities,
      forecastHours,
    );
  }, [detail, commodities, forecastHours]);

  // ── Computed: event feed ──
  const eventFeed = useMemo(() => {
    if (!detail) return [];
    const events: {
      time: number;
      type: "departure" | "delivery" | "disruption";
      text: string;
      routeId: string | null;
    }[] = [];

    for (const d of detail.disruptions) {
      events.push({
        time: d.startedAt,
        type: "disruption",
        text: `${d.type.replace("_", " ")} on ${d.planetId}${d.commodityId ? `/${d.commodityId}` : ""}`,
        routeId: null,
      });
    }

    for (const r of detail.routes) {
      if (r.lastDeparture > 0) {
        events.push({
          time: r.lastDeparture,
          type: "departure",
          text: `${r.commodityId} ${r.sourcePlanet}->${r.destPlanet} ${Math.round(r.volumePerTrip)}u`,
          routeId: r.id,
        });
      }
    }

    return events.sort((a, b) => b.time - a.time).slice(0, 30);
  }, [detail]);

  // ── Selection data lookup ──
  const selectedPlanet = useMemo<AdminPlanetMarketState | null>(() => {
    if (!selection || selection.type !== "planet" || !detail) return null;
    return (
      detail.planets.find((p) => p.planetId === selection.planetId) ?? null
    );
  }, [selection, detail]);

  const selectedRoute = useMemo<NpcTradeRoute | null>(() => {
    if (!selection || selection.type !== "route" || !detail) return null;
    return detail.routes.find((r) => r.id === selection.routeId) ?? null;
  }, [selection, detail]);

  // ── Category filter handlers ──
  const toggleCategory = (cat: CommodityCategory) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const selectAll = () => setSelectedCategories(new Set(ALL_CATEGORIES));
  const selectNone = () => setSelectedCategories(new Set());

  // ── Dead route toggle ──
  const toggleDeadRouteMode = () => {
    const next = !deadRouteMode;
    setDeadRouteMode(next);
    if (rendererRef.current && problems) {
      rendererRef.current.setDeadRouteMode(
        next,
        problems.deadRoutes.map((dr) => dr.routeId),
      );
    }
  };

  // ── Commodity count per category ──
  const categoryCounts = useMemo(() => {
    if (!commodities) return {};
    const counts: Record<string, number> = {};
    for (const c of commodities) {
      counts[c.category] = (counts[c.category] ?? 0) + 1;
    }
    return counts;
  }, [commodities]);

  return (
    <div className="viewer-page" ref={containerRef}>
      <canvas ref={canvasRef} className="viewer-canvas" />

      {loading && <div className="viewer-loading">Loading economy data...</div>}
      {error && <div className="viewer-loading">{error}</div>}

      {/* ── Cargo tooltip ── */}
      {hover && hover.type === "cargo" && (
        <div
          className="viewer-cargo-tooltip"
          style={{
            left: Math.min(hover.screenX + 12, window.innerWidth - 180),
            top: Math.max(hover.screenY - 50, 8),
          }}
        >
          <div className="cargo-tooltip-commodity">{hover.commodityName}</div>
          <div className="cargo-tooltip-row">
            {Math.round(hover.volume)}u &middot; {hover.source} → {hover.dest}
          </div>
          <div className="cargo-tooltip-row">
            ETA: {formatEta(hover.estimatedArrival)}
          </div>
        </div>
      )}

      {/* ── Left Panel: Controls ── */}
      <div className="viewer-left-panel">
        {/* Commodity Filters */}
        <div className="viewer-panel">
          <div className="viewer-panel-title">Commodity Filters</div>
          <div className="viewer-filters">
            {ALL_CATEGORIES.map((cat) => (
              <label key={cat} className="viewer-filter-row">
                <input
                  type="checkbox"
                  checked={selectedCategories.has(cat)}
                  onChange={() => toggleCategory(cat)}
                />
                <span
                  className="viewer-filter-dot"
                  style={{ background: CATEGORY_COLORS[cat] }}
                />
                {capitalize(cat)} ({categoryCounts[cat] ?? 0})
              </label>
            ))}
          </div>
          <div className="viewer-filter-actions">
            <button onClick={selectAll}>ALL</button>
            <button onClick={selectNone}>NONE</button>
          </div>
        </div>

        {/* Forecast */}
        <div className="viewer-panel">
          <div className="viewer-panel-title">Forecast</div>
          <div className="viewer-forecast">
            <div className="viewer-forecast-label">
              <span>Project ahead</span>
              <span className="viewer-forecast-value">
                {forecastHours === 0 ? "OFF" : `${forecastHours}h`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={12}
              step={0.5}
              value={forecastHours}
              onChange={(e) => setForecastHours(Number(e.target.value))}
            />
          </div>

          {/* Crisis alerts — only future predictions */}
          {(() => {
            const futureCrises = forecastResult
              ? forecastResult.crisisPoints.filter((cp) => cp.hoursUntil > 0.2)
              : [];
            if (futureCrises.length === 0) return null;
            return (
              <>
                <div
                  className="viewer-panel-title"
                  style={{ marginTop: 10, color: "var(--accent-red)" }}
                >
                  Predicted Crises ({futureCrises.length})
                </div>
                <div className="viewer-crisis-list">
                  {futureCrises.map((cp, i) => (
                    <div
                      key={i}
                      className={`viewer-crisis-item ${cp.type}`}
                    >
                      <span>
                        {cp.type === "shortage" ? "!" : "~"}{" "}
                      </span>
                      <span>
                        {cp.commodityId} on {cp.planetId} in{" "}
                        {cp.hoursUntil}h
                      </span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>

        {/* Event Feed */}
        <div className="viewer-panel viewer-event-feed">
          <div className="viewer-panel-title">
            Live Events ({eventFeed.length})
          </div>
          <div className="viewer-events">
            {eventFeed.map((ev, i) => (
              <div
                key={i}
                className={`viewer-event-item ${ev.routeId ? "hoverable" : ""}`}
                onMouseEnter={() => {
                  if (ev.routeId) rendererRef.current?.highlightRoute(ev.routeId);
                }}
                onMouseLeave={() => {
                  rendererRef.current?.highlightRoute(null);
                }}
                onClick={() => {
                  if (ev.routeId) setSelection({ type: "route", routeId: ev.routeId });
                }}
              >
                <span className="viewer-event-time">
                  {formatTime(ev.time)}
                </span>
                <span className={`viewer-event-type ${ev.type}`}>
                  {ev.type.toUpperCase()}
                </span>
                <span className="viewer-event-detail">{ev.text}</span>
              </div>
            ))}
            {eventFeed.length === 0 && (
              <div className="viewer-event-item">
                <span className="viewer-event-detail" style={{ color: "var(--text-dim)" }}>
                  No recent events
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Right Panel: Selection Info ── */}
      {selection && selection.type === "planet" && selectedPlanet && (
        <div className="viewer-right-panel">
          <button className="close-btn" onClick={() => setSelection(null)}>
            x
          </button>
          <div className="viewer-sel-title">{selectedPlanet.name}</div>
          <div className="viewer-sel-subtitle">
            {selectedPlanet.economyType} colony
          </div>

          <div className="viewer-sel-grid">
            <div className="viewer-sel-stat">
              <div className="label">Commodities</div>
              <div className="value">{selectedPlanet.commodities.length}</div>
            </div>
            <div className="viewer-sel-stat">
              <div className="label">Trade Mod</div>
              <div className="value">{selectedPlanet.tradeModifier}x</div>
            </div>
          </div>

          <div className="viewer-sel-section">Market State</div>
          <table className="viewer-com-table">
            <thead>
              <tr>
                <th>Commodity</th>
                <th>Fill</th>
                <th>Price</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {selectedPlanet.commodities.map((c) => {
                const forecastKey = `${selection.planetId}:${c.commodityId}`;
                const isAffected =
                  forecastResult?.affectedCommodities.has(forecastKey) ?? false;
                const forecastActive = forecastHours > 0 && forecastResult;
                const rowClass = forecastActive
                  ? isAffected
                    ? "forecast-affected"
                    : "forecast-dimmed"
                  : "";

                return (
                  <tr key={c.commodityId} className={rowClass}>
                    <td>{c.icon} {c.name.split(" ")[0]}</td>
                    <td>
                      <span
                        className="fill-bar"
                        style={{
                          width: `${Math.round(c.fillRatio * 40)}px`,
                          background:
                            c.fillRatio < 0.15
                              ? "var(--accent-red)"
                              : c.fillRatio > 0.9
                                ? "var(--accent-blue)"
                                : "var(--accent-green)",
                        }}
                      />
                      {" "}
                      {Math.round(c.fillRatio * 100)}%
                    </td>
                    <td>{c.currentPrice}cr</td>
                    <td
                      style={{
                        color:
                          c.trend === "up"
                            ? "var(--accent-green)"
                            : c.trend === "down"
                              ? "var(--accent-red)"
                              : "var(--text-dim)",
                      }}
                    >
                      {c.trend === "up" ? "+" : c.trend === "down" ? "-" : "="}
                      {Math.abs(c.priceChange24h).toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Disruptions on this planet */}
          {detail &&
            detail.disruptions.filter(
              (d) => d.planetId === selection.planetId,
            ).length > 0 && (
              <>
                <div className="viewer-sel-section">Active Disruptions</div>
                {detail.disruptions
                  .filter((d) => d.planetId === selection.planetId)
                  .map((d) => (
                    <div
                      key={d.id}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--accent-red)",
                        marginBottom: 4,
                      }}
                    >
                      {d.type.replace("_", " ").toUpperCase()}
                      {d.commodityId ? ` on ${d.commodityId}` : ""}
                      {" — "}
                      {formatAge(d.remainingMs)} remaining
                    </div>
                  ))}
              </>
            )}

          {/* Connected routes — grouped by direction + planet */}
          {detail && (() => {
            const planetId = selection.planetId;
            const connected = detail.routes.filter(
              (r) => r.sourcePlanet === planetId || r.destPlanet === planetId,
            );
            const inbound = connected.filter((r) => r.destPlanet === planetId);
            const outbound = connected.filter((r) => r.sourcePlanet === planetId);

            // Group by the other planet
            const groupByPlanet = (routes: NpcTradeRoute[], key: "sourcePlanet" | "destPlanet") => {
              const groups = new Map<string, NpcTradeRoute[]>();
              for (const r of routes) {
                const p = r[key];
                if (!groups.has(p)) groups.set(p, []);
                groups.get(p)!.push(r);
              }
              return groups;
            };

            const inGroups = groupByPlanet(inbound, "sourcePlanet");
            const outGroups = groupByPlanet(outbound, "destPlanet");

            const renderRoute = (r: NpcTradeRoute) => (
              <div
                key={r.id}
                className="viewer-route-item"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: r.enabled ? "var(--text-secondary)" : "var(--text-dim)",
                  marginBottom: 1,
                  paddingLeft: 8,
                  cursor: "pointer",
                }}
                onMouseEnter={() => rendererRef.current?.highlightRoute(r.id)}
                onMouseLeave={() => rendererRef.current?.highlightRoute(null)}
                onClick={() => setSelection({ type: "route", routeId: r.id })}
              >
                {r.commodityId} {Math.round(r.volumePerTrip)}u
                {r.enabled ? "" : " (paused)"}
              </div>
            );

            return (
              <>
                {inbound.length > 0 && (
                  <>
                    <div className="viewer-sel-section">
                      Inbound ({inbound.length})
                    </div>
                    {[...inGroups.entries()].map(([fromPlanet, routes]) => (
                      <div key={fromPlanet}>
                        <div style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 9,
                          color: "var(--text-dim)",
                          letterSpacing: "0.08em",
                          marginTop: 4,
                          marginBottom: 2,
                        }}>
                          FROM {capitalize(fromPlanet)}
                        </div>
                        {routes.map(renderRoute)}
                      </div>
                    ))}
                  </>
                )}
                {outbound.length > 0 && (
                  <>
                    <div className="viewer-sel-section">
                      Outbound ({outbound.length})
                    </div>
                    {[...outGroups.entries()].map(([toPlanet, routes]) => (
                      <div key={toPlanet}>
                        <div style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 9,
                          color: "var(--text-dim)",
                          letterSpacing: "0.08em",
                          marginTop: 4,
                          marginBottom: 2,
                        }}>
                          TO {capitalize(toPlanet)}
                        </div>
                        {routes.map(renderRoute)}
                      </div>
                    ))}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      {selection && selection.type === "route" && selectedRoute && (
        <div className="viewer-right-panel">
          <button className="close-btn" onClick={() => setSelection(null)}>
            x
          </button>
          <div className="viewer-sel-title">
            {selectedRoute.sourcePlanet} → {selectedRoute.destPlanet}
          </div>
          <div className="viewer-sel-subtitle">{selectedRoute.commodityId}</div>

          <div className="viewer-sel-grid">
            <div className="viewer-sel-stat">
              <div className="label">Volume</div>
              <div className="value">{selectedRoute.volumePerTrip}u</div>
            </div>
            <div className="viewer-sel-stat">
              <div className="label">Trip Time</div>
              <div className="value">
                {Math.round(selectedRoute.tripDurationMs / 60_000)}m
              </div>
            </div>
            <div className="viewer-sel-stat">
              <div className="label">Status</div>
              <div
                className="value"
                style={{
                  color: selectedRoute.enabled
                    ? "var(--accent-green)"
                    : "var(--accent-red)",
                }}
              >
                {selectedRoute.enabled ? (selectedRoute.inTransit ? "IN TRANSIT" : "ENABLED") : "PAUSED"}
              </div>
            </div>
            <div className="viewer-sel-stat">
              <div className="label">Last Departure</div>
              <div className="value">
                {selectedRoute.lastDeparture > 0
                  ? formatAge(Date.now() - selectedRoute.lastDeparture) +
                    " ago"
                  : "Never"}
              </div>
            </div>
          </div>

          {detail && (
            <RouteEndpointInfo
              label="Source"
              planetId={selectedRoute.sourcePlanet}
              commodityId={selectedRoute.commodityId}
              planets={detail.planets}
            />
          )}
          {detail && (
            <RouteEndpointInfo
              label="Destination"
              planetId={selectedRoute.destPlanet}
              commodityId={selectedRoute.commodityId}
              planets={detail.planets}
            />
          )}

          {detail && (
            <MarginInfo
              route={selectedRoute}
              planets={detail.planets}
            />
          )}
        </div>
      )}

      {/* ── Bottom Bar ── */}
      <div className="viewer-bottom-bar">
        {problems && (
          <>
            {problems.supplyShortages.length > 0 && (
              <div className="viewer-problem-badge red">
                {problems.supplyShortages.length} shortage
                {problems.supplyShortages.length !== 1 ? "s" : ""}
              </div>
            )}
            {problems.haltedProduction.length > 0 && (
              <div className="viewer-problem-badge red">
                {problems.haltedProduction.length} halted
              </div>
            )}
            {problems.oversupply.length > 0 && (
              <div className="viewer-problem-badge blue">
                {problems.oversupply.length} oversupply
              </div>
            )}
            {problems.orphanCommodities.length > 0 && (
              <div className="viewer-problem-badge yellow">
                {problems.orphanCommodities.length} orphan
                {problems.orphanCommodities.length !== 1 ? "s" : ""}
              </div>
            )}
            {problems.deadRoutes.length > 0 && (
              <div
                className={`viewer-problem-badge yellow ${deadRouteMode ? "active" : ""}`}
                onClick={toggleDeadRouteMode}
              >
                {problems.deadRoutes.length} dead route
                {problems.deadRoutes.length !== 1 ? "s" : ""}
              </div>
            )}
            {problems.totalCount === 0 && (
              <div className="viewer-problem-badge green">All systems nominal</div>
            )}
          </>
        )}

        <div className="viewer-bottom-spacer" />

        {detail && (
          <div className="viewer-tick-info">
            Tick #{detail.tickStats.tickNumber} | {detail.routes.length} routes
            | {detail.disruptions.length} disruptions | Refresh: 15s
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helper sub-components ──

function RouteEndpointInfo({
  label,
  planetId,
  commodityId,
  planets,
}: {
  label: string;
  planetId: string;
  commodityId: string;
  planets: AdminPlanetMarketState[];
}) {
  const planet = planets.find((p) => p.planetId === planetId);
  const com = planet?.commodities.find((c) => c.commodityId === commodityId);
  if (!planet || !com) return null;

  return (
    <>
      <div className="viewer-sel-section">{label} ({planet.name})</div>
      <div className="viewer-sel-grid">
        <div className="viewer-sel-stat">
          <div className="label">Fill</div>
          <div
            className="value"
            style={{
              color:
                com.fillRatio < 0.15
                  ? "var(--accent-red)"
                  : com.fillRatio > 0.9
                    ? "var(--accent-blue)"
                    : "var(--text-primary)",
            }}
          >
            {Math.round(com.fillRatio * 100)}%
          </div>
        </div>
        <div className="viewer-sel-stat">
          <div className="label">Price</div>
          <div className="value">{com.currentPrice}cr</div>
        </div>
        <div className="viewer-sel-stat">
          <div className="label">Production</div>
          <div className="value">{com.production.toFixed(2)}/t</div>
        </div>
        <div className="viewer-sel-stat">
          <div className="label">Consumption</div>
          <div className="value">{com.consumption.toFixed(2)}/t</div>
        </div>
      </div>
    </>
  );
}

function MarginInfo({
  route,
  planets,
}: {
  route: NpcTradeRoute;
  planets: AdminPlanetMarketState[];
}) {
  const srcPlanet = planets.find((p) => p.planetId === route.sourcePlanet);
  const dstPlanet = planets.find((p) => p.planetId === route.destPlanet);
  const srcCom = srcPlanet?.commodities.find(
    (c) => c.commodityId === route.commodityId,
  );
  const dstCom = dstPlanet?.commodities.find(
    (c) => c.commodityId === route.commodityId,
  );
  if (!srcCom || !dstCom) return null;

  const margin =
    srcCom.currentPrice > 0
      ? ((dstCom.currentPrice - srcCom.currentPrice) / srcCom.currentPrice) *
        100
      : 0;

  return (
    <>
      <div className="viewer-sel-section">Profit Margin</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          fontWeight: 700,
          color:
            margin > 15
              ? "var(--accent-green)"
              : margin > 0
                ? "var(--accent-yellow)"
                : "var(--accent-red)",
          textAlign: "center",
          padding: "8px 0",
        }}
      >
        {margin > 0 ? "+" : ""}
        {margin.toFixed(1)}%
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-dim)",
          textAlign: "center",
        }}
      >
        Buy {srcCom.currentPrice}cr → Sell {dstCom.currentPrice}cr
      </div>
    </>
  );
}
