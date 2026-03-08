/** Intro screen — first-time ship selection with wireframe preview carousel. */
import { useState, useRef, useEffect } from "react";
import { ShipPreview as ShipPreviewRenderer } from "@/engine/ShipPreview";
import { SHIP_CATALOG } from "@/engine/ShipCatalog";

/** Curated starter ships shown on the intro screen */
const STARTER_SHIPS = SHIP_CATALOG.filter((s) =>
  ["striker", "bob"].includes(s.id)
);
import type { ShipColor } from "@/types/game";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import "./IntroScreen.css";

interface Props {
  onComplete: (shipId: string, color: ShipColor) => void;
}

function StatBar({ label, value }: { label: string; value: number }) {
  const pct = value * 10;
  return (
    <div className="intro-stat">
      <span className="intro-stat-label">{label}</span>
      <div className="intro-stat-track">
        <div className="intro-stat-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="intro-stat-val">{pct}</span>
    </div>
  );
}

/** Rotating wireframe 3D ship preview (delegates to engine ShipPreview) */
function ShipPreviewCard({ shipId }: { shipId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preview = new ShipPreviewRenderer(canvas, shipId);
    return () => preview.dispose();
  }, [shipId]);

  return (
    <div className="intro-preview-wrap">
      <canvas ref={canvasRef} width={280} height={220} className="intro-preview-canvas" />
      <div className="intro-preview-scanlines" />
    </div>
  );
}

export function IntroScreen({ onComplete }: Props) {
  const bp = useBreakpoint();
  const isMobile = bp === "mobile";

  const [step, setStep] = useState<"ship" | "controls">("ship");
  const [shipIndex, setShipIndex] = useState(0);

  const shipDef = STARTER_SHIPS[shipIndex]!;

  const prevShip = () => setShipIndex((i) => (i - 1 + STARTER_SHIPS.length) % STARTER_SHIPS.length);
  const nextShip = () => setShipIndex((i) => (i + 1) % STARTER_SHIPS.length);

  const handleSelect = () => {
    if (isMobile) {
      onComplete(shipDef.id, "Blue");
    } else {
      setStep("controls");
    }
  };

  const handleLaunch = () => {
    onComplete(shipDef.id, "Blue");
  };

  return (
    <div className="intro-overlay">
      {/* Splash background image */}
      <div className="intro-bg" />

      <div className={`intro-container ${isMobile ? "intro-mobile" : ""}`}>
        {/* Header */}
        <div className="intro-header">
          <span className="intro-logo">EV &bull; 2090</span>
          <span className="intro-subtitle">
            {step === "ship" ? "SELECT YOUR VESSEL" : "FLIGHT CONTROLS"}
          </span>
        </div>

        {/* Body — consistent height between steps */}
        <div className="intro-body">
          {step === "ship" && (
            <>
              {/* Carousel: arrow | preview + info | arrow */}
              <div className="intro-carousel">
                <button className="intro-arrow intro-arrow-left" onClick={prevShip} aria-label="Previous ship">
                  &#x25C0;
                </button>

                <div className="intro-ship-display">
                  {/* 3D preview */}
                  <ShipPreviewCard shipId={shipDef.id} />

                  {/* Ship info */}
                  <div className="intro-ship-info">
                    <div className="intro-ship-name">{shipDef.name}</div>
                    <div className="intro-ship-class">{shipDef.class}</div>
                    <div className="intro-ship-lore">{shipDef.lore}</div>

                    <div className="intro-ship-stats">
                      <StatBar label="SPD" value={shipDef.stats.speed} />
                      <StatBar label="ARM" value={shipDef.stats.armor} />
                      <StatBar label="CRG" value={shipDef.stats.cargo} />
                      <StatBar label="FPR" value={shipDef.stats.firepower} />
                    </div>
                  </div>
                </div>

                <button className="intro-arrow intro-arrow-right" onClick={nextShip} aria-label="Next ship">
                  &#x25B6;
                </button>
              </div>

              {/* Ship counter */}
              <div className="intro-counter">
                {shipIndex + 1} / {STARTER_SHIPS.length}
              </div>
              <div className="intro-hangar-hint">Visit Hangar for more</div>
            </>
          )}

          {step === "controls" && (
            <div className="intro-controls">
              <div className="intro-keys-group">
                <div className="intro-keys-title">KEYBOARD</div>
                <div className="intro-keys-row">
                  <kbd className="intro-key">W</kbd>
                  <kbd className="intro-key">&#x2191;</kbd>
                  <span className="intro-key-desc">THRUST</span>
                </div>
                <div className="intro-keys-row">
                  <kbd className="intro-key">A</kbd>
                  <kbd className="intro-key">&#x2190;</kbd>
                  <span className="intro-key-desc">ROTATE LEFT</span>
                </div>
                <div className="intro-keys-row">
                  <kbd className="intro-key">D</kbd>
                  <kbd className="intro-key">&#x2192;</kbd>
                  <span className="intro-key-desc">ROTATE RIGHT</span>
                </div>
                <div className="intro-keys-row">
                  <kbd className="intro-key">S</kbd>
                  <kbd className="intro-key">&#x2193;</kbd>
                  <span className="intro-key-desc">BRAKE</span>
                </div>
              </div>
              <div className="intro-controls-tip">
                Approach a planet slowly to dock and repair.
              </div>
            </div>
          )}
        </div>

        {/* Footer — always at bottom */}
        <div className="intro-footer">
          {step === "ship" ? (
            <button className="intro-launch-btn" onClick={handleSelect}>
              SELECT
            </button>
          ) : (
            <button className="intro-launch-btn" onClick={handleLaunch}>
              LAUNCH
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
