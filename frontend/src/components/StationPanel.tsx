/** Station panel — desktop sci-fi docking interface.
 *  Matches ui-demo/planet design: panel on RIGHT, planet info floating LEFT,
 *  planet stats bottom-left, glass panel with tabbed content. */
import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Globe, ShoppingCart, Box, Users, LogOut, Lock } from "lucide-react";
import { SummaryPanel } from "./station/SummaryPanel";
import { TradingPanel } from "./station/TradingPanel";
import { LockedPanel } from "./station/LockedPanel";
import { DockFlash } from "./DockFlash";
import { STATIONS } from "@/data/stations";
import type { MarketSnapshot, CargoItem } from "@/types/economy";
import "./StationPanel.css";

/** Build nav items — auth system is scaffolded but not yet enforced */
function getNavItems() {
  return [
    { id: "summary",   label: "Overview",  icon: Globe,        locked: false, gated: false },
    { id: "trading",   label: "Market",    icon: ShoppingCart, locked: false, gated: false },
    { id: "hangar",    label: "Hangar",    icon: Box,          locked: false, gated: false },
    { id: "community", label: "Comm-Link", icon: Users,        locked: true,  gated: false },
  ];
}

interface Props {
  planetName: string;
  shipId: string;
  heroLetterbox: number;
  shields: number;
  armor: number;
  fuel: number;
  onUndock: () => void;
  onRepair: () => void;
  onRefuel: () => void;
  onOpenHangar?: () => void;
  // Economy
  marketSnapshot: MarketSnapshot | null;
  playerCredits: number;
  playerCargo: CargoItem[];
  cargoWeight: number;
  cargoCapacity: number;
  onBuy: (commodityId: string, qty: number, price: number) => void;
  onSell: (commodityId: string, qty: number, price: number) => void;
}

export function StationPanel({
  planetName,
  heroLetterbox,
  onUndock,
  onOpenHangar,
  marketSnapshot,
  playerCredits,
  playerCargo,
  cargoWeight,
  cargoCapacity,
  onBuy,
  onSell,
}: Props) {
  const [activeTab, setActiveTab] = useState("summary");
  const [flashTrigger, setFlashTrigger] = useState(1);
  const [visible, setVisible] = useState(false);
  const onUndockRef = useRef(onUndock);
  onUndockRef.current = onUndock;

  const station = STATIONS[planetName];
  const planet = station?.planet;

  /* ── Wait for letterbox settle before revealing ── */
  const prevLb = useRef(heroLetterbox);
  const stableCount = useRef(0);
  const revealed = useRef(false);

  useEffect(() => {
    if (revealed.current) return;
    if (heroLetterbox > 0.1 && Math.abs(heroLetterbox - prevLb.current) < 0.005) {
      stableCount.current++;
      if (stableCount.current >= 3) {
        revealed.current = true;
        setTimeout(() => setVisible(true), 200);
      }
    } else {
      stableCount.current = 0;
    }
    prevLb.current = heroLetterbox;
  }, [heroLetterbox]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!revealed.current) { revealed.current = true; setVisible(true); }
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  const handleUndock = useCallback(() => {
    setFlashTrigger((n) => n + 1);
    setVisible(false);
    setTimeout(() => onUndockRef.current(), 250);
  }, []);

  const navItems = getNavItems();

  const renderContent = () => {
    switch (activeTab) {
      case "summary":  return <SummaryPanel />;
      case "trading":  return (
        <TradingPanel
          planetId={planetName.toLowerCase()}
          marketSnapshot={marketSnapshot}
          playerCredits={playerCredits}
          playerCargo={playerCargo}
          cargoWeight={cargoWeight}
          cargoCapacity={cargoCapacity}
          onBuy={onBuy}
          onSell={onSell}
        />
      );
      case "hangar":    return <SummaryPanel />; // opens overlay via onOpenHangar click
      case "community": return <LockedPanel label="Comm-Link" />;
      default:          return <SummaryPanel />;
    }
  };

  return (
    <>
      <DockFlash trigger={flashTrigger} />

      {/* ── Full-viewport container ──────────────────── */}
      <div className={`sp-viewport ${visible ? "sp-viewport-visible" : ""}`}>

        {/* ── Screen FX ────────────────────────────────── */}
        <div className="sp-scanlines" />
        <div className="sp-vignette" />

        {/* ── Planet Info — top-left overlay ──────────── */}
        {planet && (
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="sp-planet-info"
          >
            <div className="sp-badge-row">
              <span className="sp-badge">{planet.className}</span>
              {planet.habitable && (
                <span className="sp-badge sp-badge-green">Habitable</span>
              )}
            </div>

            <h1 className="sp-planet-name">{planetName}</h1>
            <p className="sp-planet-lore">{planet.lore}</p>
          </motion.div>
        )}

        {/* ── Planet Stats — bottom-left ──────────────── */}
        {planet && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="sp-planet-stats"
          >
            <div className="sp-stats-row">
              <MiniStat label="Temp" value={planet.temp} />
              <div className="sp-stats-divider" />
              <MiniStat label="Gravity" value={planet.gravity} />
              <div className="sp-stats-divider" />
              <MiniStat label="Rads" value={planet.rads} />
              <div className="sp-stats-divider" />
              <MiniStat label="Threat" value={planet.threat} accent={planet.threat !== "LOW"} />
            </div>
          </motion.div>
        )}

        {/* ── Right Panel (aside) ────────────────────── */}
        <aside className="sp-aside">

          {/* Glass background layer */}
          <div
            className="sp-glass"
            style={{
              bottom: activeTab === "summary" ? "42px" : 0,
            }}
          />

          {/* Fade veil + Footer — Overview tab only */}
          {activeTab === "summary" && (
            <>
              <div className="sp-fade-veil" />
              <div className="sp-footer">
                <span className="sp-footer-sector">Sector 7-G</span>
                <UndockButton onClick={handleUndock} />
              </div>
            </>
          )}

          {/* Content wrapper: nav + panel */}
          <div className="sp-aside-content">

            {/* Nav Tabs */}
            <nav className="station-nav">
              {navItems.map(({ id, label, icon: Icon, locked, gated }) => {
                const active = activeTab === id;
                // Fully locked = coming soon (no click). Gated = account-required (click shows CTA).
                const isDisabled = locked && !gated;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      if (isDisabled) return;
                      if (id === "hangar" && onOpenHangar) {
                        onOpenHangar();
                        return;
                      }
                      setActiveTab(id);
                    }}
                    className={`station-nav-tab ${active ? "active" : ""}`}
                    style={isDisabled ? { opacity: 0.35, cursor: "not-allowed", position: "relative" }
                           : gated ? { opacity: 0.55, position: "relative" }
                           : {}}
                  >
                    {(locked || gated)
                      ? <Lock size={11} className="station-nav-tab-icon" />
                      : <Icon size={13} className="station-nav-tab-icon" />
                    }
                    <span className="station-nav-tab-label">{label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Panel Content */}
            <div className="sp-content">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  style={{ height: "100%" }}
                >
                  {renderContent()}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

/* ── Sub-components ────────────────────────────────── */

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="sp-stat-label">{label}</div>
      <div className={`sp-stat-value ${accent ? "sp-stat-accent" : ""}`}>{value}</div>
    </div>
  );
}

function UndockButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="sp-undock-btn"
    >
      <LogOut size={12} />
      Undock
    </button>
  );
}
