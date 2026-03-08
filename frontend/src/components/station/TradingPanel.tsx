/** Trading panel — resource market with buy/sell orders and price charts. */
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mountain, Wheat, Cpu, Wrench, Gem } from 'lucide-react';
import type { MarketSnapshot, CargoItem } from '@/types/economy';
import { COMMODITIES } from '@/data/commodities';
import type { CommodityCategory } from '@/types/economy';
import { PriceHistoryMini } from './PriceHistoryMini';

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_ICON: Record<CommodityCategory, React.ElementType> = {
  minerals: Mountain,
  food: Wheat,
  tech: Cpu,
  industrial: Wrench,
  luxury: Gem,
};

const CAT_LABELS: { id: string; label: string; category: CommodityCategory | null }[] = [
  { id: 'All',        label: 'All',        category: null },
  { id: 'Minerals',   label: 'Minerals',   category: 'minerals' },
  { id: 'Food',       label: 'Food',       category: 'food' },
  { id: 'Tech',       label: 'Tech',       category: 'tech' },
  { id: 'Industrial', label: 'Indust.',    category: 'industrial' },
  { id: 'Luxury',     label: 'Luxury',     category: 'luxury' },
];

interface TradingPanelProps {
  planetId: string;
  marketSnapshot: MarketSnapshot | null;
  playerCredits: number;
  playerCargo: CargoItem[];
  cargoWeight: number;
  cargoCapacity: number;
  onBuy: (commodityId: string, qty: number, price: number) => void;
  onSell: (commodityId: string, qty: number, price: number) => void;
}

/** Merged commodity item for display */
interface MarketItem {
  id: string;
  name: string;
  category: CommodityCategory;
  price: number;
  fillRatio: number;
  unitSize: number;
  holdings: number;
  icon: string;
}

type Mode = 'pct' | 'cr';

const tc = (fill: number) => fill < 0.3 ? '#ff4466' : fill > 0.7 ? '#00e87a' : 'rgba(150,170,190,0.35)';

const fmtCR = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M'
  : n >= 1000 ? (n / 1000).toFixed(1) + 'k'
  : n.toFixed(0);

const fmtQty = (n: number) =>
  n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));

const fmtPrice = (n: number) =>
  n >= 1000 ? n.toLocaleString('en', { maximumFractionDigits: 0 }) : n.toFixed(1);

// ── Volume Bar Chart ──────────────────────────────────────────────────────────

const VolumeChart = ({ items }: { items: MarketItem[] }) => {
  const W = 388, H = 68, PAD_B = 14;
  if (items.length === 0) return null;
  const maxP = Math.max(1, ...items.map(i => i.price));
  const barW = (W / items.length) - 4;
  return (
    <svg width="100%" height={H + PAD_B} viewBox={`0 0 ${W} ${H + PAD_B}`} preserveAspectRatio="none">
      {[0.33, 0.66, 1].map(pct => (
        <line key={pct} x1={0} y1={H * (1 - pct)} x2={W} y2={H * (1 - pct)}
          stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
      ))}
      {items.map((item, i) => {
        const barH = Math.max(3, (item.price / maxP) * (H - 4));
        const x = i * (W / items.length) + 2;
        const color = tc(item.fillRatio);
        return (
          <g key={item.id}>
            <rect x={x} y={H - barH - 2} width={barW} height={barH + 2} fill={color} opacity={0.08} />
            <rect x={x} y={H - barH} width={barW} height={barH} fill={color} opacity={0.65} rx={1} />
            <text x={x + barW / 2} y={H + PAD_B - 2} textAnchor="middle"
              fill="rgba(255,255,255,0.25)" fontSize="7.5" fontFamily="monospace">
              {item.name.slice(0, 4).toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

// ── Price Display (selected item) ──────────────────────────────────────────
// Replaced by PriceHistoryMini (OHLC candle chart with supply label).
// Kept as reference in case we need a simple fallback.

// ── Mode Toggle ───────────────────────────────────────────────────────────────

const ModeToggle = ({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) => (
  <div style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.10)', overflow: 'hidden', borderRadius: '2px' }}>
    {(['pct', 'cr'] as Mode[]).map(m => (
      <button key={m} onClick={() => onChange(m)} style={{
        padding: '2px 7px',
        fontFamily: 'var(--font-mono)', fontSize: '8px', fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase',
        background: mode === m ? 'rgba(0,200,255,0.18)' : 'transparent',
        color: mode === m ? '#00c8ff' : 'rgba(150,170,190,0.35)',
        border: 'none', cursor: 'pointer', transition: 'all 0.1s',
      }}>{m === 'pct' ? '%' : 'CR'}</button>
    ))}
  </div>
);

// ── Chip ─────────────────────────────────────────────────────────────────────

const Chip = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button onClick={onClick} style={{
    fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 8px',
    border: active ? '1px solid rgba(0,200,255,0.5)' : '1px solid rgba(255,255,255,0.08)',
    background: active ? 'rgba(0,200,255,0.14)' : 'rgba(255,255,255,0.03)',
    color: active ? '#00c8ff' : 'rgba(200,220,240,0.4)',
    cursor: 'pointer', transition: 'all 0.1s', flex: 1,
  }}>{label}</button>
);

// ── Trading Side (reusable for buy/sell) ──────────────────────────────────────

type TradeSideProps = {
  side: 'sell' | 'buy';
  mode: Mode;
  onModeChange: (m: Mode) => void;
  activeChip: number | null;
  onChip: (v: number) => void;
  qtyValue: string;
  onQtyChange: (v: string) => void;
  derivedQty: number;
  unitPrice: number;
  canExecute: boolean;
  caption?: string;
  onExecute: () => void;
};

const TradeSide = ({
  side, mode, onModeChange, activeChip, onChip,
  qtyValue, onQtyChange, derivedQty, unitPrice, canExecute, caption, onExecute,
}: TradeSideProps) => {
  const isBuy = side === 'buy';
  const accent = isBuy ? '#00e87a' : '#ff4466';

  const pctChips  = [0.10, 0.25, 0.50, 1.00];
  const pctLabels = ['10%', '25%', '50%', 'ALL'];
  const crChips   = isBuy
    ? [500, 2_500, 5_000, 10_000]
    : [500, 1_000, 5_000, 10_000];
  const crLabels  = isBuy
    ? ['500', '2.5k', '5k', 'MAX']
    : ['500', '1k', '5k', '10k'];

  const chips  = mode === 'pct' ? pctChips  : crChips;
  const labels = mode === 'pct' ? pctLabels : crLabels;

  const displayQty = qtyValue !== '' ? qtyValue : (activeChip !== null && derivedQty > 0 ? String(derivedQty) : '');

  const totalCR = derivedQty * unitPrice;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
      {/* Header row: label + toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.18em', color: accent, textTransform: 'uppercase' }}>
          {side}
        </span>
        <ModeToggle mode={mode} onChange={onModeChange} />
      </div>

      {/* Quick chips */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {chips.map((v, i) => (
          <Chip key={v} label={labels[i] ?? String(v)} active={activeChip === v} onClick={() => onChip(v)} />
        ))}
      </div>

      {/* Qty input */}
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          placeholder="qty"
          value={displayQty}
          onChange={e => onQtyChange(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            fontFamily: 'var(--font-mono)', fontSize: '13px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
            color: '#fff', padding: '5px 8px', outline: 'none',
          }}
        />
        {derivedQty > 0 && (
          <span style={{
            position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
            fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'rgba(150,170,190,0.35)',
            pointerEvents: 'none',
          }}>
            = {fmtCR(totalCR)} CR
          </span>
        )}
      </div>

      {/* Caption */}
      {caption && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'rgba(150,170,190,0.3)', letterSpacing: '0.05em' }}>
          {caption}
        </div>
      )}

      {/* Execute button */}
      <button
        disabled={!canExecute}
        onClick={canExecute ? onExecute : undefined}
        style={{
          width: '100%', fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.14em', padding: '8px 0',
          background: canExecute
            ? isBuy
              ? 'linear-gradient(180deg, rgba(0,130,65,0.95) 0%, rgba(0,70,35,0.95) 100%)'
              : 'linear-gradient(180deg, rgba(180,0,40,0.95) 0%, rgba(100,0,20,0.95) 100%)'
            : 'rgba(255,255,255,0.03)',
          border: canExecute ? `1px solid ${accent}44` : '1px solid rgba(255,255,255,0.06)',
          color: canExecute ? accent : 'rgba(255,255,255,0.15)',
          cursor: canExecute ? 'pointer' : 'not-allowed',
          boxShadow: canExecute ? `0 0 16px ${accent}22` : 'none',
          transition: 'all 0.15s',
        }}
      >
        {isBuy ? '▲' : '▼'} {side} order
      </button>
    </div>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────

export const TradingPanel = ({
  planetId,
  marketSnapshot,
  playerCredits,
  playerCargo,
  cargoWeight,
  cargoCapacity,
  onBuy,
  onSell,
}: TradingPanelProps) => {
  const [filter, setFilter]     = useState('All');
  const [selected, setSelected] = useState<string | null>(null);

  // Sell state
  const [sellMode, setSellMode]     = useState<Mode>('pct');
  const [sellChip, setSellChip]     = useState<number | null>(null);
  const [sellManual, setSellManual] = useState('');

  // Buy state
  const [buyMode, setBuyMode]     = useState<Mode>('cr');
  const [buyChip, setBuyChip]     = useState<number | null>(null);
  const [buyManual, setBuyManual] = useState('');

  // Build market items from snapshot
  const items: MarketItem[] = useMemo(() => {
    const planetData = marketSnapshot?.planets[planetId];
    if (!planetData) return [];

    return COMMODITIES.reduce<MarketItem[]>((acc, c) => {
        const mp = planetData.commodities[c.id];
        if (!mp) return acc;
        const holding = playerCargo.find(h => h.commodityId === c.id);
        acc.push({
          id: c.id,
          name: c.name,
          category: c.category,
          price: mp.price,
          fillRatio: mp.fillRatio,
          unitSize: c.unitSize,
          holdings: holding?.quantity ?? 0,
          icon: c.icon,
        });
        return acc;
      }, []);
  }, [marketSnapshot, planetId, playerCargo]);

  const filtered = useMemo(() => {
    const catEntry = CAT_LABELS.find(c => c.id === filter);
    if (!catEntry?.category) return items;
    return items.filter(i => i.category === catEntry.category);
  }, [items, filter]);

  const sel = items.find(i => i.id === selected) ?? null;
  const freeCapacity = cargoCapacity - cargoWeight;

  const toggleSelect = (id: string) => {
    setSelected(prev => prev === id ? null : id);
    setSellChip(null); setSellManual('');
    setBuyChip(null);  setBuyManual('');
  };

  // Derived sell qty
  const sellQty = useMemo(() => {
    if (!sel || sel.holdings === 0) return 0;
    if (sellManual !== '') return Math.min(Math.max(0, Math.floor(Number(sellManual) || 0)), sel.holdings);
    if (sellChip === null) return 0;
    if (sellMode === 'pct') return Math.floor(sel.holdings * sellChip);
    return Math.min(Math.floor(sellChip / sel.price), sel.holdings);
  }, [sel, sellMode, sellChip, sellManual]);

  // Derived buy qty (capped by cargo AND cash)
  const { buyQty, maxBuyUnits } = useMemo(() => {
    if (!sel) return { buyQty: 0, maxBuyUnits: 0 };
    const cargoCap = Math.floor(freeCapacity / sel.unitSize);
    const creditCap = Math.floor(playerCredits / sel.price);
    const maxBuy = Math.min(cargoCap, creditCap);

    let qty = 0;
    if (buyManual !== '') {
      qty = Math.min(Math.max(0, Math.floor(Number(buyManual) || 0)), maxBuy);
    } else if (buyChip !== null) {
      if (buyMode === 'pct') qty = Math.floor(maxBuy * buyChip);
      else qty = Math.min(Math.floor(buyChip / sel.price), maxBuy);
    }
    return { buyQty: qty, maxBuyUnits: maxBuy };
  }, [sel, buyMode, buyChip, buyManual, freeCapacity, playerCredits]);

  // No market data state
  if (!marketSnapshot || items.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', gap: '12px' }}
      >
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'rgba(150,170,190,0.4)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {marketSnapshot ? 'No commodities available' : 'Loading market data...'}
        </div>
        {!marketSnapshot && (
          <div style={{ width: '40px', height: '2px', background: 'rgba(0,200,255,0.3)', animation: 'pulse 1.5s ease infinite' }} />
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >

      {/* ── Chart Header ─────────────────────────────── */}
      <div style={{ padding: '12px 16px 6px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,200,255,0.4)', marginBottom: '2px' }}>
              {sel ? sel.category.toUpperCase() : 'Market Prices'}
            </div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: '18px', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
              {sel ? sel.name : 'All Commodities'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#00e87a', boxShadow: '0 0 5px #00e87a', display: 'block' }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', letterSpacing: '0.15em', color: '#00e87a' }}>LIVE</span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={selected ?? 'volume'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {sel ? <PriceHistoryMini planetId={planetId} commodityId={sel.id} fillRatio={sel.fillRatio} price={sel.price} unitSize={sel.unitSize} /> : <VolumeChart items={filtered} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Category Pills ───────────────────────────── */}
      <div style={{ display: 'flex', gap: '4px', padding: '6px 16px', flexShrink: 0, borderTop: '1px solid rgba(0,200,255,0.06)', borderBottom: '1px solid rgba(0,200,255,0.06)' }}>
        {CAT_LABELS.map(cat => {
          const active = filter === cat.id;
          return (
            <button key={cat.id} onClick={() => setFilter(cat.id)} style={{
              flex: 1, fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.1em', padding: '5px 4px',
              border: active ? '1px solid rgba(0,200,255,0.35)' : '1px solid rgba(0,200,255,0.07)',
              background: active ? 'rgba(0,200,255,0.09)' : 'transparent',
              color: active ? '#00c8ff' : 'rgba(150,170,190,0.35)',
              cursor: 'pointer', transition: 'all 0.12s',
            }}>{cat.label}</button>
          );
        })}
      </div>

      {/* ── Column Headers ───────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 76px 52px',
        padding: '5px 16px', gap: '8px', flexShrink: 0,
        fontFamily: 'var(--font-mono)', fontSize: '9px',
        letterSpacing: '0.15em', textTransform: 'uppercase',
        color: 'rgba(0,200,255,0.3)', borderBottom: '1px solid rgba(0,200,255,0.06)',
      }}>
        <span>Commodity</span>
        <span style={{ textAlign: 'right' }}>CR / unit</span>
        <span style={{ textAlign: 'right' }}>Supply</span>
      </div>

      {/* ── Scrollable list + sticky glass action bar ─ */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>

        {/* Commodity rows */}
        {filtered.map(item => {
          const isSel  = selected === item.id;
          const isDim  = selected !== null && !isSel;
          const color  = tc(item.fillRatio);
          const Icon   = CAT_ICON[item.category] ?? Mountain;
          const supplyPct = Math.round(item.fillRatio * 100);
          return (
            <div key={item.id} onClick={() => toggleSelect(item.id)}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 76px 52px',
                padding: '10px 16px', gap: '8px', alignItems: 'center',
                cursor: 'pointer',
                borderLeft: isSel ? '2px solid #f0b429' : '2px solid transparent',
                background: isSel ? 'rgba(240,180,41,0.05)' : 'transparent',
                opacity: isDim ? 0.18 : 1,
                transition: 'opacity 0.2s, background 0.12s, border-color 0.12s',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}
              onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'rgba(0,200,255,0.025)'; }}
              onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                <div style={{
                  width: '26px', height: '26px', borderRadius: '2px', flexShrink: 0,
                  background: isSel ? 'rgba(240,180,41,0.12)' : 'rgba(0,200,255,0.06)',
                  border: isSel ? '1px solid rgba(240,180,41,0.25)' : '1px solid rgba(0,200,255,0.10)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                }}>
                  <Icon size={12} color={isSel ? '#f0b429' : 'rgba(0,200,255,0.5)'} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: '15px', fontWeight: 600, color: '#fff', lineHeight: 1, marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', color: 'rgba(0,200,255,0.3)' }}>
                    {item.category.toUpperCase()}
                    {item.holdings > 0 && <span style={{ color: '#f0b429', marginLeft: 6 }}>x{item.holdings}</span>}
                  </div>
                </div>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: '#e8f4ff', textAlign: 'right', letterSpacing: '-0.02em' }}>
                {fmtPrice(item.price)}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color, textAlign: 'right' }}>
                {supplyPct}%
              </div>
            </div>
          );
        })}

        {/* Spacer behind action bar */}
        {sel && <div style={{ height: '310px' }} />}

        {/* ── Sticky Glass Action Bar ─────────────────── */}
        <AnimatePresence>
          {sel && (
            <motion.div
              key="action"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.22 }}
              style={{
                position: 'sticky', bottom: 0,
                backdropFilter: 'blur(28px) saturate(200%) brightness(0.7)',
                WebkitBackdropFilter: 'blur(28px) saturate(200%) brightness(0.7)',
                background: 'rgba(0, 6, 18, 0.42)',
                borderTop: '1px solid rgba(255,255,255,0.13)',
                boxShadow: '0 -20px 60px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.06)',
                padding: '12px 16px 16px',
              }}
            >
              {/* ── Compact item row ─────────────────────── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                {(() => { const Icon = CAT_ICON[sel.category] ?? Mountain; return <Icon size={13} color="#f0b429" style={{ flexShrink: 0 }} />; })()}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 700, color: '#f0b429' }}>{sel.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'rgba(0,200,255,0.4)', marginLeft: '7px', letterSpacing: '0.1em' }}>{sel.category.toUpperCase()}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'rgba(150,170,190,0.25)', marginLeft: '6px' }}>{fmtPrice(sel.price)} CR</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'rgba(150,170,190,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>own </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700, color: sel.holdings > 0 ? '#00c8ff' : 'rgba(255,255,255,0.18)', flexShrink: 0 }}>
                  {sel.holdings > 0 ? fmtQty(sel.holdings) : '—'}
                </span>
              </div>

              {/* ── Live cargo projection bar ─────────────── */}
              {(() => {
                const usedPct      = cargoCapacity > 0 ? (cargoWeight / cargoCapacity) * 100 : 0;
                const buyAddedT    = buyQty * sel.unitSize;
                const buyAddedPct  = cargoCapacity > 0 ? Math.min((buyAddedT / cargoCapacity) * 100, 100 - usedPct) : 0;
                const sellFreedT   = sellQty * sel.unitSize;
                const sellFreedPct = cargoCapacity > 0 ? Math.min((sellFreedT / cargoCapacity) * 100, usedPct) : 0;
                return (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'rgba(150,170,190,0.28)', letterSpacing: '0.05em' }}>
                        CARGO {cargoWeight.toFixed(1)}t / {cargoCapacity}t
                      </span>
                      {(buyAddedT > 0 || sellFreedT > 0) && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', fontWeight: 700, color: buyAddedT > 0 ? '#f0b429' : '#00e87a', letterSpacing: '0.05em' }}>
                          {buyAddedT > 0 ? `+${buyAddedT.toFixed(1)}t` : `–${sellFreedT.toFixed(1)}t`}
                        </span>
                      )}
                    </div>
                    <div style={{ height: '5px', background: 'rgba(255,255,255,0.06)', position: 'relative', overflow: 'hidden', borderRadius: '2px' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.max(0, usedPct - sellFreedPct)}%`, background: 'rgba(0,200,255,0.4)' }} />
                      {sellFreedPct > 0 && (
                        <motion.div
                          animate={{ opacity: [0.3, 0.9, 0.3] }}
                          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                          style={{ position: 'absolute', left: `${usedPct - sellFreedPct}%`, top: 0, height: '100%', width: `${sellFreedPct}%`, background: '#00e87a', boxShadow: '0 0 6px #00e87a' }}
                        />
                      )}
                      {buyAddedPct > 0 && (
                        <motion.div
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                          style={{ position: 'absolute', left: `${usedPct}%`, top: 0, height: '100%', width: `${buyAddedPct}%`, background: '#f0b429', boxShadow: '0 0 8px #f0b429' }}
                        />
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Divider */}
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', marginBottom: '12px' }} />

              {/* Buy / Sell columns */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', gap: '12px' }}>
                <TradeSide
                  side="sell" mode={sellMode} onModeChange={setSellMode}
                  activeChip={sellChip} onChip={v => { setSellChip(v); setSellManual(''); }}
                  qtyValue={sellManual} onQtyChange={v => { setSellManual(v); setSellChip(null); }}
                  derivedQty={sellQty} unitPrice={sel.price}
                  canExecute={sellQty > 0 && sel.holdings > 0}
                  caption={sellMode === 'pct' ? `of ${fmtQty(sel.holdings)} owned` : `units at market price`}
                  onExecute={() => { onSell(sel.id, sellQty, sel.price); setSellChip(null); setSellManual(''); }}
                />
                <div style={{ background: 'rgba(255,255,255,0.06)' }} />
                <TradeSide
                  side="buy" mode={buyMode} onModeChange={setBuyMode}
                  activeChip={buyChip} onChip={v => { setBuyChip(v); setBuyManual(''); }}
                  qtyValue={buyManual} onQtyChange={v => { setBuyManual(v); setBuyChip(null); }}
                  derivedQty={buyQty} unitPrice={sel.price}
                  canExecute={buyQty > 0}
                  caption={buyMode === 'pct'
                    ? `of ${maxBuyUnits} max units`
                    : `cap ${fmtQty(maxBuyUnits)} units • ${fmtCR(playerCredits)} CR avail`}
                  onExecute={() => { onBuy(sel.id, buyQty, sel.price); setBuyChip(null); setBuyManual(''); }}
                />
              </div>

            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
  );
};
