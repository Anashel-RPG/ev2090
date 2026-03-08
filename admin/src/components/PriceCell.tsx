import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface PriceCellProps {
  price: number;
  basePrice: number;
  change24h: number;
}

export function PriceCell({ price, basePrice, change24h }: PriceCellProps) {
  const ratio = price / basePrice;
  const color =
    ratio < 0.85
      ? "var(--accent-green)"
      : ratio > 1.15
        ? "var(--accent-red)"
        : "var(--text-primary)";

  return (
    <span className="price-cell" style={{ color }}>
      {price.toFixed(1)}
      <TrendIndicator change={change24h} />
    </span>
  );
}

function TrendIndicator({ change }: { change: number }) {
  if (change > 2) {
    return (
      <span className="trend-icon up">
        <TrendingUp size={10} />
      </span>
    );
  }
  if (change < -2) {
    return (
      <span className="trend-icon down">
        <TrendingDown size={10} />
      </span>
    );
  }
  return (
    <span className="trend-icon flat">
      <Minus size={10} />
    </span>
  );
}

export function FillBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  const color =
    ratio < 0.25
      ? "var(--accent-red)"
      : ratio > 0.75
        ? "var(--accent-green)"
        : "var(--accent-blue)";

  return (
    <span className="fill-bar-wrap">
      <span
        className="fill-bar-inner"
        style={{ width: `${pct}%`, background: color }}
      />
      <span className="fill-bar-text">{pct}%</span>
      <style>{`
        .fill-bar-wrap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          width: 80px;
        }
        .fill-bar-inner {
          height: 4px;
          border-radius: 2px;
          flex: 1;
          position: relative;
        }
        .fill-bar-wrap {
          position: relative;
          background: var(--border);
          border-radius: 2px;
          height: 4px;
          width: 50px;
          display: inline-block;
          vertical-align: middle;
          margin-right: 6px;
        }
        .fill-bar-inner {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          border-radius: 2px;
        }
        .fill-bar-text {
          font-size: 10px;
          color: var(--text-secondary);
        }
      `}</style>
    </span>
  );
}
