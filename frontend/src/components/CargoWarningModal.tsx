/** CargoWarningModal — shown when switching to a ship with less cargo capacity than current cargo weight. */
import { useMemo } from "react";
import { COMMODITY_MAP } from "@/data/commodities";
import type { CargoItem, MarketSnapshot } from "@/types/economy";
import "./CargoWarningModal.css";

export interface JettisonItem {
  commodityId: string;
  name: string;
  icon: string;
  quantity: number;
  weight: number;
  value: number;
}

export interface CargoWarningData {
  newShipId: string;
  newCapacity: number;
  itemsToJettison: JettisonItem[];
}

/**
 * Compute which items to jettison when switching to a smaller ship.
 * Algorithm: sort by value density (price / unitSize) ascending, remove least valuable first.
 */
export function computeJettisonList(
  cargo: CargoItem[],
  currentWeight: number,
  newCapacity: number,
  marketSnapshot: MarketSnapshot | null,
): JettisonItem[] {
  if (currentWeight <= newCapacity) return [];

  // Build enriched list with current prices
  const enriched = cargo.map(item => {
    const comm = COMMODITY_MAP.get(item.commodityId);
    const unitSize = comm?.unitSize ?? 1;

    // Best-effort current price: use market snapshot or fall back to avg buy price
    let price = item.avgBuyPrice;
    if (marketSnapshot) {
      for (const planet of Object.values(marketSnapshot.planets)) {
        const mp = planet.commodities[item.commodityId];
        if (mp) { price = mp.price; break; }
      }
    }

    return {
      commodityId: item.commodityId,
      name: comm?.name ?? item.commodityId,
      icon: comm?.icon ?? "?",
      quantity: item.quantity,
      unitSize,
      price,
      valueDensity: price / unitSize, // value per ton — lower = jettison first
      totalWeight: item.quantity * unitSize,
    };
  });

  // Sort by value density ascending (least valuable per ton first)
  enriched.sort((a, b) => a.valueDensity - b.valueDensity);

  let excessWeight = currentWeight - newCapacity;
  const toJettison: JettisonItem[] = [];

  for (const item of enriched) {
    if (excessWeight <= 0) break;

    // How many units to remove from this item?
    const unitsNeeded = Math.ceil(excessWeight / item.unitSize);
    const unitsToRemove = Math.min(unitsNeeded, item.quantity);
    const weightRemoved = unitsToRemove * item.unitSize;

    toJettison.push({
      commodityId: item.commodityId,
      name: item.name,
      icon: item.icon,
      quantity: unitsToRemove,
      weight: weightRemoved,
      value: unitsToRemove * item.price,
    });

    excessWeight -= weightRemoved;
  }

  return toJettison;
}

interface Props {
  currentWeight: number;
  newCapacity: number;
  newShipName: string;
  itemsToJettison: JettisonItem[];
  onConfirm: () => void;
  onCancel: () => void;
}

function fmtWeight(t: number): string {
  return t % 1 === 0 ? String(t) : t.toFixed(1);
}

function fmtCR(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "k";
  return n.toLocaleString("en", { maximumFractionDigits: 0 });
}

export function CargoWarningModal({
  currentWeight,
  newCapacity,
  newShipName,
  itemsToJettison,
  onConfirm,
  onCancel,
}: Props) {
  const totalLostValue = useMemo(
    () => itemsToJettison.reduce((s, i) => s + i.value, 0),
    [itemsToJettison],
  );
  const totalLostWeight = useMemo(
    () => itemsToJettison.reduce((s, i) => s + i.weight, 0),
    [itemsToJettison],
  );

  return (
    <div className="cwm-backdrop" onClick={onCancel}>
      <div className="cwm-modal" onClick={e => e.stopPropagation()}>
        <div className="cwm-header">
          <span className="cwm-warning-icon">&#x26A0;</span>
          <span className="cwm-title">CARGO OVERFLOW</span>
        </div>

        <div className="cwm-stats">
          <div className="cwm-stat-row">
            <span className="cwm-stat-label">Current cargo</span>
            <span className="cwm-stat-value">{fmtWeight(currentWeight)}t</span>
          </div>
          <div className="cwm-stat-row">
            <span className="cwm-stat-label">{newShipName} capacity</span>
            <span className="cwm-stat-value cwm-stat-red">{fmtWeight(newCapacity)}t</span>
          </div>
          <div className="cwm-stat-row">
            <span className="cwm-stat-label">Excess</span>
            <span className="cwm-stat-value cwm-stat-red">{fmtWeight(currentWeight - newCapacity)}t</span>
          </div>
        </div>

        <div className="cwm-divider" />

        <div className="cwm-jettison-label">Items to jettison (least valuable first):</div>
        <div className="cwm-jettison-list">
          {itemsToJettison.map(item => (
            <div key={item.commodityId} className="cwm-jettison-row">
              <span className="cwm-jet-icon">{item.icon}</span>
              <span className="cwm-jet-name">{item.name}</span>
              <span className="cwm-jet-qty">x{item.quantity}</span>
              <span className="cwm-jet-weight">{fmtWeight(item.weight)}t</span>
              <span className="cwm-jet-value">{fmtCR(item.value)} CR</span>
            </div>
          ))}
        </div>

        <div className="cwm-divider" />

        <div className="cwm-total-row">
          <span className="cwm-total-label">Total lost</span>
          <span className="cwm-total-value">
            {fmtWeight(totalLostWeight)}t &middot; {fmtCR(totalLostValue)} CR
          </span>
        </div>

        <div className="cwm-actions">
          <button className="cwm-btn cwm-btn-cancel" onClick={onCancel}>
            CANCEL
          </button>
          <button className="cwm-btn cwm-btn-confirm" onClick={onConfirm}>
            JETTISON &amp; SWITCH
          </button>
        </div>
      </div>
    </div>
  );
}
