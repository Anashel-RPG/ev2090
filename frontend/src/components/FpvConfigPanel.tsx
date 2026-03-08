/**
 * FpvConfigPanel — temporary authoring tool for FPV post-processing.
 *
 * Shows when FPV is fully active. Lets you tune vignette, bloom, and
 * color correction for the FPV "last frame". Values are applied live
 * during the FPV transition via Engine.fpvPostConfig.
 *
 * COPY CONFIG exports the current values for baking into the codebase.
 */
import { useState, useCallback, useEffect } from "react";
import "./FpvConfigPanel.css";

interface FpvConfigPanelProps {
  visible: boolean;
  getConfig: () => Record<string, number>;
  setParam: (key: string, value: number) => void;
}

interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

const VIGNETTE_SLIDERS: SliderDef[] = [
  { key: "vignetteIntensity", label: "Intensity", min: 0, max: 2, step: 0.01 },
  { key: "vignetteSoftness", label: "Softness", min: 0, max: 1, step: 0.01 },
];

const BLOOM_SLIDERS: SliderDef[] = [
  { key: "bloomStrength", label: "Strength", min: 0, max: 3, step: 0.01 },
  { key: "bloomRadius", label: "Radius", min: 0, max: 2, step: 0.01 },
  { key: "bloomThreshold", label: "Threshold", min: 0, max: 1.5, step: 0.01 },
];

const COLOR_SLIDERS: SliderDef[] = [
  { key: "brightness", label: "Brightness", min: 0.5, max: 2, step: 0.01 },
  { key: "contrast", label: "Contrast", min: 0.5, max: 2, step: 0.01 },
  { key: "exposure", label: "Exposure", min: 0.1, max: 3, step: 0.01 },
];

const LIGHT_SLIDERS: SliderDef[] = [
  { key: "ambientIntensity", label: "Ambient", min: 0, max: 3, step: 0.01 },
  { key: "hemisphereIntensity", label: "Hemisphere", min: 0, max: 3, step: 0.01 },
  { key: "keyLightIntensity", label: "Key Light", min: 0, max: 15, step: 0.1 },
  { key: "fillLightIntensity", label: "Fill Light", min: 0, max: 10, step: 0.1 },
  { key: "rimLightIntensity", label: "Rim Light", min: 0, max: 10, step: 0.1 },
  { key: "fpvLightIntensity", label: "Edge Light", min: 0, max: 15, step: 0.1 },
];

const LIGHT_POS_SLIDERS: SliderDef[] = [
  { key: "keyLightX", label: "Key X", min: -100, max: 100, step: 1 },
  { key: "keyLightY", label: "Key Y", min: -100, max: 100, step: 1 },
  { key: "keyLightZ", label: "Key Z", min: -100, max: 100, step: 1 },
  { key: "fillLightX", label: "Fill X", min: -100, max: 100, step: 1 },
  { key: "fillLightY", label: "Fill Y", min: -100, max: 100, step: 1 },
  { key: "fillLightZ", label: "Fill Z", min: -100, max: 100, step: 1 },
  { key: "rimLightX", label: "Rim X", min: -100, max: 100, step: 1 },
  { key: "rimLightY", label: "Rim Y", min: -100, max: 100, step: 1 },
  { key: "rimLightZ", label: "Rim Z", min: -100, max: 100, step: 1 },
  { key: "fpvLightX", label: "Edge X", min: -100, max: 100, step: 1 },
  { key: "fpvLightY", label: "Edge Y", min: -100, max: 100, step: 1 },
  { key: "fpvLightZ", label: "Edge Z", min: -100, max: 100, step: 1 },
];

const CAMERA_SLIDERS: SliderDef[] = [
  { key: "fpvHeight", label: "Height", min: 0.5, max: 20, step: 0.1 },
  { key: "fpvLookUp", label: "Look Up", min: -20, max: 40, step: 0.5 },
  { key: "fpvBehind", label: "Behind", min: -10, max: 15, step: 0.1 },
  { key: "fpvNpcZ", label: "NPC Z", min: -15, max: 30, step: 0.5 },
  { key: "fpvPlanetZ", label: "Planet Z", min: -10, max: 20, step: 0.5 },
];

const BANK_SLIDERS: SliderDef[] = [
  { key: "fpvBankX", label: "Bank X", min: -2, max: 2, step: 0.01 },
  { key: "fpvBankY", label: "Bank Y", min: -2, max: 2, step: 0.01 },
  { key: "fpvBankZ", label: "Bank Z", min: -2, max: 2, step: 0.01 },
];

export function FpvConfigPanel({ visible, getConfig, setParam }: FpvConfigPanelProps) {
  const [values, setValues] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);

  // Sync values from engine on mount/visibility change
  useEffect(() => {
    if (visible) {
      setValues(getConfig());
    }
  }, [visible, getConfig]);

  // Periodic refresh to keep values in sync (engine may lerp them)
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setValues(getConfig());
      setTick((t) => t + 1);
    }, 200);
    return () => clearInterval(id);
  }, [visible, getConfig, tick]);

  const handleChange = useCallback(
    (key: string, value: number) => {
      setParam(key, value);
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    [setParam],
  );

  const handleCopy = useCallback(() => {
    const config = getConfig();
    const json = JSON.stringify(config, null, 2);
    navigator.clipboard.writeText(json).catch(() => {});
  }, [getConfig]);

  const renderSlider = (def: SliderDef) => {
    const val = values[def.key] ?? 0;
    return (
      <div className="fpv-config-row" key={def.key}>
        <span className="fpv-config-label">{def.label}</span>
        <input
          className="fpv-config-slider"
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={val}
          onChange={(e) => handleChange(def.key, parseFloat(e.target.value))}
        />
        <span className="fpv-config-value">{val.toFixed(2)}</span>
      </div>
    );
  };

  return (
    <div className={`fpv-config-panel ${visible ? "fpv-config-visible" : ""}`}>
      <div className="fpv-config-header">
        <span className="fpv-config-title">FPV POST-FX</span>
        <button className="fpv-config-copy" onClick={handleCopy}>
          COPY
        </button>
      </div>

      <div className="fpv-config-section">CAMERA</div>
      {CAMERA_SLIDERS.map(renderSlider)}

      <div className="fpv-config-section">BANK</div>
      {BANK_SLIDERS.map(renderSlider)}

      <div className="fpv-config-section">VIGNETTE</div>
      {VIGNETTE_SLIDERS.map(renderSlider)}

      <div className="fpv-config-section">BLOOM</div>
      {BLOOM_SLIDERS.map(renderSlider)}

      <div className="fpv-config-section">COLOR</div>
      {COLOR_SLIDERS.map(renderSlider)}

      <div className="fpv-config-section">LIGHTING</div>
      {LIGHT_SLIDERS.map(renderSlider)}

      <div className="fpv-config-section">LIGHT POSITION</div>
      {LIGHT_POS_SLIDERS.map(renderSlider)}
    </div>
  );
}
