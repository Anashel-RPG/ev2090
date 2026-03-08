/** Ship selector panel — clickable ship list in the sidebar for switching active ship. */
import { SHIP_CATALOG } from "@/engine/ShipCatalog";

/** Same curated starter ships shown on the intro screen */
const STARTER_SHIPS = SHIP_CATALOG.filter((s) =>
  ["striker", "bob", "challenger"].includes(s.id)
);

interface Props {
  currentShipId: string;
  onShipChange: (shipId: string) => void;
}

export function ShipSelectorPanel({ currentShipId, onShipChange }: Props) {
  return (
    <div className="panel">
      <div className="panel-header">SHIP SELECTOR</div>
      <div className="ship-list">
        {STARTER_SHIPS.map((ship) => (
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
