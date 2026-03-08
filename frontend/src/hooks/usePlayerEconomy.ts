/**
 * usePlayerEconomy — manages player credits, cargo inventory, and transaction history.
 * All state persisted to localStorage under "ev-economy".
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type { PlayerEconomyState, CargoItem, TradeTransaction } from "@/types/economy";
import { INITIAL_PLAYER_ECONOMY } from "@/types/economy";
import { COMMODITY_MAP } from "@/data/commodities";
import { getShipDef } from "@/engine/ShipCatalog";

const STORAGE_KEY = "ev-economy";
const MAX_TRANSACTIONS = 100;

// ── Persistence ──

function loadFromStorage(): PlayerEconomyState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...INITIAL_PLAYER_ECONOMY };
    const parsed = JSON.parse(raw) as PlayerEconomyState;
    if (parsed.version !== 1) return { ...INITIAL_PLAYER_ECONOMY };
    return parsed;
  } catch {
    return { ...INITIAL_PLAYER_ECONOMY };
  }
}

function saveToStorage(state: PlayerEconomyState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

// ── Cargo weight calculation ──

export function computeCargoWeight(cargo: CargoItem[]): number {
  return cargo.reduce((sum, item) => {
    const comm = COMMODITY_MAP.get(item.commodityId);
    return sum + item.quantity * (comm?.unitSize ?? 1);
  }, 0);
}

/** Get cargo capacity in tons for a ship (cargo stat * 5) */
export function getCargoCapacity(shipId: string): number {
  const def = getShipDef(shipId);
  return (def?.stats.cargo ?? 5) * 5;
}

// ── Pure state transforms ──

function executeBuy(
  prev: PlayerEconomyState,
  commodityId: string,
  quantity: number,
  pricePerUnit: number,
  planetId: string,
): PlayerEconomyState {
  const total = quantity * pricePerUnit;
  if (total > prev.credits || quantity <= 0) return prev;

  // Update cargo (merge with existing or add new)
  const existing = prev.cargo.find(c => c.commodityId === commodityId);
  let newCargo: CargoItem[];
  if (existing) {
    const newQty = existing.quantity + quantity;
    const newAvg = (existing.avgBuyPrice * existing.quantity + pricePerUnit * quantity) / newQty;
    newCargo = prev.cargo.map(c =>
      c.commodityId === commodityId
        ? { ...c, quantity: newQty, avgBuyPrice: newAvg }
        : c
    );
  } else {
    newCargo = [...prev.cargo, { commodityId, quantity, avgBuyPrice: pricePerUnit }];
  }

  // Add transaction
  const tx: TradeTransaction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    planetId,
    commodityId,
    action: "buy",
    quantity,
    pricePerUnit,
    total,
  };
  const newTx = [tx, ...prev.transactions].slice(0, MAX_TRANSACTIONS);

  return {
    ...prev,
    credits: prev.credits - total,
    cargo: newCargo,
    transactions: newTx,
  };
}

function executeSell(
  prev: PlayerEconomyState,
  commodityId: string,
  quantity: number,
  pricePerUnit: number,
  planetId: string,
): PlayerEconomyState {
  const existing = prev.cargo.find(c => c.commodityId === commodityId);
  if (!existing || existing.quantity < quantity || quantity <= 0) return prev;

  const total = quantity * pricePerUnit;
  const remaining = existing.quantity - quantity;

  const newCargo = remaining > 0
    ? prev.cargo.map(c =>
        c.commodityId === commodityId
          ? { ...c, quantity: remaining }
          : c
      )
    : prev.cargo.filter(c => c.commodityId !== commodityId);

  const tx: TradeTransaction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    planetId,
    commodityId,
    action: "sell",
    quantity,
    pricePerUnit,
    total,
  };
  const newTx = [tx, ...prev.transactions].slice(0, MAX_TRANSACTIONS);

  return {
    ...prev,
    credits: prev.credits + total,
    cargo: newCargo,
    transactions: newTx,
  };
}

function executeJettison(
  prev: PlayerEconomyState,
  itemsToJettison: { commodityId: string; quantity: number }[],
): PlayerEconomyState {
  let newCargo = [...prev.cargo];
  for (const jet of itemsToJettison) {
    const idx = newCargo.findIndex(c => c.commodityId === jet.commodityId);
    if (idx === -1) continue;
    const existing = newCargo[idx]!;
    const remaining = existing.quantity - jet.quantity;
    if (remaining <= 0) {
      newCargo.splice(idx, 1);
    } else {
      newCargo[idx] = { ...existing, quantity: remaining };
    }
  }
  return { ...prev, cargo: newCargo };
}

// ── Hook ──

export interface PlayerEconomyActions {
  credits: number;
  cargo: CargoItem[];
  transactions: TradeTransaction[];
  cargoWeight: number;
  cargoCapacity: number;
  freeCapacity: number;
  buy: (commodityId: string, quantity: number, pricePerUnit: number, planetId: string) => void;
  sell: (commodityId: string, quantity: number, pricePerUnit: number, planetId: string) => void;
  jettison: (items: { commodityId: string; quantity: number }[]) => void;
}

export function usePlayerEconomy(currentShipId: string): PlayerEconomyActions {
  const [state, setState] = useState<PlayerEconomyState>(loadFromStorage);

  // Auto-persist on every state change
  useEffect(() => {
    saveToStorage(state);
  }, [state]);

  const cargoWeight = useMemo(() => computeCargoWeight(state.cargo), [state.cargo]);
  const cargoCapacity = useMemo(() => getCargoCapacity(currentShipId), [currentShipId]);
  const freeCapacity = cargoCapacity - cargoWeight;

  const buy = useCallback((commodityId: string, quantity: number, pricePerUnit: number, planetId: string) => {
    setState(prev => executeBuy(prev, commodityId, quantity, pricePerUnit, planetId));
  }, []);

  const sell = useCallback((commodityId: string, quantity: number, pricePerUnit: number, planetId: string) => {
    setState(prev => executeSell(prev, commodityId, quantity, pricePerUnit, planetId));
  }, []);

  const jettison = useCallback((items: { commodityId: string; quantity: number }[]) => {
    setState(prev => executeJettison(prev, items));
  }, []);

  return {
    credits: state.credits,
    cargo: state.cargo,
    transactions: state.transactions,
    cargoWeight,
    cargoCapacity,
    freeCapacity,
    buy,
    sell,
    jettison,
  };
}
