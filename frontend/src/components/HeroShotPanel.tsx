import { useState, useCallback, useEffect, useRef } from "react";
import { CollapsibleSection } from "./config/CollapsibleSection";
import { useConfigSlider } from "@/hooks/useConfigSlider";
import type { HeroSubject, HeroShotConfig } from "@/types/game";
import "./HeroShotPanel.css";

interface Props {
  enabled: boolean;
  onClose: () => void;
  // Engine bridge
  enterHeroMode: (subject: HeroSubject) => void;
  exitHeroModeAnimated: (duration?: number) => void;
  isInHeroMode: () => boolean;
  setConfig: (property: string, value: number) => void;
  getConfig: () => HeroShotConfig | null;
  previewToGameplay: (duration?: number, onComplete?: () => void) => void;
  previewToComposed: (duration?: number, onComplete?: () => void) => void;
  isAnimating: () => boolean;
  getPlanetNames: () => string[];
  currentShipId: string;
  // Ship rotation
  setShipRotation: (radians: number) => void;
  getShipRotation: () => number;
  setShipTilt: (radians: number) => void;
  getShipTilt: () => number;
  setShipRoll: (radians: number) => void;
  getShipRoll: () => number;
  setShipScale: (scale: number) => void;
  getShipScale: () => number;
  setHeroShipRotateMode: (on: boolean) => void;
  isHeroShipRotateMode: () => boolean;
}

export function HeroShotPanel({
  enabled,
  onClose,
  enterHeroMode,
  exitHeroModeAnimated,
  isInHeroMode,
  setConfig,
  getConfig,
  previewToGameplay,
  previewToComposed,
  isAnimating,
  getPlanetNames,
  currentShipId,
  setShipRotation,
  getShipRotation,
  setShipTilt,
  getShipTilt,
  setShipRoll,
  getShipRoll,
  setShipScale,
  getShipScale,
  setHeroShipRotateMode,
  isHeroShipRotateMode,
}: Props) {
  const [activeSubject, setActiveSubject] = useState<HeroSubject | null>(null);
  const [copied, setCopied] = useState(false);
  const [planetNames, setPlanetNames] = useState<string[]>([]);
  const [shipRotateMode, setShipRotateMode] = useState(false);
  const [shipHeading, setShipHeading] = useState(0);
  const [shipTilt, setShipTiltState] = useState((-22 * Math.PI) / 180);
  const [shipRoll, setShipRollState] = useState(0);
  const [shipScale, setShipScaleState] = useState(1);
  const [animating, setAnimating] = useState(false);
  const [previewState, setPreviewState] = useState<"composed" | "gameplay">("composed");

  // Load planet names on mount
  useEffect(() => {
    if (enabled) setPlanetNames(getPlanetNames());
  }, [enabled, getPlanetNames]);

  // ─── Poll engine to sync sliders with mouse/keyboard changes ───
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || !activeSubject) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(() => {
      const cfg = getConfig();
      if (!cfg) return;

      // Sync all sliders from engine
      zoom.syncFromEngine(cfg.zoom);
      panX.syncFromEngine(cfg.panX);
      panY.syncFromEngine(cfg.panY);
      bloomStrength.syncFromEngine(cfg.bloomStrength);
      bloomRadius.syncFromEngine(cfg.bloomRadius);
      bloomThreshold.syncFromEngine(cfg.bloomThreshold);
      vignetteIntensity.syncFromEngine(cfg.vignetteIntensity);
      vignetteSoftness.syncFromEngine(cfg.vignetteSoftness);
      letterbox.syncFromEngine(cfg.letterbox);
      brightness.syncFromEngine(cfg.brightness);
      contrast.syncFromEngine(cfg.contrast);
      exposure.syncFromEngine(cfg.exposure);

      // Sync ship orientation + scale
      if (activeSubject?.type === "ship") {
        setShipHeading(getShipRotation());
        setShipTiltState(getShipTilt());
        setShipRollState(getShipRoll());
        setShipScaleState(getShipScale());
      }

      // Sync states
      setShipRotateMode(isHeroShipRotateMode());
      setAnimating(isAnimating());

      // Auto-clear if engine exited hero mode
      if (!isInHeroMode()) {
        setActiveSubject(null);
        setShipRotateMode(false);
      }
    }, 150);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeSubject]);

  // ─── Live camera sliders ───

  const zoom = useConfigSlider({
    initial: 1,
    onChange: (v) => setConfig("zoom", v),
  });
  const panX = useConfigSlider({
    initial: 0,
    onChange: (v) => setConfig("panX", v),
  });
  const panY = useConfigSlider({
    initial: 0,
    onChange: (v) => setConfig("panY", v),
  });

  // ─── Effects sliders ───

  const bloomStrength = useConfigSlider({
    initial: 0,
    onChange: (v) => setConfig("bloomStrength", v),
  });
  const bloomRadius = useConfigSlider({
    initial: 0,
    onChange: (v) => setConfig("bloomRadius", v),
  });
  const bloomThreshold = useConfigSlider({
    initial: 1,
    onChange: (v) => setConfig("bloomThreshold", v),
  });
  const vignetteIntensity = useConfigSlider({
    initial: 0,
    onChange: (v) => setConfig("vignetteIntensity", v),
  });
  const vignetteSoftness = useConfigSlider({
    initial: 0.5,
    onChange: (v) => setConfig("vignetteSoftness", v),
  });
  const letterbox = useConfigSlider({
    initial: 0,
    onChange: (v) => setConfig("letterbox", v),
  });

  // ─── Color correction sliders ───

  const brightness = useConfigSlider({
    initial: 1.34,
    onChange: (v) => setConfig("brightness", v),
  });
  const contrast = useConfigSlider({
    initial: 0.98,
    onChange: (v) => setConfig("contrast", v),
  });
  const exposure = useConfigSlider({
    initial: 1.16,
    onChange: (v) => setConfig("exposure", v),
  });

  // ─── Subject selection ───

  const handleSelectSubject = useCallback(
    (subject: HeroSubject) => {
      enterHeroMode(subject);

      if (
        activeSubject &&
        activeSubject.type === subject.type &&
        activeSubject.id === subject.id
      ) {
        setActiveSubject(null);
        setShipRotateMode(false);
      } else {
        setActiveSubject(subject);
        setPreviewState("composed");
        // Sync sliders to captured values after a tick
        setTimeout(() => {
          const cfg = getConfig();
          if (cfg) {
            zoom.syncFromEngine(cfg.zoom);
            panX.syncFromEngine(cfg.panX);
            panY.syncFromEngine(cfg.panY);
            bloomStrength.syncFromEngine(cfg.bloomStrength);
            bloomRadius.syncFromEngine(cfg.bloomRadius);
            bloomThreshold.syncFromEngine(cfg.bloomThreshold);
            vignetteIntensity.syncFromEngine(cfg.vignetteIntensity);
            vignetteSoftness.syncFromEngine(cfg.vignetteSoftness);
            letterbox.syncFromEngine(cfg.letterbox);
            brightness.syncFromEngine(cfg.brightness);
            contrast.syncFromEngine(cfg.contrast);
            exposure.syncFromEngine(cfg.exposure);
          }
        }, 50);
        if (subject.type === "ship") {
          setShipHeading(getShipRotation());
          setShipTiltState(getShipTilt());
          setShipRollState(getShipRoll());
          setShipScaleState(getShipScale());
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enterHeroMode, getConfig, getShipRotation, activeSubject],
  );

  const handleExit = useCallback(() => {
    if (activeSubject) {
      // Animate back to gameplay view first, then close
      exitHeroModeAnimated(1.5);
      setActiveSubject(null);
      setShipRotateMode(false);
      // Panel stays open until animation completes (auto-clear in poll)
      // but we close the panel immediately for UX
      onClose();
    } else {
      onClose();
    }
  }, [activeSubject, exitHeroModeAnimated, onClose]);

  // ─── Preview animation toggle ───

  const handlePreviewToggle = useCallback(() => {
    if (animating) return;
    if (previewState === "composed") {
      previewToGameplay(1.5, () => setPreviewState("gameplay"));
      setPreviewState("gameplay"); // optimistic
    } else {
      previewToComposed(1.5, () => setPreviewState("composed"));
      setPreviewState("composed"); // optimistic
    }
  }, [animating, previewState, previewToGameplay, previewToComposed]);

  // ─── Ship heading ───

  const handleShipHeadingChange = useCallback(
    (radians: number) => {
      setShipHeading(radians);
      setShipRotation(radians);
    },
    [setShipRotation],
  );

  const handleShipTiltChange = useCallback(
    (radians: number) => {
      setShipTiltState(radians);
      setShipTilt(radians);
    },
    [setShipTilt],
  );

  const handleShipRollChange = useCallback(
    (radians: number) => {
      setShipRollState(radians);
      setShipRoll(radians);
    },
    [setShipRoll],
  );

  const handleShipScaleChange = useCallback(
    (scale: number) => {
      setShipScaleState(scale);
      setShipScale(scale);
    },
    [setShipScale],
  );

  const handleToggleRotateMode = useCallback(() => {
    const next = !shipRotateMode;
    setShipRotateMode(next);
    setHeroShipRotateMode(next);
  }, [shipRotateMode, setHeroShipRotateMode]);

  // ─── Copy config ───

  const handleCopy = useCallback(() => {
    const cfg = getConfig();
    if (!cfg || !activeSubject) return;

    const output: Record<string, unknown> = {
      subject: activeSubject,
      camera: {
        zoom: +cfg.zoom.toFixed(2),
        panX: +cfg.panX.toFixed(2),
        panY: +cfg.panY.toFixed(2),
      },
      effects: {
        bloomStrength: +cfg.bloomStrength.toFixed(2),
        bloomRadius: +cfg.bloomRadius.toFixed(2),
        bloomThreshold: +cfg.bloomThreshold.toFixed(2),
        vignetteIntensity: +cfg.vignetteIntensity.toFixed(2),
        vignetteSoftness: +cfg.vignetteSoftness.toFixed(2),
        letterbox: +cfg.letterbox.toFixed(2),
      },
      colorCorrection: {
        brightness: +cfg.brightness.toFixed(2),
        contrast: +cfg.contrast.toFixed(2),
        exposure: +cfg.exposure.toFixed(2),
      },
    };
    if (activeSubject.type === "ship") {
      output.shipHeading = +getShipRotation().toFixed(3);
      output.shipTilt = +getShipTilt().toFixed(3);
      output.shipRoll = +getShipRoll().toFixed(3);
      output.shipScale = +getShipScale().toFixed(2);
    }
    navigator.clipboard.writeText(JSON.stringify(output, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [getConfig, activeSubject, getShipRotation, getShipTilt, getShipRoll, getShipScale]);

  if (!enabled) return null;

  return (
    <>
    {/* Letterbox bars are now rendered in Game.tsx via gameState.heroLetterbox
        so they work both during authoring AND dock transitions */}

    <div className="hero-panel">
      <div className="debug-header">
        <span>HERO SHOT</span>
        <div className="debug-header-buttons">
          <button className="debug-copy" onClick={handleCopy}>
            {copied ? "COPIED!" : "COPY CONFIG"}
          </button>
          <button className="debug-close" onClick={handleExit}>
            x
          </button>
        </div>
      </div>

      <div className="debug-scroll">
        {/* ── CONTROLS HINT ── */}
        {activeSubject && (
          <div className="hero-controls-hint">
            <span>Drag: pan</span>
            <span className="hero-hint-sep">|</span>
            <span>Scroll: zoom</span>
            <span className="hero-hint-sep">|</span>
            <span>WASD/Arrows: nudge</span>
            <span className="hero-hint-sep">|</span>
            <span>+/-: zoom</span>
          </div>
        )}

        {/* ── SUBJECT SELECTOR ── */}
        <CollapsibleSection title="SUBJECT" defaultOpen>
          <div className="debug-button-row">
            <button
              className={`debug-action-btn${activeSubject?.type === "ship" ? " hero-active" : ""}`}
              onClick={() => handleSelectSubject({ type: "ship", id: currentShipId })}
              disabled={animating}
            >
              MY SHIP
            </button>
          </div>
          <div className="debug-button-row hero-planet-row">
            {planetNames.map((name) => (
              <button
                key={name}
                className={`debug-view-btn${activeSubject?.type === "planet" && activeSubject.id === name ? " hero-active" : ""}`}
                onClick={() => handleSelectSubject({ type: "planet", id: name })}
                disabled={animating}
              >
                {name.toUpperCase()}
              </button>
            ))}
          </div>
          {!activeSubject && (
            <div className="hero-hint">Select a subject to enter hero mode</div>
          )}
        </CollapsibleSection>

        {/* ── PREVIEW ANIMATION ── */}
        {activeSubject && (
          <CollapsibleSection title="PREVIEW" defaultOpen>
            <div className="debug-button-row">
              <button
                className={`debug-action-btn${animating ? " hero-active" : ""}`}
                onClick={handlePreviewToggle}
                disabled={animating}
              >
                {animating
                  ? "ANIMATING..."
                  : previewState === "composed"
                    ? "▶ PLAY TO GAMEPLAY"
                    : "▶ PLAY TO COMPOSED"}
              </button>
            </div>
            <div className="hero-hint">
              Animates between your composed shot and the gameplay view
            </div>
          </CollapsibleSection>
        )}

        {/* ── SHIP ORIENTATION ── */}
        {activeSubject?.type === "ship" && (
          <CollapsibleSection title="SHIP ORIENTATION" defaultOpen>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Heading</span>
              <input
                type="range"
                min={0}
                max={6.283}
                step={0.02}
                value={shipHeading}
                onChange={(e) => handleShipHeadingChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">
                {(shipHeading * (180 / Math.PI)).toFixed(0)}&deg;
              </span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Pitch</span>
              <input
                type="range"
                min={-1.57}
                max={1.57}
                step={0.02}
                value={shipTilt}
                onChange={(e) => handleShipTiltChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">
                {(shipTilt * (180 / Math.PI)).toFixed(0)}&deg;
              </span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Roll</span>
              <input
                type="range"
                min={-1.57}
                max={1.57}
                step={0.02}
                value={shipRoll}
                onChange={(e) => handleShipRollChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">
                {(shipRoll * (180 / Math.PI)).toFixed(0)}&deg;
              </span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Scale</span>
              <input
                type="range"
                min={0.5}
                max={5}
                step={0.05}
                value={shipScale}
                onChange={(e) => handleShipScaleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">
                {shipScale.toFixed(2)}x
              </span>
            </div>
            <div className="debug-button-row">
              <button
                className={`debug-action-btn hero-rotate-toggle${shipRotateMode ? " hero-active" : ""}`}
                onClick={handleToggleRotateMode}
              >
                {shipRotateMode ? "ROTATING WITH MOUSE" : "ROTATE WITH MOUSE"}
              </button>
            </div>
          </CollapsibleSection>
        )}

        {/* ── CAMERA ── */}
        {activeSubject && (
          <CollapsibleSection title="CAMERA" defaultOpen>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Zoom</span>
              <input
                type="range"
                min={0.1}
                max={10}
                step={0.05}
                value={zoom.value}
                onChange={(e) => zoom.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{zoom.value.toFixed(2)}x</span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Pan X</span>
              <input
                type="range"
                min={-100}
                max={100}
                step={0.5}
                value={panX.value}
                onChange={(e) => panX.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{panX.value.toFixed(1)}</span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Pan Y</span>
              <input
                type="range"
                min={-100}
                max={100}
                step={0.5}
                value={panY.value}
                onChange={(e) => panY.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{panY.value.toFixed(1)}</span>
            </div>
          </CollapsibleSection>
        )}

        {/* ── EFFECTS ── */}
        {activeSubject && (
          <CollapsibleSection title="EFFECTS" defaultOpen>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Bloom</span>
              <input
                type="range"
                min={0}
                max={5}
                step={0.05}
                value={bloomStrength.value}
                onChange={(e) => bloomStrength.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{bloomStrength.value.toFixed(2)}</span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Bloom R</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.02}
                value={bloomRadius.value}
                onChange={(e) => bloomRadius.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{bloomRadius.value.toFixed(2)}</span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Bloom T</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.02}
                value={bloomThreshold.value}
                onChange={(e) => bloomThreshold.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{bloomThreshold.value.toFixed(2)}</span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Vignette</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.02}
                value={vignetteIntensity.value}
                onChange={(e) => vignetteIntensity.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{vignetteIntensity.value.toFixed(2)}</span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Vig Soft</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={vignetteSoftness.value}
                onChange={(e) => vignetteSoftness.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{vignetteSoftness.value.toFixed(2)}</span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Letterbox</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={letterbox.value}
                onChange={(e) => letterbox.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{letterbox.value.toFixed(2)}</span>
            </div>
          </CollapsibleSection>
        )}

        {/* ── COLOR CORRECTION ── */}
        {activeSubject && (
          <CollapsibleSection title="COLOR CORRECTION" defaultOpen>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Bright</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.02}
                value={brightness.value}
                onChange={(e) => brightness.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{brightness.value.toFixed(2)}</span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Contrast</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.02}
                value={contrast.value}
                onChange={(e) => contrast.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{contrast.value.toFixed(2)}</span>
            </div>
            <div className="debug-slider-row">
              <span className="debug-slider-label">Exposure</span>
              <input
                type="range"
                min={0.1}
                max={3}
                step={0.02}
                value={exposure.value}
                onChange={(e) => exposure.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{exposure.value.toFixed(2)}</span>
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
    </>
  );
}
