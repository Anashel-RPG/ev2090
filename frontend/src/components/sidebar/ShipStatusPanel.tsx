import type { ShipState } from "@/types/game";

interface Props {
  ship: ShipState;
  speed: number;
}

function StatusBar({
  label,
  value,
  color,
  warn = 0.3,
}: {
  label: string;
  value: number;
  color: string;
  warn?: number;
}) {
  const isLow = value <= warn;
  const barColor = isLow ? "#ff4444" : color;

  return (
    <div className="status-bar">
      <div className="status-bar-label">
        <span>{label}</span>
        <span className="status-bar-value">{Math.round(value * 100)}%</span>
      </div>
      <div className="status-bar-track">
        <div
          className="status-bar-fill"
          style={{
            width: `${value * 100}%`,
            backgroundColor: barColor,
            boxShadow: `0 0 6px ${barColor}40`,
          }}
        />
      </div>
    </div>
  );
}

export function ShipStatusPanel({ ship, speed }: Props) {
  return (
    <div className="panel ship-status-panel">
      <div className="panel-header">SHIP STATUS</div>
      <div className="panel-body">
        <StatusBar label="SHIELDS" value={ship.shields} color="#4488ff" />
        <StatusBar label="ARMOR" value={ship.armor} color="#ff8844" />
        <StatusBar label="FUEL" value={ship.fuel} color="#00ff88" />

        <div className="status-info">
          <div className="status-row">
            <span className="label">SPEED</span>
            <span className="value">{speed.toFixed(1)}</span>
          </div>
          <div className="status-row">
            <span className="label">HEADING</span>
            <span className="value">
              {Math.round(
                ((ship.rotation * 180) / Math.PI + 360) % 360,
              )}
              &deg;
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
