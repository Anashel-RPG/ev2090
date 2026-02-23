import { SHIP_CATALOG } from "@/engine/ShipCatalog";

interface Props {
  currentShipId: string;
  onShipChange: (shipId: string) => void;
}

export function ShipSelectorPanel({ currentShipId, onShipChange }: Props) {
  return (
    <div className="panel">
      <div className="panel-header">SHIP SELECTOR</div>
      <div className="ship-list">
        {SHIP_CATALOG.map((ship) => (
          <button
            key={ship.id}
            className={`ship-item ${ship.id === currentShipId ? "active" : ""}`}
            onClick={() => onShipChange(ship.id)}
          >
            <span className="ship-name">{ship.name}</span>
            <span className="ship-class">{ship.class}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
