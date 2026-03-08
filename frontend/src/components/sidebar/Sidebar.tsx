import type { GameState, ShipColor } from "@/types/game";
import type { CargoItem, MarketSnapshot, TradeTransaction } from "@/types/economy";
import { RadarPanel } from "./RadarPanel";
import { ShipDiagnosticPanel } from "./ShipDiagnosticPanel";
import { CargoPanel } from "./CargoPanel";
import "./sidebar.css";

interface Props {
  gameState: GameState;
  onShipChange: (shipId: string) => void;
  onColorChange: (color: ShipColor) => void;
  onConfigToggle?: () => void;
  onForgeOpen?: () => void;
  className?: string;
  // Economy
  credits: number;
  cargo: CargoItem[];
  cargoWeight: number;
  cargoCapacity: number;
  marketSnapshot: MarketSnapshot | null;
  transactions?: TradeTransaction[];
}

export function Sidebar({ gameState, onShipChange: _onShipChange, onColorChange: _onColorChange, onConfigToggle, onForgeOpen, className, credits, cargo, cargoWeight, cargoCapacity, marketSnapshot, transactions = [] }: Props) {
  return (
    <aside className={`sidebar${className ? ` ${className}` : ""}`}>
      <div className="sidebar-scroll">
        <div className="sidebar-logo">
          <span className="logo-text">EV &bull; 2090</span>
          {onConfigToggle && (
            <button
              className="config-ghost-btn"
              onClick={onConfigToggle}
              title="Toggle config panel"
            >
              &#x2699;
            </button>
          )}
        </div>

        <RadarPanel
          shipPosition={gameState.ship.position}
          shipHeading={gameState.ship.heading}
          contacts={gameState.radarContacts}
        />

        {/* Ship Diagnostic — wireframe display + stats */}
        <ShipDiagnosticPanel shipId={gameState.currentShipId} />

        {/* Cargo & Credits — real economy data */}
        <CargoPanel
          credits={credits}
          cargo={cargo}
          cargoWeight={cargoWeight}
          cargoCapacity={cargoCapacity}
          transactions={transactions}
          marketSnapshot={marketSnapshot}
        />

        {/* Spacer pushes hangar button to bottom */}
        <div className="sidebar-spacer" />

        {/* Hangar — full ship browser */}
        {onForgeOpen && (
          <div className="panel">
            <button className="forge-sidebar-btn" onClick={onForgeOpen}>
              VISIT SHIP HANGAR
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
