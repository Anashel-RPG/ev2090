import type { GameState, ShipColor } from "@/types/game";
import { RadarPanel } from "./RadarPanel";
import { ShipSelectorPanel } from "./ShipSelectorPanel";
import { ShipDiagnosticPanel } from "./ShipDiagnosticPanel";
import "./sidebar.css";

interface Props {
  gameState: GameState;
  onShipChange: (shipId: string) => void;
  onColorChange: (color: ShipColor) => void;
  className?: string;
}

export function Sidebar({ gameState, onShipChange, onColorChange, className }: Props) {
  return (
    <aside className={`sidebar${className ? ` ${className}` : ""}`}>
      <div className="sidebar-scroll">
        <div className="sidebar-logo">
          <span className="logo-text">EV &bull; 2090</span>
        </div>

        <RadarPanel
          shipPosition={gameState.ship.position}
          shipRotation={gameState.ship.rotation}
          contacts={gameState.radarContacts}
        />

        {/* Ship Diagnostic — wireframe display + stats + color picker */}
        <ShipDiagnosticPanel
          shipId={gameState.currentShipId}
          currentColor={gameState.currentShipColor}
          onColorChange={onColorChange}
        />

        {/* Ship Selector — click to change ship */}
        <ShipSelectorPanel
          currentShipId={gameState.currentShipId}
          onShipChange={onShipChange}
        />

        {/* Cargo & Credits */}
        <div className="panel">
          <div className="panel-body">
            <div className="status-row">
              <span className="label">FREE CARGO</span>
              <span className="value">10</span>
            </div>
            <div className="status-row">
              <span className="label">CREDITS</span>
              <span className="value accent">25,000</span>
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <span className="fps-counter">{gameState.fps} FPS</span>
        </div>
      </div>
    </aside>
  );
}
