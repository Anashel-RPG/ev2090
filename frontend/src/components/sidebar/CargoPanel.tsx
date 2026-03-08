/** CargoPanel — sidebar cargo/credits display with expandable manifest + ledger. */
import { useState, useMemo } from "react";
import type { CargoItem, MarketSnapshot, TradeTransaction } from "@/types/economy";
import { COMMODITY_MAP } from "@/data/commodities";
import "./CargoPanel.css";

interface Props {
  credits: number;
  cargo: CargoItem[];
  cargoWeight: number;
  cargoCapacity: number;
  transactions: TradeTransaction[];
  marketSnapshot: MarketSnapshot | null;
}

function fmtCR(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString("en", { maximumFractionDigits: 0 });
}

function fmtWeight(t: number): string {
  return t % 1 === 0 ? String(t) : t.toFixed(1);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function CargoPanel({ credits, cargo, cargoWeight, cargoCapacity, transactions, marketSnapshot }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const pct = cargoCapacity > 0 ? Math.round((cargoWeight / cargoCapacity) * 100) : 0;
  const barColor = pct < 60 ? "bar-green" : pct < 85 ? "bar-yellow" : "bar-red";

  // Compute manifest with current market values
  const manifest = useMemo(() => {
    return cargo.map(item => {
      const comm = COMMODITY_MAP.get(item.commodityId);
      // Try to get a current market price (use first planet that has it)
      let currentPrice = item.avgBuyPrice;
      if (marketSnapshot) {
        for (const planet of Object.values(marketSnapshot.planets)) {
          const mp = planet.commodities[item.commodityId];
          if (mp) { currentPrice = mp.price; break; }
        }
      }
      const totalValue = item.quantity * currentPrice;
      const totalCost = item.quantity * item.avgBuyPrice;
      return {
        commodityId: item.commodityId,
        name: comm?.name ?? item.commodityId,
        icon: comm?.icon ?? "?",
        quantity: item.quantity,
        currentPrice,
        totalValue,
        pnl: totalValue - totalCost,
      };
    });
  }, [cargo, marketSnapshot]);

  const totalValue = manifest.reduce((s, m) => s + m.totalValue, 0);
  const totalPnL = manifest.reduce((s, m) => s + m.pnl, 0);

  const recentTx = transactions.slice(0, 10);

  return (
    <div className="panel">
      <div className="panel-body">
        {/* Cargo row — clickable to expand */}
        <div className="cargo-panel-toggle" onClick={() => setExpanded(prev => !prev)}>
          <span className="cargo-label">CARGO</span>
          <div className="cargo-value-row">
            <span className="cargo-amount">
              {fmtWeight(cargoWeight)}t / {fmtWeight(cargoCapacity)}t
            </span>
            <span className="cargo-pct">({pct}%)</span>
            <span className="cargo-chevron">{expanded ? "▾" : "▸"}</span>
          </div>
        </div>

        {/* Tiny fill bar */}
        <div className="cargo-bar-track">
          <div
            className={`cargo-bar-fill ${barColor}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>

        {/* Expandable manifest */}
        <div className={`cargo-manifest ${expanded ? "expanded" : "collapsed"}`}>
          <div className="cargo-divider" />

          {cargo.length === 0 ? (
            <div className="cargo-empty">Cargo hold empty</div>
          ) : (
            <>
              {manifest.map(item => (
                <div key={item.commodityId} className="cargo-item-row">
                  <span className="cargo-item-icon">{item.icon}</span>
                  <span className="cargo-item-name">{item.name}</span>
                  <span className="cargo-item-qty">x{item.quantity}</span>
                  <span className="cargo-item-value">{fmtCR(item.totalValue)} CR</span>
                </div>
              ))}

              <div className="cargo-divider" />

              <div className="cargo-summary-row">
                <span className="cargo-summary-label">Cargo value</span>
                <span className="cargo-summary-value">{fmtCR(totalValue)} CR</span>
              </div>
              <div className="cargo-summary-row">
                <span className="cargo-summary-label">Unrealized P&L</span>
                <span className={`cargo-summary-value ${totalPnL >= 0 ? "positive" : "negative"}`}>
                  {totalPnL >= 0 ? "+" : ""}{fmtCR(Math.abs(totalPnL))} CR
                </span>
              </div>
            </>
          )}

          {/* Transaction ledger */}
          {recentTx.length > 0 && (
            <>
              <div className="cargo-divider" />
              <div className="cargo-ledger-toggle" onClick={(e) => { e.stopPropagation(); setLedgerOpen(prev => !prev); }}>
                <span>Recent trades</span>
                <span className="cargo-chevron">{ledgerOpen ? "▾" : "▸"}</span>
              </div>
              {ledgerOpen && recentTx.map(tx => {
                const comm = COMMODITY_MAP.get(tx.commodityId);
                return (
                  <div key={tx.id} className="cargo-tx-row">
                    <span className="cargo-tx-time">{fmtTime(tx.timestamp)}</span>
                    <span className={`cargo-tx-action ${tx.action}`}>{tx.action}</span>
                    <span className="cargo-tx-name">{comm?.name ?? tx.commodityId}</span>
                    <span className={`cargo-tx-amount ${tx.action}`}>
                      {tx.action === "buy" ? "-" : "+"}{fmtCR(tx.total)}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="cargo-divider" />

        {/* Credits row */}
        <div className="status-row">
          <span className="label">CREDITS</span>
          <span className="value accent">{fmtCR(credits)} CR</span>
        </div>

        {/* Net worth */}
        {expanded && (
          <div className="cargo-summary-row" style={{ marginTop: 4 }}>
            <span className="cargo-summary-label">Net worth</span>
            <span className="cargo-summary-value">{fmtCR(credits + totalValue)} CR</span>
          </div>
        )}
      </div>
    </div>
  );
}
