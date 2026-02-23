import type { TargetInfo } from "@/types/game";

interface Props {
  target: TargetInfo;
}

export function TargetPanel({ target }: Props) {
  return (
    <div className="panel target-panel">
      <div className="panel-header">TARGET</div>
      <div className="panel-body">
        {target ? (
          <>
            <div className="status-row">
              <span className="label">NAME</span>
              <span className="value accent">{target.name}</span>
            </div>
            <div className="status-row">
              <span className="label">TYPE</span>
              <span className="value">{target.type}</span>
            </div>
            <div className="status-row">
              <span className="label">DIST</span>
              <span className="value">{target.distance.toFixed(1)}</span>
            </div>
            <div className="target-bars">
              <div className="status-bar">
                <div className="status-bar-label">
                  <span>SHD</span>
                  <span className="status-bar-value">
                    {Math.round(target.shields * 100)}%
                  </span>
                </div>
                <div className="status-bar-track">
                  <div
                    className="status-bar-fill"
                    style={{
                      width: `${target.shields * 100}%`,
                      backgroundColor: "#4488ff",
                    }}
                  />
                </div>
              </div>
              <div className="status-bar">
                <div className="status-bar-label">
                  <span>ARM</span>
                  <span className="status-bar-value">
                    {Math.round(target.armor * 100)}%
                  </span>
                </div>
                <div className="status-bar-track">
                  <div
                    className="status-bar-fill"
                    style={{
                      width: `${target.armor * 100}%`,
                      backgroundColor: "#ff8844",
                    }}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="no-target">NO TARGET</div>
        )}
      </div>
    </div>
  );
}
