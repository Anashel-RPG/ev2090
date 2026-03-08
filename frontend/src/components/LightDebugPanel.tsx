import { useState, useCallback, useEffect } from "react";
import type { LightConfig } from "@/types/game";
import type { DebugView } from "@/engine/systems/CameraController";
import { CollapsibleSection } from "./config/CollapsibleSection";
import { useConfigSlider } from "@/hooks/useConfigSlider";
import "./LightDebugPanel.css";

interface Props {
  getLightConfig: () => LightConfig | null;
  updateLight: (lightName: string, property: string, value: number) => void;
  updateShipMaterial: (property: string, value: number) => void;
  enabled: boolean;
  onClose: () => void;
  onSpawnTestShip: () => void;
  onSpawnTestRing: () => void;
  onClearTestShips: () => void;
  onSetDebugView: (view: DebugView) => void;
  getDebugView: () => DebugView;
  onSetBeamVisible: (visible: boolean) => void;
  isBeamVisible: () => boolean;
  // Authoring tools
  onOpenHeroShot?: () => void;
  onOpenHardpointEditor?: () => void;
  // Per-ship tuning
  currentShipId?: string;
  // Camera controls (optional for backward compat)
  fps?: number;
  onSetZoom?: (factor: number) => void;
  getZoom?: () => number;
  onSetCameraOffset?: (x: number, y: number) => void;
  getCameraOffset?: () => { x: number; y: number };
}

interface SliderDef {
  group: string;
  light: string;
  prop: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SCAN_COLOR_PRESETS = [
  { name: "Green", r: 0.0, g: 1.0, b: 0.53 },
  { name: "Cyan", r: 0.0, g: 0.9, b: 1.0 },
  { name: "Orange", r: 1.0, g: 0.55, b: 0.0 },
  { name: "Red", r: 1.0, g: 0.2, b: 0.1 },
  { name: "Purple", r: 0.7, g: 0.3, b: 1.0 },
  { name: "White", r: 1.0, g: 1.0, b: 1.0 },
];

const DEBUG_VIEWS: { id: DebugView; label: string; desc: string }[] = [
  { id: "normal", label: "TOP", desc: "Default top-down orthographic" },
  { id: "side", label: "SIDE", desc: "Fixed side view from world +X" },
  { id: "iso", label: "ISO", desc: "Isometric elevated view (right)" },
  { id: "iso-r", label: "ISO-R", desc: "Isometric elevated view (left)" },
  { id: "orbit", label: "ORBIT", desc: "Mouse drag to orbit around target ship" },
];

const SLIDERS: SliderDef[] = [
  // Ambient
  { group: "AMBIENT", light: "ambient", prop: "intensity", label: "Intensity", min: 0, max: 3, step: 0.05 },
  // Hemisphere
  { group: "HEMISPHERE", light: "hemisphere", prop: "intensity", label: "Intensity", min: 0, max: 3, step: 0.05 },
  // Key Light
  { group: "KEY LIGHT", light: "keyLight", prop: "intensity", label: "Intensity", min: 0, max: 8, step: 0.1 },
  { group: "KEY LIGHT", light: "keyLight", prop: "x", label: "X", min: -100, max: 100, step: 1 },
  { group: "KEY LIGHT", light: "keyLight", prop: "y", label: "Y", min: -100, max: 100, step: 1 },
  { group: "KEY LIGHT", light: "keyLight", prop: "z", label: "Z", min: 0, max: 150, step: 1 },
  // Fill Light
  { group: "FILL LIGHT", light: "fillLight", prop: "intensity", label: "Intensity", min: 0, max: 5, step: 0.1 },
  { group: "FILL LIGHT", light: "fillLight", prop: "x", label: "X", min: -100, max: 100, step: 1 },
  { group: "FILL LIGHT", light: "fillLight", prop: "y", label: "Y", min: -100, max: 100, step: 1 },
  { group: "FILL LIGHT", light: "fillLight", prop: "z", label: "Z", min: 0, max: 150, step: 1 },
  // Rim Light
  { group: "RIM LIGHT", light: "rimLight", prop: "intensity", label: "Intensity", min: 0, max: 5, step: 0.1 },
  { group: "RIM LIGHT", light: "rimLight", prop: "x", label: "X", min: -100, max: 100, step: 1 },
  { group: "RIM LIGHT", light: "rimLight", prop: "y", label: "Y", min: -100, max: 100, step: 1 },
  { group: "RIM LIGHT", light: "rimLight", prop: "z", label: "Z", min: 0, max: 150, step: 1 },
];

const MATERIAL_SLIDERS = [
  { prop: "metalness", label: "Metalness", min: 0, max: 1, step: 0.05 },
  { prop: "roughness", label: "Roughness", min: 0, max: 1, step: 0.05 },
  { prop: "emissiveIntensity", label: "Emissive", min: 0, max: 1, step: 0.05 },
];

// Default values for reset
const DEFAULTS = {
  shipTilt: -22,
  modelRx: 90,
  modelRy: 180,
  modelRz: 0,
  sidebarOpacity: 0.60,
  sidebarBlur: 40,
  bgImageOpacity: 0.14,
  bgNebulaOpacity: 0.20,
  shieldScale: 0.315,
  fresnelPow: 0.1,
  dissipation: 2.3,
  ovalX: 3.6,
  ovalY: 1.4,
  baseOpacity: 0.04,
  hitOpacity: 1.0,
  hitRadius: 1.5,
  colorR: 0.7,
  colorG: 0.3,
  colorB: 1.0,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  brightness: 1.34,
  contrast: 0.98,
  exposure: 1.16,
  bloomStrength: 0.41,
  bloomRadius: 1.62,
  bloomThreshold: 0.69,
  vignetteIntensity: 0,
  vignetteSoftness: 0,
};

function getNestedValue(config: LightConfig, light: string, prop: string): number {
  const group = config[light as keyof LightConfig] as Record<string, number>;
  return group?.[prop] ?? 0;
}

export function LightDebugPanel({
  getLightConfig,
  updateLight,
  updateShipMaterial,
  enabled,
  onClose,
  onSpawnTestShip,
  onSpawnTestRing,
  onClearTestShips,
  onSetDebugView,
  getDebugView,
  onSetBeamVisible,
  isBeamVisible,
  onOpenHeroShot,
  onOpenHardpointEditor,
  currentShipId,
  fps,
  onSetZoom,
  getZoom: _getZoom,
  onSetCameraOffset,
  getCameraOffset: _getCameraOffset,
}: Props) {
  // getZoom/getCameraOffset available for future use (reading engine state on open)
  void _getZoom;
  void _getCameraOffset;
  const [config, setConfig] = useState<LightConfig | null>(null);
  const [copied, setCopied] = useState(false);

  // Debug inspection controls
  const [debugView, setDebugViewState] = useState<DebugView>("normal");
  const [beamVisible, setBeamVisibleState] = useState(false);

  // Shield color (can't use useConfigSlider since color presets set 3 at once)
  const [scanColorR, setScanColorR] = useState(DEFAULTS.colorR);
  const [scanColorG, setScanColorG] = useState(DEFAULTS.colorG);
  const [scanColorB, setScanColorB] = useState(DEFAULTS.colorB);

  // --- useConfigSlider for all scalar sliders ---

  // Camera
  const cameraZoom = useConfigSlider({ initial: DEFAULTS.zoom, onChange: (v) => onSetZoom?.(v) });
  const cameraOffsetX = useConfigSlider({ initial: DEFAULTS.offsetX, onChange: (v) => onSetCameraOffset?.(v, cameraOffsetY.value) });
  const cameraOffsetY = useConfigSlider({ initial: DEFAULTS.offsetY, onChange: (v) => onSetCameraOffset?.(cameraOffsetX.value, v) });

  // Sidebar glass
  const sidebarOpacity = useConfigSlider({ initial: DEFAULTS.sidebarOpacity, onChange: (v) => document.documentElement.style.setProperty("--sidebar-bg-opacity", String(v)) });
  const sidebarBlur = useConfigSlider({ initial: DEFAULTS.sidebarBlur, onChange: (v) => document.documentElement.style.setProperty("--sidebar-blur", `${v}px`) });

  // Background
  const bgImageOpacity = useConfigSlider({ initial: DEFAULTS.bgImageOpacity, onChange: (v) => updateLight("background", "imageOpacity", v) });
  const bgNebulaOpacity = useConfigSlider({ initial: DEFAULTS.bgNebulaOpacity, onChange: (v) => updateLight("background", "nebulaOpacity", v) });

  // Shield
  const shieldScale = useConfigSlider({ initial: DEFAULTS.shieldScale, onChange: (v) => updateLight("scanOutline", "shieldScale", v) });
  const fresnelPow = useConfigSlider({ initial: DEFAULTS.fresnelPow, onChange: (v) => updateLight("scanOutline", "fresnelPow", v) });
  const dissipation = useConfigSlider({ initial: DEFAULTS.dissipation, onChange: (v) => updateLight("scanOutline", "dissipation", v) });
  const ovalX = useConfigSlider({ initial: DEFAULTS.ovalX, onChange: (v) => updateLight("scanOutline", "ovalX", v) });
  const ovalY = useConfigSlider({ initial: DEFAULTS.ovalY, onChange: (v) => updateLight("scanOutline", "ovalY", v) });
  const baseOpacity = useConfigSlider({ initial: DEFAULTS.baseOpacity, onChange: (v) => updateLight("scanOutline", "baseOpacity", v) });
  const hitOpacity = useConfigSlider({ initial: DEFAULTS.hitOpacity, onChange: (v) => updateLight("scanOutline", "hitOpacity", v) });
  const hitRadius = useConfigSlider({ initial: DEFAULTS.hitRadius, onChange: (v) => updateLight("scanOutline", "hitRadius", v) });

  // Color correction (post-processing)
  const ccBrightness = useConfigSlider({ initial: DEFAULTS.brightness, onChange: (v) => updateLight("colorCorrection", "brightness", v) });
  const ccContrast = useConfigSlider({ initial: DEFAULTS.contrast, onChange: (v) => updateLight("colorCorrection", "contrast", v) });
  const ccExposure = useConfigSlider({ initial: DEFAULTS.exposure, onChange: (v) => updateLight("colorCorrection", "exposure", v) });

  // Bloom & Vignette (post-processing)
  const ppBloomStrength = useConfigSlider({ initial: DEFAULTS.bloomStrength, onChange: (v) => updateLight("colorCorrection", "bloomStrength", v) });
  const ppBloomRadius = useConfigSlider({ initial: DEFAULTS.bloomRadius, onChange: (v) => updateLight("colorCorrection", "bloomRadius", v) });
  const ppBloomThreshold = useConfigSlider({ initial: DEFAULTS.bloomThreshold, onChange: (v) => updateLight("colorCorrection", "bloomThreshold", v) });
  const ppVignetteIntensity = useConfigSlider({ initial: DEFAULTS.vignetteIntensity, onChange: (v) => updateLight("colorCorrection", "vignetteIntensity", v) });
  const ppVignetteSoftness = useConfigSlider({ initial: DEFAULTS.vignetteSoftness, onChange: (v) => updateLight("colorCorrection", "vignetteSoftness", v) });

  // Ship model
  const shipTilt = useConfigSlider({ initial: DEFAULTS.shipTilt, onChange: (v) => updateLight("shipTilt", "x", (v * Math.PI) / 180) });
  const modelRx = useConfigSlider({ initial: DEFAULTS.modelRx, onChange: (v) => updateLight("modelRotation", "rx", (v * Math.PI) / 180) });
  const modelRy = useConfigSlider({ initial: DEFAULTS.modelRy, onChange: (v) => updateLight("modelRotation", "ry", (v * Math.PI) / 180) });
  const modelRz = useConfigSlider({ initial: DEFAULTS.modelRz, onChange: (v) => updateLight("modelRotation", "rz", (v * Math.PI) / 180) });

  // Load initial config when panel opens
  useEffect(() => {
    if (enabled && !config) {
      const c = getLightConfig();
      if (c) setConfig(c);
      // Sync debug state from engine
      setDebugViewState(getDebugView());
      setBeamVisibleState(isBeamVisible());
    }
  }, [enabled, config, getLightConfig, getDebugView, isBeamVisible]);

  // Reset config when disabled so it reloads fresh on next open
  useEffect(() => {
    if (!enabled) setConfig(null);
  }, [enabled]);

  const handleSliderChange = useCallback(
    (light: string, prop: string, value: number) => {
      updateLight(light, prop, value);
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [light]: { ...(prev[light as keyof LightConfig] as Record<string, number>), [prop]: value },
        };
      });
    },
    [updateLight],
  );

  const handleMaterialChange = useCallback(
    (prop: string, value: number) => {
      updateShipMaterial(prop, value);
      setConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          material: { ...prev.material, [prop]: value },
        };
      });
    },
    [updateShipMaterial],
  );

  const handleScanColorPreset = useCallback((r: number, g: number, b: number) => {
    setScanColorR(r);
    setScanColorG(g);
    setScanColorB(b);
    updateLight("scanOutline", "colorR", r);
    updateLight("scanOutline", "colorG", g);
    updateLight("scanOutline", "colorB", b);
  }, [updateLight]);

  const handleDebugView = useCallback((view: DebugView) => {
    setDebugViewState(view);
    onSetDebugView(view);
  }, [onSetDebugView]);

  const handleToggleBeam = useCallback(() => {
    const next = !beamVisible;
    setBeamVisibleState(next);
    onSetBeamVisible(next);
  }, [beamVisible, onSetBeamVisible]);

  // --- Reset handlers per section ---

  const resetCamera = useCallback(() => {
    cameraZoom.reset(DEFAULTS.zoom);
    cameraOffsetX.reset(DEFAULTS.offsetX);
    cameraOffsetY.reset(DEFAULTS.offsetY);
    onSetZoom?.(DEFAULTS.zoom);
    onSetCameraOffset?.(DEFAULTS.offsetX, DEFAULTS.offsetY);
  }, [cameraZoom, cameraOffsetX, cameraOffsetY, onSetZoom, onSetCameraOffset]);

  const resetColorCorrection = useCallback(() => {
    ccBrightness.reset(DEFAULTS.brightness);
    ccContrast.reset(DEFAULTS.contrast);
    ccExposure.reset(DEFAULTS.exposure);
  }, [ccBrightness, ccContrast, ccExposure]);

  const resetPostProcessing = useCallback(() => {
    ppBloomStrength.reset(DEFAULTS.bloomStrength);
    ppBloomRadius.reset(DEFAULTS.bloomRadius);
    ppBloomThreshold.reset(DEFAULTS.bloomThreshold);
    ppVignetteIntensity.reset(DEFAULTS.vignetteIntensity);
    ppVignetteSoftness.reset(DEFAULTS.vignetteSoftness);
  }, [ppBloomStrength, ppBloomRadius, ppBloomThreshold, ppVignetteIntensity, ppVignetteSoftness]);

  const resetSidebarGlass = useCallback(() => {
    sidebarOpacity.reset(DEFAULTS.sidebarOpacity);
    sidebarBlur.reset(DEFAULTS.sidebarBlur);
  }, [sidebarOpacity, sidebarBlur]);

  const resetBackground = useCallback(() => {
    bgImageOpacity.reset(DEFAULTS.bgImageOpacity);
    bgNebulaOpacity.reset(DEFAULTS.bgNebulaOpacity);
  }, [bgImageOpacity, bgNebulaOpacity]);

  const resetShield = useCallback(() => {
    shieldScale.reset(DEFAULTS.shieldScale);
    fresnelPow.reset(DEFAULTS.fresnelPow);
    dissipation.reset(DEFAULTS.dissipation);
    ovalX.reset(DEFAULTS.ovalX);
    ovalY.reset(DEFAULTS.ovalY);
    baseOpacity.reset(DEFAULTS.baseOpacity);
    hitOpacity.reset(DEFAULTS.hitOpacity);
    hitRadius.reset(DEFAULTS.hitRadius);
    handleScanColorPreset(DEFAULTS.colorR, DEFAULTS.colorG, DEFAULTS.colorB);
  }, [shieldScale, fresnelPow, dissipation, ovalX, ovalY, baseOpacity, hitOpacity, hitRadius, handleScanColorPreset]);

  const resetShipModel = useCallback(() => {
    shipTilt.reset(DEFAULTS.shipTilt);
    modelRx.reset(DEFAULTS.modelRx);
    modelRy.reset(DEFAULTS.modelRy);
    modelRz.reset(DEFAULTS.modelRz);
  }, [shipTilt, modelRx, modelRy, modelRz]);

  const resetLighting = useCallback(() => {
    if (!config) return;
    const initial = getLightConfig();
    if (initial) {
      setConfig(initial);
      // Re-apply all light values from the initial config
      for (const s of SLIDERS) {
        const val = getNestedValue(initial, s.light, s.prop);
        updateLight(s.light, s.prop, val);
      }
    }
  }, [config, getLightConfig, updateLight]);

  const resetMaterial = useCallback(() => {
    const defaults = { metalness: 0.4, roughness: 0.5, emissiveIntensity: 0 };
    for (const s of MATERIAL_SLIDERS) {
      const val = defaults[s.prop as keyof typeof defaults] ?? 0;
      handleMaterialChange(s.prop, val);
    }
  }, [handleMaterialChange]);

  // --- Copy config ---

  const handleCopy = useCallback(() => {
    if (!config) return;
    const output = {
      ambient: config.ambient,
      hemisphere: config.hemisphere,
      keyLight: config.keyLight,
      fillLight: config.fillLight,
      rimLight: config.rimLight,
      material: config.material,
      shipTiltDegrees: shipTilt.value,
      modelRotationDegrees: { rx: modelRx.value, ry: modelRy.value, rz: modelRz.value },
      sidebar: { bgOpacity: sidebarOpacity.value, blur: sidebarBlur.value },
      background: { imageOpacity: bgImageOpacity.value, nebulaOpacity: bgNebulaOpacity.value },
      shield: {
        shieldScale: shieldScale.value,
        fresnelPow: fresnelPow.value,
        dissipation: dissipation.value,
        ovalX: ovalX.value, ovalY: ovalY.value,
        baseOpacity: baseOpacity.value, hitOpacity: hitOpacity.value,
        hitRadius: hitRadius.value,
        color: [scanColorR, scanColorG, scanColorB],
      },
      camera: {
        zoom: cameraZoom.value,
        offsetX: cameraOffsetX.value,
        offsetY: cameraOffsetY.value,
      },
      colorCorrection: {
        brightness: +ccBrightness.value.toFixed(2),
        contrast: +ccContrast.value.toFixed(2),
        exposure: +ccExposure.value.toFixed(2),
      },
      postProcessing: {
        bloomStrength: +ppBloomStrength.value.toFixed(2),
        bloomRadius: +ppBloomRadius.value.toFixed(2),
        bloomThreshold: +ppBloomThreshold.value.toFixed(2),
        vignetteIntensity: +ppVignetteIntensity.value.toFixed(2),
        vignetteSoftness: +ppVignetteSoftness.value.toFixed(2),
      },
    };
    navigator.clipboard.writeText(JSON.stringify(output, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [config, shipTilt, modelRx, modelRy, modelRz, sidebarOpacity, sidebarBlur, bgImageOpacity, bgNebulaOpacity, shieldScale, fresnelPow, dissipation, ovalX, ovalY, baseOpacity, hitOpacity, hitRadius, scanColorR, scanColorG, scanColorB, cameraZoom, cameraOffsetX, cameraOffsetY, ccBrightness, ccContrast, ccExposure, ppBloomStrength, ppBloomRadius, ppBloomThreshold, ppVignetteIntensity, ppVignetteSoftness, currentShipId]);

  // Hidden by default -- no toggle button rendered
  if (!enabled || !config) return null;

  return (
    <div className="debug-panel">
      <div className="debug-header">
        <span>CONFIG</span>
        <div className="debug-header-buttons">
          {fps != null && (
            <span className="debug-fps">{fps} FPS</span>
          )}
          <button className="debug-copy" onClick={handleCopy}>
            {copied ? "COPIED!" : "COPY CONFIG"}
          </button>
          <button className="debug-close" onClick={onClose}>
            x
          </button>
        </div>
      </div>

      <div className="debug-scroll">
        {/* ── DEBUG TOOLS (default open) ── */}
        <CollapsibleSection title="DEBUG TOOLS" defaultOpen>
          <div className="debug-button-row">
            <button className="debug-action-btn" onClick={() => { onSpawnTestShip(); if (!beamVisible) handleToggleBeam(); }}>
              SPAWN 1
            </button>
            <button className="debug-action-btn" onClick={() => { onSpawnTestRing(); if (!beamVisible) handleToggleBeam(); }}>
              SPAWN RING
            </button>
            <button className="debug-action-btn" onClick={onClearTestShips}>
              CLEAR
            </button>
          </div>
          <div className="debug-button-row">
            <button
              className={`debug-action-btn${beamVisible ? " active" : ""}`}
              onClick={handleToggleBeam}
            >
              {beamVisible ? "BEAM ON" : "BEAM OFF"}
            </button>
          </div>
          <div className="debug-button-row">
            {DEBUG_VIEWS.map((v) => (
              <button
                key={v.id}
                className={`debug-view-btn${debugView === v.id ? " active" : ""}`}
                onClick={() => handleDebugView(v.id)}
                title={v.desc}
              >
                {v.label}
              </button>
            ))}
          </div>
          {/* Authoring tool launchers */}
          <div className="debug-button-row">
            <button className="debug-action-btn" onClick={onOpenHeroShot}>
              HERO SHOT
            </button>
            <button className="debug-action-btn" onClick={onOpenHardpointEditor}>
              HARDPOINTS
            </button>
          </div>
        </CollapsibleSection>

        {/* ── CAMERA ── */}
        <CollapsibleSection title="CAMERA" onReset={resetCamera}>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Zoom</span>
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.1}
              value={cameraZoom.value}
              onChange={(e) => cameraZoom.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{cameraZoom.value.toFixed(1)}x</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Offset X</span>
            <input
              type="range"
              min={-20}
              max={20}
              step={0.5}
              value={cameraOffsetX.value}
              onChange={(e) => cameraOffsetX.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{cameraOffsetX.value.toFixed(1)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Offset Y</span>
            <input
              type="range"
              min={-20}
              max={20}
              step={0.5}
              value={cameraOffsetY.value}
              onChange={(e) => cameraOffsetY.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{cameraOffsetY.value.toFixed(1)}</span>
          </div>
        </CollapsibleSection>

        {/* ── COLOR CORRECTION ── */}
        <CollapsibleSection title="COLOR CORRECTION" onReset={resetColorCorrection}>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Bright</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.02}
              value={ccBrightness.value}
              onChange={(e) => ccBrightness.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ccBrightness.value.toFixed(2)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Contrast</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.02}
              value={ccContrast.value}
              onChange={(e) => ccContrast.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ccContrast.value.toFixed(2)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Exposure</span>
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.02}
              value={ccExposure.value}
              onChange={(e) => ccExposure.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ccExposure.value.toFixed(2)}</span>
          </div>
        </CollapsibleSection>

        {/* ── POST-PROCESSING (Bloom + Vignette) ── */}
        <CollapsibleSection title="POST-PROCESSING" onReset={resetPostProcessing}>
          <div className="debug-group-sublabel">BLOOM</div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Strength</span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.01}
              value={ppBloomStrength.value}
              onChange={(e) => ppBloomStrength.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ppBloomStrength.value.toFixed(2)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Radius</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={ppBloomRadius.value}
              onChange={(e) => ppBloomRadius.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ppBloomRadius.value.toFixed(2)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Threshold</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={ppBloomThreshold.value}
              onChange={(e) => ppBloomThreshold.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ppBloomThreshold.value.toFixed(2)}</span>
          </div>
          <div className="debug-group-sublabel">VIGNETTE</div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Intensity</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={ppVignetteIntensity.value}
              onChange={(e) => ppVignetteIntensity.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ppVignetteIntensity.value.toFixed(2)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Softness</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={ppVignetteSoftness.value}
              onChange={(e) => ppVignetteSoftness.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ppVignetteSoftness.value.toFixed(2)}</span>
          </div>
        </CollapsibleSection>

        {/* ── SIDEBAR GLASS ── */}
        <CollapsibleSection title="SIDEBAR GLASS" onReset={resetSidebarGlass}>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={sidebarOpacity.value}
              onChange={(e) => sidebarOpacity.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{sidebarOpacity.value.toFixed(2)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Blur</span>
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={sidebarBlur.value}
              onChange={(e) => sidebarBlur.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{sidebarBlur.value}px</span>
          </div>
        </CollapsibleSection>

        {/* ── BACKGROUND ── */}
        <CollapsibleSection title="BACKGROUND" onReset={resetBackground}>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Image</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={bgImageOpacity.value}
              onChange={(e) => bgImageOpacity.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{bgImageOpacity.value.toFixed(2)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Nebula</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={bgNebulaOpacity.value}
              onChange={(e) => bgNebulaOpacity.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{bgNebulaOpacity.value.toFixed(2)}</span>
          </div>
        </CollapsibleSection>

        {/* ── SHIELD ── */}
        <CollapsibleSection title="SHIELD" onReset={resetShield}>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Scale</span>
            <input
              type="range"
              min={0.005}
              max={0.5}
              step={0.005}
              value={shieldScale.value}
              onChange={(e) => shieldScale.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{shieldScale.value.toFixed(3)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Fresnel</span>
            <input
              type="range"
              min={0.1}
              max={8}
              step={0.1}
              value={fresnelPow.value}
              onChange={(e) => fresnelPow.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{fresnelPow.value.toFixed(1)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Dissipation</span>
            <input
              type="range"
              min={0.1}
              max={10}
              step={0.1}
              value={dissipation.value}
              onChange={(e) => dissipation.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{dissipation.value.toFixed(1)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Oval X</span>
            <input
              type="range"
              min={0.2}
              max={5}
              step={0.1}
              value={ovalX.value}
              onChange={(e) => ovalX.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ovalX.value.toFixed(1)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Oval Y</span>
            <input
              type="range"
              min={0.2}
              max={5}
              step={0.1}
              value={ovalY.value}
              onChange={(e) => ovalY.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{ovalY.value.toFixed(1)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Base a</span>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={baseOpacity.value}
              onChange={(e) => baseOpacity.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{baseOpacity.value.toFixed(2)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Hit a</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={hitOpacity.value}
              onChange={(e) => hitOpacity.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{hitOpacity.value.toFixed(2)}</span>
          </div>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Hit W</span>
            <input
              type="range"
              min={0.2}
              max={6}
              step={0.1}
              value={hitRadius.value}
              onChange={(e) => hitRadius.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{hitRadius.value.toFixed(1)}</span>
          </div>
          <div className="debug-color-presets">
            <span className="debug-slider-label">Color</span>
            {SCAN_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.name}
                className={`debug-color-swatch${
                  Math.abs(scanColorR - preset.r) < 0.01 &&
                  Math.abs(scanColorG - preset.g) < 0.01 &&
                  Math.abs(scanColorB - preset.b) < 0.01
                    ? " active"
                    : ""
                }`}
                style={{
                  background: `rgb(${Math.round(preset.r * 255)}, ${Math.round(preset.g * 255)}, ${Math.round(preset.b * 255)})`,
                }}
                onClick={() => handleScanColorPreset(preset.r, preset.g, preset.b)}
                title={preset.name}
              />
            ))}
          </div>
        </CollapsibleSection>

        {/* ── SHIP MODEL (merged tilt + rotation) ── */}
        <CollapsibleSection title="SHIP MODEL" onReset={resetShipModel}>
          <div className="debug-slider-row">
            <span className="debug-slider-label">Tilt</span>
            <input
              type="range"
              min={-30}
              max={30}
              step={1}
              value={shipTilt.value}
              onChange={(e) => shipTilt.handleChange(Number(e.target.value))}
              className="debug-slider"
            />
            <span className="debug-slider-value">{shipTilt.value}&deg;</span>
          </div>
          {([
            { label: "Rx", slider: modelRx },
            { label: "Ry", slider: modelRy },
            { label: "Rz", slider: modelRz },
          ] as const).map(({ label, slider }) => (
            <div className="debug-slider-row" key={label}>
              <span className="debug-slider-label">{label}</span>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={slider.value}
                onChange={(e) => slider.handleChange(Number(e.target.value))}
                className="debug-slider"
              />
              <span className="debug-slider-value">{slider.value}&deg;</span>
            </div>
          ))}
        </CollapsibleSection>

        {/* ── LIGHTING ── */}
        <CollapsibleSection title="LIGHTING" onReset={resetLighting}>
          {SLIDERS.map((s, i) => {
            const showSubLabel = i === 0 || SLIDERS[i - 1]!.group !== s.group;
            return (
              <div key={`${s.light}-${s.prop}`}>
                {showSubLabel && (
                  <div className="debug-group-sublabel">{s.group}</div>
                )}
                <div className="debug-slider-row">
                  <span className="debug-slider-label">{s.label}</span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={getNestedValue(config, s.light, s.prop)}
                    onChange={(e) =>
                      handleSliderChange(s.light, s.prop, Number(e.target.value))
                    }
                    className="debug-slider"
                  />
                  <span className="debug-slider-value">
                    {getNestedValue(config, s.light, s.prop).toFixed(
                      s.step < 1 ? 2 : 0,
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </CollapsibleSection>

        {/* ── MATERIAL ── */}
        <CollapsibleSection title="MATERIAL" onReset={resetMaterial}>
          {MATERIAL_SLIDERS.map((s) => (
            <div className="debug-slider-row" key={s.prop}>
              <span className="debug-slider-label">{s.label}</span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={config.material[s.prop as keyof typeof config.material]}
                onChange={(e) =>
                  handleMaterialChange(s.prop, Number(e.target.value))
                }
                className="debug-slider"
              />
              <span className="debug-slider-value">
                {config.material[
                  s.prop as keyof typeof config.material
                ].toFixed(2)}
              </span>
            </div>
          ))}
        </CollapsibleSection>
      </div>
    </div>
  );
}
