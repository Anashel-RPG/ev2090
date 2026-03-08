import { useRef, useEffect } from "react";
import { ShipPreview } from "@/engine/ShipPreview";
import { getShipDef } from "@/engine/ShipCatalog";
import "./diagnostic.css";

interface Props {
  shipId: string;
}

const LARGE_COMBAT = new Set(["CAPITAL", "FRIGATE", "ASSAULT", "RAIDER"]);
const SMALL_ATTACK = new Set(["INTERCEPTOR", "FIGHTER", "PATROL", "RECON"]);

function getPrimaryStat(shipClass: string): string {
  if (LARGE_COMBAT.has(shipClass)) return "ARM";
  if (SMALL_ATTACK.has(shipClass)) return "SPD";
  return "CRG";
}

/** Stat bar for diagnostic display */
function DiagStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  const filled = Math.round(value);

  return (
    <div className={`diag-stat${highlight ? " diag-stat--gold" : ""}`}>
      <span className="diag-stat-label">{label}</span>
      <span className="diag-stat-bar">
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={`diag-seg${i < filled ? " diag-seg--on" : ""}`}
          />
        ))}
      </span>
      <span className="diag-stat-val">{value * 10}</span>
    </div>
  );
}

export function ShipDiagnosticPanel({ shipId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shipDef = getShipDef(shipId);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shipDef) return;

    const preview = new ShipPreview(canvas, shipId, { width: 210, height: 250 });
    return () => preview.dispose();
  }, [shipId, shipDef]);

  if (!shipDef) return null;

  const primary = getPrimaryStat(shipDef.class);

  return (
    <div className="panel">
      {/* Canvas + scanlines + text overlay — all stacked inside the container */}
      <div className="diagnostic-container">
        <canvas
          ref={canvasRef}
          width={210}
          height={250}
          className="diagnostic-canvas"
        />

        {/* Layer 1: scanlines on top of canvas */}
        <div className="diagnostic-scanlines" />

        {/* Layer 2: text overlay above scanlines */}
        <div className="diag-text-overlay">
          <div className="diag-overlay-header">SHIP DIAGNOSTIC</div>

          <div className="diag-overlay-bottom">
            <div className="diag-class">
              <span className="diag-class-label">CLASS</span>
              <span className="diag-class-value">{shipDef.class}</span>
            </div>
            <div className="diag-stats">
              <DiagStat label="SPD" value={shipDef.stats.speed} highlight={primary === "SPD"} />
              <DiagStat label="ARM" value={shipDef.stats.armor} highlight={primary === "ARM"} />
              <DiagStat label="CRG" value={shipDef.stats.cargo} highlight={primary === "CRG"} />
              <DiagStat label="FPR" value={shipDef.stats.firepower} highlight={primary === "FPR"} />
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
