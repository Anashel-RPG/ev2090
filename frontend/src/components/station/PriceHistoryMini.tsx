/**
 * PriceHistoryMini — OHLC candle chart for individual commodity in planet view.
 * Fetches price history from the public market API and renders hourly candles
 * over the last 6 hours. Replaces the simple supply bar with a real chart.
 *
 * Shows: OHLC candles (price), supply label, current price.
 */
import React, { useState, useEffect, useRef } from "react";

// ── API ──

import { API_BASE } from "@/config/urls";
const MARKET_API = `${API_BASE}/api/market`;

interface PriceHistoryPoint {
  price: number;
  fillRatio: number;
  timestamp: number;
}

interface PriceHistoryResponse {
  points: PriceHistoryPoint[];
  warmupCompletedAt: number;
}

// ── OHLC ──

interface OHLCBucket {
  open: number;
  high: number;
  low: number;
  close: number;
  avgFill: number;
  timestamp: number;
  count: number;
}

function aggregateToOHLC(
  points: PriceHistoryPoint[],
  bucketMs: number,
): OHLCBucket[] {
  if (points.length === 0) return [];

  const first = points[0]!;
  const buckets: OHLCBucket[] = [];
  let bucketStart = Math.floor(first.timestamp / bucketMs) * bucketMs;
  let bucket: OHLCBucket = {
    open: first.price,
    high: first.price,
    low: first.price,
    close: first.price,
    avgFill: 0,
    timestamp: bucketStart,
    count: 0,
  };
  let fillSum = 0;

  for (const pt of points) {
    const ptBucket = Math.floor(pt.timestamp / bucketMs) * bucketMs;

    if (ptBucket !== bucketStart) {
      bucket.avgFill = bucket.count > 0 ? fillSum / bucket.count : 0;
      buckets.push(bucket);

      bucketStart = ptBucket;
      bucket = {
        open: pt.price,
        high: pt.price,
        low: pt.price,
        close: pt.price,
        avgFill: 0,
        timestamp: ptBucket,
        count: 0,
      };
      fillSum = 0;
    }

    bucket.high = Math.max(bucket.high, pt.price);
    bucket.low = Math.min(bucket.low, pt.price);
    bucket.close = pt.price;
    bucket.count++;
    fillSum += pt.fillRatio;
  }

  bucket.avgFill = bucket.count > 0 ? fillSum / bucket.count : 0;
  buckets.push(bucket);

  return buckets;
}

// ── Component ──

interface PriceHistoryMiniProps {
  planetId: string;
  commodityId: string;
  fillRatio: number;
  price: number;
  unitSize: number;
}

const fmtPrice = (n: number) =>
  n >= 1000
    ? n.toLocaleString("en", { maximumFractionDigits: 0 })
    : n.toFixed(1);

const tc = (fill: number) =>
  fill < 0.3 ? "#ff4466" : fill > 0.7 ? "#00e87a" : "rgba(150,170,190,0.35)";

export const PriceHistoryMini: React.FC<PriceHistoryMiniProps> = ({
  planetId,
  commodityId,
  fillRatio,
  price,
  unitSize,
}) => {
  const [candles, setCandles] = useState<OHLCBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(0);

  useEffect(() => {
    const id = ++fetchRef.current;
    setLoading(true);

    fetch(
      `${MARKET_API}/history?planet=${planetId}&commodity=${commodityId}&hours=6`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PriceHistoryResponse | null) => {
        if (id !== fetchRef.current) return; // stale
        if (data && data.points.length >= 2) {
          // 30-min buckets for 6h = up to 12 candles
          setCandles(aggregateToOHLC(data.points, 30 * 60_000));
        } else {
          setCandles([]);
        }
      })
      .catch(() => {
        if (id === fetchRef.current) setCandles([]);
      })
      .finally(() => {
        if (id === fetchRef.current) setLoading(false);
      });
  }, [planetId, commodityId]);

  const W = 388;
  const H = 68;
  const PAD_B = 14;
  const PAD_L = 0;
  const PAD_R = 0;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - 2; // small top/bottom padding

  const color = tc(fillRatio);
  const fillPct = Math.round(fillRatio * 100);
  const supplyLabel =
    fillRatio < 0.25
      ? "SCARCE"
      : fillRatio < 0.5
        ? "LOW"
        : fillRatio < 0.75
          ? "NORMAL"
          : "SURPLUS";

  // ── Y-axis scaling with padding (same logic as admin chart) ──
  const allPrices =
    candles.length > 0 ? candles.flatMap((c) => [c.high, c.low]) : [price];
  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const midP = (rawMin + rawMax) / 2;
  const minRange = midP * 0.2;
  const effectiveRange = Math.max(rawMax - rawMin, minRange);
  const maxP = midP + effectiveRange * 0.65;
  const minP = Math.max(0, midP - effectiveRange * 0.65);
  const pRange = maxP - minP || 1;

  const yPrice = (p: number) =>
    1 + ((maxP - p) / pRange) * chartH;

  return (
    <div style={{ position: "relative" }}>
      {/* Price + unit info overlay (top right) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          fontWeight: 700,
          color,
          textShadow: `0 0 10px ${color}`,
          zIndex: 1,
        }}
      >
        {fmtPrice(price)} CR
      </div>
      <div
        style={{
          position: "absolute",
          top: 14,
          right: 0,
          fontFamily: "var(--font-mono)",
          fontSize: "8px",
          color: "rgba(150,170,190,0.3)",
          zIndex: 1,
        }}
      >
        {unitSize}t/unit
      </div>

      <svg
        width="100%"
        height={H + PAD_B}
        viewBox={`0 0 ${W} ${H + PAD_B}`}
        preserveAspectRatio="none"
      >
        {/* Subtle grid lines */}
        {[0.25, 0.5, 0.75].map((pct) => (
          <line
            key={pct}
            x1={0}
            y1={1 + pct * chartH}
            x2={W}
            y2={1 + pct * chartH}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="1"
          />
        ))}

        {loading ? (
          /* Loading indicator */
          <text
            x={W / 2}
            y={H / 2 + 4}
            textAnchor="middle"
            fill="rgba(150,170,190,0.25)"
            fontSize="9"
            fontFamily="monospace"
          >
            Loading...
          </text>
        ) : candles.length >= 2 ? (
          /* OHLC Candles */
          <>
            {candles.map((c, i) => {
              const candleW = Math.max(
                4,
                (chartW / candles.length) * 0.55,
              );
              const x =
                PAD_L +
                ((i + 0.5) / candles.length) * chartW;
              const isUp = c.close >= c.open;
              const cColor = isUp ? "#00e87a" : "#ff4466";

              const bodyTop = yPrice(Math.max(c.open, c.close));
              const bodyBot = yPrice(Math.min(c.open, c.close));
              const bodyH = Math.max(1.5, bodyBot - bodyTop);
              const wickTop = yPrice(c.high);
              const wickBot = yPrice(c.low);

              return (
                <g key={i} opacity={0.8}>
                  <line
                    x1={x}
                    y1={wickTop}
                    x2={x}
                    y2={wickBot}
                    stroke={cColor}
                    strokeWidth={1}
                  />
                  <rect
                    x={x - candleW / 2}
                    y={bodyTop}
                    width={candleW}
                    height={bodyH}
                    fill={cColor}
                    stroke={cColor}
                    strokeWidth={0.5}
                    rx={0.5}
                  />
                </g>
              );
            })}
            {/* Time labels */}
            {(() => {
              const firstCandle = candles[0];
              const lastCandle = candles[candles.length - 1];
              if (!firstCandle || !lastCandle) return null;
              return (
                <>
                  <text
                    x={PAD_L + 2}
                    y={H + PAD_B - 2}
                    fill="rgba(255,255,255,0.15)"
                    fontSize="7"
                    fontFamily="monospace"
                  >
                    {new Date(firstCandle.timestamp).toLocaleTimeString(
                      [],
                      { hour: "2-digit", minute: "2-digit" },
                    )}
                  </text>
                  <text
                    x={W - PAD_R - 2}
                    y={H + PAD_B - 2}
                    textAnchor="end"
                    fill="rgba(255,255,255,0.15)"
                    fontSize="7"
                    fontFamily="monospace"
                  >
                    {new Date(lastCandle.timestamp).toLocaleTimeString(
                      [],
                      { hour: "2-digit", minute: "2-digit" },
                    )}
                  </text>
                </>
              );
            })()}
          </>
        ) : (
          /* No data fallback — show supply bar */
          <>
            <rect
              x={0}
              y={H * 0.3}
              width={W}
              height={H * 0.4}
              fill="rgba(255,255,255,0.03)"
              rx={2}
            />
            <rect
              x={0}
              y={H * 0.3}
              width={W * fillRatio}
              height={H * 0.4}
              fill={color}
              opacity={0.25}
              rx={2}
            />
          </>
        )}

        {/* Supply label at bottom center */}
        <text
          x={W / 2}
          y={H + PAD_B - 2}
          textAnchor="middle"
          fill="rgba(150,170,190,0.25)"
          fontSize="7.5"
          fontFamily="monospace"
        >
          {supplyLabel} ({fillPct}%) {candles.length >= 2 ? "· 6H" : ""}
        </text>
      </svg>
    </div>
  );
};
