/**
 * Infrastructure Health — full EconomyRegion DO observability.
 *
 * Monitors: alarm health, tick performance, SQLite storage,
 * R2 write tracking, price history growth, anomaly detection.
 */

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { AdminInfraHealth, EconomyDiagnostics } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import {
  Activity,
  Database,
  HardDrive,
  RefreshCw,
  DollarSign,
  Clock,
  Zap,
  AlertTriangle,
  Timer,
  BarChart3,
  ShieldAlert,
  HelpCircle,
  Copy,
  Check,
} from "lucide-react";

/* ── Inline Help Tooltip (portal-based, same pattern as RegionDetail) ── */

function Tip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; flipped: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !iconRef.current) { setPos(null); return; }
    const rect = iconRef.current.getBoundingClientRect();
    const bubbleW = 280;
    let left = rect.left + rect.width / 2 - bubbleW / 2;
    if (left < 8) left = 8;
    if (left + bubbleW > window.innerWidth - 8) left = window.innerWidth - bubbleW - 8;
    setPos({ top: rect.top - 8, left, flipped: false });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !pos || !bubbleRef.current || !iconRef.current) return;
    const iconRect = iconRef.current.getBoundingClientRect();
    const bubbleH = bubbleRef.current.offsetHeight;
    const flipped = iconRect.top - bubbleH - 8 < 0;
    const top = flipped ? iconRect.bottom + 8 : iconRect.top - bubbleH - 8;
    if (pos.top !== top || pos.flipped !== flipped) {
      setPos(prev => prev ? { top, left: prev.left, flipped } : null);
    }
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (iconRef.current && !iconRef.current.contains(e.target as Node) &&
        bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const arrowLeft = (iconRef.current && pos)
    ? iconRef.current.getBoundingClientRect().left + iconRef.current.getBoundingClientRect().width / 2 - pos.left
    : 140;

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 4, verticalAlign: "middle" }} ref={iconRef}>
      <span
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", color: "var(--text-dim)", cursor: "help", opacity: 0.5, transition: "opacity 0.15s" }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        <HelpCircle size={11} />
      </span>
      {open && pos && createPortal(
        <div
          ref={bubbleRef}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: 280,
            padding: "8px 10px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border-active)",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            fontFamily: "var(--font-sans, -apple-system, sans-serif)",
            fontSize: "11.5px",
            lineHeight: 1.55,
            color: "var(--text-primary)",
            zIndex: 10000,
            pointerEvents: "auto",
            whiteSpace: "normal",
            textTransform: "none" as const,
            letterSpacing: "normal",
            fontWeight: 400,
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {text}
          <span style={{
            position: "absolute",
            ...(pos.flipped
              ? { top: "auto", bottom: "100%", borderTop: "5px solid transparent", borderBottom: "5px solid var(--border-active)" }
              : { top: "100%", borderTop: "5px solid var(--border-active)", borderBottom: "none" }),
            left: arrowLeft,
            transform: "translateX(-50%)",
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            pointerEvents: "none",
          }} />
        </div>,
        document.body
      )}
    </span>
  );
}

/* ── Section help text definitions ── */

const INFRA_HELP = {
  system: "High-level overview of the economy worker. Worker = deployed version, Alarm = Durable Object alarm that fires the economy tick, Warmup = whether initial data has been loaded from SQLite.",
  tick: "The economy runs on a 60-second tick. Each tick processes production, consumption, trade routes, and market pricing for all planets. 'Last Tick' shows when the most recent tick fired. Gaps indicate the alarm didn't fire on schedule — usually caused by a worker redeployment or Cloudflare outage.",
  perf: "Execution time for each tick. Most ticks complete in <100ms. Spikes above 200ms (yellow) or 500ms (red) may indicate SQLite contention or expensive calculations. P95 = 95th percentile (only 5% of ticks are slower).",
  sqlite: "The Durable Object uses SQLite for persistent storage. Row counts shown against soft limits.\n\n• OK = well within limit\n• WATCH = count above soft target (normal for auto-pruned tables like tick_log — it prunes every cycle but may briefly exceed the target between runs)\n• HIGH = rows significantly above limit — investigate pruning\n\ntick_log auto-prunes to ~1,000 entries every tick. Seeing 1,020–1,060 with WATCH is completely normal and not an action item.",
  history: "Price history stores one row per commodity per tick. Data is pruned to the retention window (24h). If 'Data Span' exceeds 'Prune At', the pruning logic may have a bug.",
  r2: "R2 (Cloudflare object storage) stores a JSON snapshot of the full economy state. This is the public API data. Writes happen every N ticks. If 'Last Write' is stale (>10m), the frontend may show outdated data.",
  memory: "In-memory state loaded at warmup. These numbers should match what you see in the Economy tab. If they look wrong, the DO may need a restart.",
  cost: "Cost projections based on ACTUAL live metrics from this region: real tick count, real R2 write frequency, and real request volume. Calculations use Cloudflare's published per-unit pricing (Durable Objects: $0.15/M requests, R2: $0.36/M writes, R2 storage: $0.015/GB). The free tier (100K DO requests, 1M R2 writes) covers most of this.",
};

export function InfraHealth() {
  const [health, setHealth] = useState<AdminInfraHealth | null>(null);
  const [diag, setDiag] = useState<EconomyDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [copied, setCopied] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [h, d] = await Promise.allSettled([
        api.getInfraHealth(),
        api.getDiagnostics("core-worlds"),
      ]);
      if (h.status === "fulfilled") setHealth(h.value);
      if (d.status === "fulfilled") setDiag(d.value);
      if (h.status === "rejected" && d.status === "rejected") {
        throw h.reason;
      }
      setLastRefresh(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 15_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1000, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700 }}>
          <Activity size={20} style={{ marginRight: 8, verticalAlign: -3 }} />
          Infrastructure Health
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const payload: Record<string, unknown> = {
                timestamp: new Date().toISOString(),
                region: "core-worlds",
              };
              if (diag) {
                payload.tick = { number: diag.tick.number, intervalMs: diag.tick.intervalMs, alarmHealth: diag.tick.alarmHealth, lastTickAgo: formatAgo(diag.tick.timeSinceLastTickMs) };
                payload.tickPerformance = { avgMs: diag.tickPerformance.avgMs, minMs: diag.tickPerformance.minMs, maxMs: diag.tickPerformance.maxMs, p95Ms: diag.tickPerformance.p95Ms, samples: diag.tickPerformance.sampleSize };
                payload.sqlite = diag.sqlite;
                payload.priceHistory = diag.priceHistory;
                payload.r2 = { ...diag.r2, lastWriteAgo: formatAgo(diag.r2.timeSinceLastWriteMs) };
                payload.memory = diag.memory;
                payload.anomalies = diag.anomalies;
                payload.warmupComplete = diag.warmupComplete;
                payload.healthy = diag.healthy;
              }
              if (health) {
                payload.workerVersion = health.workerVersion;
              }
              navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            disabled={!health && !diag}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button className="btn btn-ghost" onClick={fetchAll} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: "var(--accent-red)", marginBottom: "1rem" }}>
          <AlertTriangle size={14} style={{ marginRight: 6 }} />
          {error}
        </div>
      )}

      {!health && !diag && !error && (
        <div className="panel" style={{ textAlign: "center", padding: "3rem" }}>
          Loading infrastructure status...
        </div>
      )}

      {/* ─── Anomaly Banner ─── */}
      {diag && diag.anomalies.length > 0 && (
        <div
          className="panel"
          style={{
            borderColor: "var(--accent-red)",
            marginBottom: "1rem",
            background: "color-mix(in srgb, var(--accent-red) 6%, transparent)",
          }}
        >
          <h3 style={{ marginBottom: "0.5rem", fontSize: "0.95rem", color: "var(--accent-red)" }}>
            <ShieldAlert size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            {diag.anomalies.length} ANOMAL{diag.anomalies.length === 1 ? "Y" : "IES"} DETECTED
          </h3>
          {diag.anomalies.map((a, i) => (
            <div
              key={i}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.78rem",
                padding: "4px 0",
                color: "var(--accent-red)",
              }}
            >
              {a}
            </div>
          ))}
        </div>
      )}

      {/* ─── Overall Status ─── */}
      {(health || diag) && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
            <Zap size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            System Status
            <Tip text={INFRA_HELP.system} />
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
            <StatCard label="Worker" value={health?.workerVersion || "—"} />
            <StatCard
              label="Alarm"
              value={
                <StatusBadge
                  status={alarmStatusColor(diag?.tick.alarmHealth || health?.economy.tickHealth || "stopped")}
                  label={(diag?.tick.alarmHealth || health?.economy.tickHealth || "stopped").toUpperCase()}
                />
              }
            />
            <StatCard
              label="Warmup"
              value={diag?.warmupComplete ?? health?.economy.warmupComplete ? "COMPLETE" : "PENDING"}
              warn={!(diag?.warmupComplete ?? health?.economy.warmupComplete)}
            />
            <StatCard
              label="Overall"
              value={
                diag ? (
                  <StatusBadge
                    status={diag.healthy ? "green" : "red"}
                    label={diag.healthy ? "HEALTHY" : "ISSUES"}
                  />
                ) : "—"
              }
            />
          </div>
        </div>
      )}

      {/* ─── Alarm & Tick Health ─── */}
      {diag && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
            <Timer size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            Alarm & Tick Health
            <Tip text={INFRA_HELP.tick} />
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
            <StatCard
              label="Last Tick"
              value={diag.tick.lastTickAt > 0 ? formatAgo(diag.tick.timeSinceLastTickMs) : "never"}
              warn={diag.tick.timeSinceLastTickMs > 90_000}
              crit={diag.tick.timeSinceLastTickMs > 180_000}
            />
            <StatCard label="Tick #" value={diag.tick.number.toLocaleString()} />
            <StatCard label="Interval" value={`${diag.tick.intervalMs / 1000}s`} />
            <StatCard
              label="Tick Gaps"
              value={diag.tickGaps.length === 0 ? "None" : `${diag.tickGaps.length} gaps`}
              warn={diag.tickGaps.length > 0}
              crit={diag.tickGaps.length > 3}
            />
          </div>

          {/* Tick gap details */}
          {diag.tickGaps.length > 0 && (
            <div style={{ marginTop: "0.75rem", padding: "0.5rem", background: "color-mix(in srgb, var(--accent-yellow) 5%, transparent)", borderRadius: 4 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--accent-yellow)", marginBottom: 4 }}>
                ALARM GAPS DETECTED (expected 60s between ticks):
              </div>
              {diag.tickGaps.map((g, i) => (
                <div key={i} style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-dim)" }}>
                  Tick #{g.tick}: {(g.gapMs / 1000).toFixed(0)}s gap
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Tick Performance ─── */}
      {diag && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
            <BarChart3 size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            Tick Performance (last {diag.tickPerformance.sampleSize} ticks)
            <Tip text={INFRA_HELP.perf} />
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <StatCard label="Avg" value={`${diag.tickPerformance.avgMs.toFixed(1)}ms`} warn={diag.tickPerformance.avgMs > 200} />
            <StatCard label="Min" value={`${diag.tickPerformance.minMs}ms`} />
            <StatCard label="Max" value={`${diag.tickPerformance.maxMs}ms`} warn={diag.tickPerformance.maxMs > 500} crit={diag.tickPerformance.maxMs > 1000} />
            <StatCard label="P95" value={`${diag.tickPerformance.p95Ms}ms`} warn={diag.tickPerformance.p95Ms > 300} crit={diag.tickPerformance.p95Ms > 500} />
          </div>

          {/* Tick duration chart */}
          {diag.tickPerformance.trend.length > 1 && (
            <TickDurationChart data={diag.tickPerformance.trend} />
          )}
        </div>
      )}

      {/* ─── SQLite Storage ─── */}
      {diag && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
            <Database size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            SQLite Storage
            <Tip text={INFRA_HELP.sqlite} />
          </h3>
          <table style={{ width: "100%", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Table</th>
                <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Rows</th>
                <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Limit</th>
                <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(diag.sqlite.tables).map(([table, rows]) => {
                const { limit, warn, crit } = tableThresholds(table, rows);
                const statusTitle = crit
                  ? `${table}: ${rows.toLocaleString()} rows — significantly above limit, investigate pruning`
                  : warn
                    ? table === "tick_log"
                      ? `tick_log: ${rows.toLocaleString()} rows — auto-prunes to ~1,000 each tick, this is normal`
                      : `${table}: ${rows.toLocaleString()} rows — above soft limit, monitor`
                    : `${table}: ${rows.toLocaleString()} rows — within normal range`;
                return (
                  <tr key={table}>
                    <td style={{ padding: "0.3rem 0.5rem", fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{table}</td>
                    <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontFamily: "var(--font-mono)" }}>{rows.toLocaleString()}</td>
                    <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>{limit}</td>
                    <td style={{ padding: "0.3rem 0.5rem" }} title={statusTitle}>
                      <StatusBadge status={crit ? "red" : warn ? "yellow" : "green"} label={crit ? "HIGH" : warn ? "WATCH" : "OK"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "0.4rem 0.5rem", fontWeight: 600 }}>Total</td>
                <td style={{ textAlign: "right", padding: "0.4rem 0.5rem", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  {diag.sqlite.totalRows.toLocaleString()}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ─── Price History ─── */}
      {diag && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
            <Clock size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            Price History Retention
            <Tip text={INFRA_HELP.history} />
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
            <StatCard label="Rows" value={diag.priceHistory.rowCount.toLocaleString()} warn={diag.priceHistory.rowCount > 50_000} />
            <StatCard
              label="Data Span"
              value={`${diag.priceHistory.spanHours.toFixed(1)}h`}
              warn={diag.priceHistory.spanHours > 24}
            />
            <StatCard label="Prune At" value={`${diag.priceHistory.pruneThresholdHours}h`} />
            <StatCard
              label="Pruning"
              value={
                <StatusBadge
                  status={diag.priceHistory.spanHours <= diag.priceHistory.pruneThresholdHours + 1 ? "green" : "red"}
                  label={diag.priceHistory.spanHours <= diag.priceHistory.pruneThresholdHours + 1 ? "OK" : "STALE"}
                />
              }
            />
          </div>
        </div>
      )}

      {/* ─── R2 Write Health ─── */}
      {diag && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
            <HardDrive size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            R2 Snapshot Writes
            <Tip text={INFRA_HELP.r2} />
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
            <StatCard
              label="Last Write"
              value={diag.r2.lastWriteAt > 0 ? formatAgo(diag.r2.timeSinceLastWriteMs) : "never"}
              warn={diag.r2.timeSinceLastWriteMs > 600_000}
              crit={diag.r2.timeSinceLastWriteMs > 900_000}
            />
            <StatCard label="Frequency" value={`Every ${diag.r2.snapshotEveryNTicks} ticks`} />
            <StatCard label="Recent Writes" value={`${diag.r2.recentWriteCount} / ${diag.tickPerformance.sampleSize}`} />
            <StatCard
              label="Write Rate"
              value={`${diag.r2.writeRatePercent.toFixed(0)}%`}
              warn={diag.r2.writeRatePercent < 15}
            />
          </div>
        </div>
      )}

      {/* ─── In-Memory State ─── */}
      {diag && (
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <h3 style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
            <Zap size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            In-Memory State
            <Tip text={INFRA_HELP.memory} />
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem" }}>
            <StatCard label="Planets" value={diag.memory.planets} />
            <StatCard label="Commodity Slots" value={diag.memory.totalCommoditySlots} />
            <StatCard label="Trade Routes" value={diag.memory.tradeRoutes} />
            <StatCard label="Active Disruptions" value={diag.disruptions.active} />
          </div>
        </div>
      )}

      {/* ─── Cost Estimator ─── */}
      {health && <CostEstimator health={health} diag={diag} />}

      {/* ─── Footer ─── */}
      <div style={{ textAlign: "center", marginTop: "1rem", fontSize: "0.75rem", color: "var(--text-dim)" }}>
        <Clock size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
        Last refresh: {lastRefresh > 0 ? new Date(lastRefresh).toLocaleTimeString() : "—"}
        {" · "}Auto-refresh: 15s
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function StatCard({
  label,
  value,
  warn,
  crit,
}: {
  label: string;
  value: React.ReactNode;
  warn?: boolean;
  crit?: boolean;
}) {
  const borderColor = crit
    ? "var(--accent-red)"
    : warn
      ? "var(--accent-yellow)"
      : undefined;
  const textColor = crit
    ? "var(--accent-red)"
    : warn
      ? "var(--accent-yellow)"
      : undefined;

  return (
    <div className="stat-card" style={borderColor ? { borderColor } : undefined}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={textColor ? { color: textColor } : undefined}>
        {value}
      </div>
    </div>
  );
}

function TickDurationChart({ data }: { data: { tick: number; ms: number }[] }) {
  const width = 700;
  const height = 120;
  const pad = { top: 10, right: 10, bottom: 20, left: 45 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const values = data.map((d) => d.ms);
  const maxMs = Math.max(...values, 50); // minimum 50ms scale
  const barWidth = Math.max(2, Math.min(12, chartW / data.length - 1));

  // Threshold lines
  const warnThreshold = 200;
  const critThreshold = 500;

  return (
    <svg width={width} height={height} style={{ display: "block", margin: "0 auto" }}>
      {/* Threshold lines */}
      {[warnThreshold, critThreshold].map((threshold) => {
        if (threshold > maxMs) return null;
        const y = pad.top + ((maxMs - threshold) / maxMs) * chartH;
        return (
          <g key={threshold}>
            <line
              x1={pad.left}
              y1={y}
              x2={width - pad.right}
              y2={y}
              stroke={threshold === critThreshold ? "var(--accent-red)" : "var(--accent-yellow)"}
              strokeWidth={0.5}
              strokeDasharray="4 3"
              opacity={0.5}
            />
            <text
              x={pad.left - 4}
              y={y + 3}
              textAnchor="end"
              fill={threshold === critThreshold ? "var(--accent-red)" : "var(--accent-yellow)"}
              fontSize={8}
              fontFamily="var(--font-mono)"
              opacity={0.7}
            >
              {threshold}ms
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const x = pad.left + (i / data.length) * chartW;
        const barH = (d.ms / maxMs) * chartH;
        const y = pad.top + chartH - barH;
        const color =
          d.ms > critThreshold
            ? "var(--accent-red)"
            : d.ms > warnThreshold
              ? "var(--accent-yellow)"
              : "var(--accent-green)";

        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barH}
            fill={color}
            opacity={0.8}
            rx={1}
          >
            <title>Tick #{d.tick}: {d.ms}ms</title>
          </rect>
        );
      })}

      {/* Y axis labels */}
      {[0, maxMs / 2, maxMs].map((v) => {
        const y = pad.top + ((maxMs - v) / maxMs) * chartH;
        return (
          <text
            key={v}
            x={pad.left - 4}
            y={y + 3}
            textAnchor="end"
            fill="var(--text-dim)"
            fontSize={8}
            fontFamily="var(--font-mono)"
          >
            {Math.round(v)}
          </text>
        );
      })}

      {/* X axis label */}
      <text
        x={width / 2}
        y={height - 2}
        textAnchor="middle"
        fill="var(--text-dim)"
        fontSize={8}
        fontFamily="var(--font-mono)"
      >
        Tick Duration (ms) — last {data.length} ticks
      </text>
    </svg>
  );
}

function CostEstimator({
  health,
  diag,
}: {
  health: AdminInfraHealth;
  diag: EconomyDiagnostics | null;
}) {
  const ticksPerDay = 1440;
  const ticksPerMonth = ticksPerDay * 30;

  // R2 writes from actual data if available
  const r2WritesPerDay = diag
    ? (ticksPerDay / (diag.r2.snapshotEveryNTicks || 5))
    : health.r2.snapshotIntervalMs > 0
      ? 86_400_000 / health.r2.snapshotIntervalMs
      : 0;
  const r2WritesPerMonth = r2WritesPerDay * 30;

  const doRequestsPerMonth = ticksPerMonth + 3000;
  const doCost = (doRequestsPerMonth / 1_000_000) * 0.15;
  const r2WriteCost = (r2WritesPerMonth / 1_000_000) * 0.36;
  const r2StorageCost = 0.001;
  const totalEstimate = doCost + r2WriteCost + r2StorageCost;

  return (
    <div className="panel" style={{ marginBottom: "1rem" }}>
      <h3 style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>
        <DollarSign size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
        Estimated Monthly Cost
        <Tip text={INFRA_HELP.cost} />
      </h3>
      <table style={{ width: "100%", fontSize: "0.82rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Service</th>
            <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Usage/mo</th>
            <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Est. Cost</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: "0.3rem 0.5rem" }}>Durable Objects</td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontFamily: "var(--font-mono)" }}>
              {doRequestsPerMonth.toLocaleString()} req
            </td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontFamily: "var(--font-mono)" }}>
              ${doCost.toFixed(4)}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "0.3rem 0.5rem" }}>R2 Writes</td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontFamily: "var(--font-mono)" }}>
              {Math.round(r2WritesPerMonth).toLocaleString()} ops
            </td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontFamily: "var(--font-mono)" }}>
              ${r2WriteCost.toFixed(4)}
            </td>
          </tr>
          <tr>
            <td style={{ padding: "0.3rem 0.5rem" }}>R2 Storage</td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontFamily: "var(--font-mono)" }}>
              ~5 KB
            </td>
            <td style={{ textAlign: "right", padding: "0.3rem 0.5rem", fontFamily: "var(--font-mono)" }}>
              ${r2StorageCost.toFixed(4)}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "1px solid var(--border)" }}>
            <td style={{ padding: "0.45rem 0.5rem", fontWeight: 700 }} colSpan={2}>
              Total (Phase 1 — 1 region)
            </td>
            <td style={{ textAlign: "right", padding: "0.45rem 0.5rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--accent-green)" }}>
              ${totalEstimate.toFixed(4)}
            </td>
          </tr>
        </tfoot>
      </table>
      <div style={{ marginTop: "0.6rem", fontSize: "0.68rem", color: "var(--text-dim)", fontStyle: "italic" }}>
        Projections based on live metrics from this region × Cloudflare published per-unit pricing. Free tier covers most of this usage.
      </div>
    </div>
  );
}

/* ── Helpers ── */

function formatAgo(ms: number): string {
  if (ms < 0) return "just now";
  if (ms < 1000) return "< 1s ago";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${(ms / 3_600_000).toFixed(1)}h ago`;
}

function alarmStatusColor(
  status: string,
): "green" | "yellow" | "red" {
  if (status === "ok") return "green";
  if (status === "delayed") return "yellow";
  return "red";
}

function tableThresholds(
  table: string,
  rows: number,
): { limit: string; warn: boolean; crit: boolean } {
  switch (table) {
    case "price_history":
      // 4 planets × 20 commodities × 288 snapshots/day (every 5 min, 24h retention) = ~23K
      return { limit: "~25K (24h)", warn: rows > 30_000, crit: rows > 50_000 };
    case "tick_log":
      return { limit: "1,000", warn: rows > 1_000, crit: rows > 1_200 };
    case "active_disruptions":
      return { limit: "~10", warn: rows > 10, crit: rows > 20 };
    case "planet_markets":
      return { limit: "~80", warn: rows > 100, crit: rows > 200 };
    case "trade_routes":
      return { limit: "~50", warn: rows > 60, crit: rows > 100 };
    case "meta":
      return { limit: "4", warn: rows > 10, crit: rows > 20 };
    default:
      return { limit: "—", warn: false, crit: false };
  }
}
