import type { NavigationInfo } from "@/types/game";

interface Props {
  nav: NavigationInfo;
}

export function NavigationPanel({ nav }: Props) {
  return (
    <div className="panel navigation-panel">
      <div className="panel-header">NAVIGATION</div>
      <div className="panel-body">
        <div className="status-row">
          <span className="label">SYSTEM</span>
          <span className="value accent">{nav.systemName}</span>
        </div>
        <div className="status-row">
          <span className="label">POS</span>
          <span className="value">
            {nav.coordinates.x}, {nav.coordinates.y}
          </span>
        </div>
        {nav.nearestPlanet && (
          <>
            <div className="status-row">
              <span className="label">NEAREST</span>
              <span className="value accent-blue">{nav.nearestPlanet}</span>
            </div>
            <div className="status-row">
              <span className="label">DIST</span>
              <span className="value">{nav.nearestDistance?.toFixed(1)} AU</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
