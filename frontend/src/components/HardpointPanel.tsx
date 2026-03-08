import { useState, useCallback, useEffect, useRef } from "react";
import { CollapsibleSection } from "./config/CollapsibleSection";
import { getAllShips } from "@/engine/ShipCatalog";
import type { ShipMaterialConfig } from "@/engine/systems/HardpointEditor";
import type { Hardpoint, HardpointType } from "@/types/game";
import "./HardpointPanel.css";

interface Props {
  enabled: boolean;
  onClose: () => void;
  currentShipId: string;
  // Engine bridge
  enterHardpointEditor: () => void;
  exitHardpointEditor: () => void;
  setPlacementType: (type: HardpointType) => void;
  getPlacementType: () => HardpointType;
  getHardpoints: () => Hardpoint[];
  deleteHardpoint: (id: string) => void;
  selectHardpoint: (id: string | null) => void;
  getSelectedId: () => string | null;
  changeShip: (shipId: string) => void;
  updatePosition: (id: string, axis: "x" | "y" | "z", value: number) => void;
  updateThrustAngle: (id: string, angleDeg: number) => void;
  // Ship tuning
  setShipScale: (scale: number) => void;
  getShipScale: () => number;
  // Axis lock
  setLockedAxis: (axis: "x" | "y" | "z" | null) => void;
  getLockedAxis: () => "x" | "y" | "z" | null;
  // Material tuning
  setMaterialProperty: (property: keyof ShipMaterialConfig, value: number) => void;
  getMaterialConfig: () => ShipMaterialConfig;
}

const HARDPOINT_TYPES: { type: HardpointType; label: string; color: string }[] = [
  { type: "thruster", label: "THRUSTER", color: "#ff6600" },
  { type: "weapon", label: "WEAPON", color: "#ff0000" },
  { type: "bridge", label: "BRIDGE", color: "#00ccff" },
  { type: "hull", label: "HULL", color: "#888888" },
  { type: "shield", label: "SHIELD", color: "#8833ff" },
];

const STEP = 0.05;
const POS_RANGE = 3; // slider range: -3 to +3
const HP_BUILD = "HP-v10.0"; // bump this on every meaningful change

export function HardpointPanel({
  enabled,
  onClose,
  currentShipId,
  enterHardpointEditor,
  exitHardpointEditor,
  setPlacementType,
  getPlacementType: _getPlacementType,
  getHardpoints,
  deleteHardpoint,
  selectHardpoint,
  getSelectedId,
  changeShip,
  updatePosition,
  updateThrustAngle,
  setShipScale,
  getShipScale,
  setLockedAxis,
  getLockedAxis,
  setMaterialProperty,
  getMaterialConfig,
}: Props) {
  const [activeType, setActiveType] = useState<HardpointType>("thruster");
  const [hardpoints, setHardpoints] = useState<Hardpoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editorStarted, setEditorStarted] = useState(false);
  const [scale, setScale] = useState(0.4);
  const [lockedAxis, setLockedAxisState] = useState<"x" | "y" | "z" | null>(null);
  const [matConfig, setMatConfig] = useState<ShipMaterialConfig>({
    metalness: 0.4, roughness: 0.2, emissiveIntensity: 0.15,
    emissiveR: 34, emissiveG: 34, emissiveB: 51,
  });

  // ─── Stable callback refs ───
  // Game.tsx passes inline arrows that create new references every render (~20fps).
  // Storing them in refs prevents useEffect dependencies from thrashing (the polling
  // interval would restart every 50ms and NEVER fire its 200ms callback).
  const cbRef = useRef({
    enterHardpointEditor,
    getHardpoints,
    getSelectedId,
    selectHardpoint,
    getLockedAxis,
    getShipScale,
    getMaterialConfig,
  });
  cbRef.current = {
    enterHardpointEditor,
    getHardpoints,
    getSelectedId,
    selectHardpoint,
    getLockedAxis,
    getShipScale,
    getMaterialConfig,
  };

  // Enter editor mode when panel opens
  useEffect(() => {
    if (enabled && !editorStarted) {
      cbRef.current.enterHardpointEditor();
      setEditorStarted(true);
    }
    if (!enabled && editorStarted) {
      setEditorStarted(false);
    }
  }, [enabled, editorStarted]);

  // Poll hardpoints and selection from engine; auto-select first if none selected.
  // Depends ONLY on `enabled` — callback refs keep it reading the latest functions.
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const { getHardpoints: gh, getSelectedId: gs, selectHardpoint: sh, getLockedAxis: gl } = cbRef.current;
      const hps = gh();
      setHardpoints(hps);
      const sel = gs();
      const first = hps[0];
      if (!sel && first) {
        // Auto-select the first hardpoint so ADJUST POSITION is always usable
        sh(first.id);
        setSelectedId(first.id);
      } else {
        setSelectedId(sel);
      }
      // Sync axis lock (can be changed by spacebar in engine)
      setLockedAxisState(gl());
    }, 200);
    return () => clearInterval(interval);
  }, [enabled]);

  // Reset scale/heading/material when ship changes
  useEffect(() => {
    if (!enabled) return;
    setScale(cbRef.current.getShipScale());
    setMatConfig(cbRef.current.getMaterialConfig());
  }, [enabled, currentShipId]);

  const handleTypeChange = useCallback(
    (type: HardpointType) => {
      setActiveType(type);
      setPlacementType(type);
    },
    [setPlacementType],
  );

  const handleSelect = useCallback(
    (id: string) => {
      selectHardpoint(id);
      setSelectedId(id);
    },
    [selectHardpoint],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteHardpoint(id);
      setHardpoints((prev) => prev.filter((h) => h.id !== id));
    },
    [deleteHardpoint],
  );

  const handleExit = useCallback(() => {
    exitHardpointEditor();
    setEditorStarted(false);
    onClose();
  }, [exitHardpointEditor, onClose]);

  const handleCopy = useCallback(() => {
    const output = {
      shipId: currentShipId,
      modelScale: +scale.toFixed(3),
      material: {
        metalness: +matConfig.metalness.toFixed(3),
        roughness: +matConfig.roughness.toFixed(3),
        emissiveIntensity: +matConfig.emissiveIntensity.toFixed(3),
        emissiveColor: `rgb(${matConfig.emissiveR}, ${matConfig.emissiveG}, ${matConfig.emissiveB})`,
      },
      points: hardpoints.map((h) => ({
        id: h.id,
        type: h.type,
        localX: h.localX,
        localY: h.localY,
        localZ: h.localZ,
        ...(h.label ? { label: h.label } : {}),
        ...(h.type === "thruster" && h.thrustAngleDeg ? { thrustAngleDeg: h.thrustAngleDeg } : {}),
      })),
    };
    navigator.clipboard.writeText(JSON.stringify(output, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [hardpoints, currentShipId, scale, matConfig]);

  const handleShipChange = useCallback(
    (shipId: string) => {
      changeShip(shipId);
    },
    [changeShip],
  );

  const handleAxisChange = useCallback(
    (id: string, axis: "x" | "y" | "z", value: number) => {
      updatePosition(id, axis, value);
      // Immediately update local state for responsive feel
      setHardpoints((prev) =>
        prev.map((h) => {
          if (h.id !== id) return h;
          const updated = { ...h };
          if (axis === "x") updated.localX = Math.round(value * 1000) / 1000;
          else if (axis === "y") updated.localY = Math.round(value * 1000) / 1000;
          else updated.localZ = Math.round(value * 1000) / 1000;
          return updated;
        }),
      );
    },
    [updatePosition],
  );

  const handleThrustAngleChange = useCallback(
    (id: string, angleDeg: number) => {
      updateThrustAngle(id, angleDeg);
      setHardpoints((prev) =>
        prev.map((h) => h.id === id ? { ...h, thrustAngleDeg: angleDeg } : h),
      );
    },
    [updateThrustAngle],
  );

  const handleScaleChange = useCallback(
    (value: number) => {
      const clamped = Math.max(0.01, Math.min(3, value));
      setScale(clamped);
      setShipScale(clamped);
    },
    [setShipScale],
  );

  const handleToggleAxis = useCallback(
    (axis: "x" | "y" | "z") => {
      const next = lockedAxis === axis ? null : axis;
      setLockedAxisState(next);
      setLockedAxis(next);
    },
    [lockedAxis, setLockedAxis],
  );

  const handleMaterialChange = useCallback(
    (property: keyof ShipMaterialConfig, value: number) => {
      setMatConfig((prev) => ({ ...prev, [property]: value }));
      setMaterialProperty(property, value);
    },
    [setMaterialProperty],
  );

  if (!enabled) return null;

  // Group hardpoints by type
  const grouped = new Map<HardpointType, Hardpoint[]>();
  for (const hp of hardpoints) {
    const list = grouped.get(hp.type) ?? [];
    list.push(hp);
    grouped.set(hp.type, list);
  }

  // Selected hardpoint data
  const selectedHp = selectedId ? hardpoints.find((h) => h.id === selectedId) : null;

  return (
    <div className="hardpoint-panel">
      <div className="debug-header">
        <span>HARDPOINTS</span>
        <div className="debug-header-buttons">
          <button className="debug-copy" onClick={handleCopy}>
            {copied ? "COPIED!" : "COPY POINTS"}
          </button>
          <button className="debug-close" onClick={handleExit}>
            x
          </button>
        </div>
      </div>

      <div className="debug-scroll">
        {/* ── SHIP MODEL ── */}
        <CollapsibleSection title="SHIP MODEL" defaultOpen>
          <div className="hp-ship-selector">
            <select
              value={currentShipId}
              onChange={(e) => handleShipChange(e.target.value)}
              className="hp-ship-select"
            >
              {getAllShips().map((ship) => (
                <option key={ship.id} value={ship.id}>
                  {ship.name} ({ship.class}){ship.source === "community" ? " *" : ""}
                </option>
              ))}
            </select>
          </div>
        </CollapsibleSection>

        {/* ── SHIP TUNING ── */}
        <CollapsibleSection title={`SHIP TUNING [${currentShipId}]`} defaultOpen>
          <div className="hp-tuning-row">
            <span className="hp-tuning-label">SCALE</span>
            <input
              type="range"
              className="hp-tuning-slider"
              min={0.01}
              max={3}
              step={0.01}
              value={scale}
              onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
            />
            <input
              type="number"
              className="hp-axis-input"
              value={scale.toFixed(2)}
              step={0.01}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v)) handleScaleChange(v);
              }}
            />
          </div>
        </CollapsibleSection>

        {/* ── MATERIAL TUNING ── */}
        <CollapsibleSection title="MATERIAL" defaultOpen={false}>
          {[
            { key: "metalness" as const, label: "METAL", min: 0, max: 1, step: 0.01 },
            { key: "roughness" as const, label: "ROUGH", min: 0, max: 1, step: 0.01 },
            { key: "emissiveIntensity" as const, label: "EMISSIVE", min: 0, max: 2, step: 0.01 },
          ].map(({ key, label, min, max, step }) => (
            <div key={key} className="hp-tuning-row">
              <span className="hp-tuning-label">{label}</span>
              <input
                type="range"
                className="hp-tuning-slider"
                min={min}
                max={max}
                step={step}
                value={matConfig[key]}
                onChange={(e) => handleMaterialChange(key, parseFloat(e.target.value))}
              />
              <input
                type="number"
                className="hp-axis-input"
                value={matConfig[key].toFixed(2)}
                step={step}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) handleMaterialChange(key, v);
                }}
              />
            </div>
          ))}
          <div className="hp-mat-color-section">
            <span className="hp-tuning-label hp-mat-color-label">GLOW COLOR</span>
            <div className="hp-mat-color-row">
              {(["emissiveR", "emissiveG", "emissiveB"] as const).map((ch) => {
                const label = ch === "emissiveR" ? "R" : ch === "emissiveG" ? "G" : "B";
                const color = ch === "emissiveR" ? "#ff4444" : ch === "emissiveG" ? "#44ff44" : "#4488ff";
                return (
                  <div key={ch} className="hp-mat-channel">
                    <span className="hp-mat-channel-label" style={{ color }}>{label}</span>
                    <input
                      type="range"
                      className="hp-mat-channel-slider"
                      min={0}
                      max={255}
                      step={1}
                      value={matConfig[ch]}
                      onChange={(e) => handleMaterialChange(ch, parseInt(e.target.value))}
                    />
                    <input
                      type="number"
                      className="hp-axis-input hp-mat-channel-input"
                      value={matConfig[ch]}
                      min={0}
                      max={255}
                      step={1}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v)) handleMaterialChange(ch, Math.max(0, Math.min(255, v)));
                      }}
                    />
                  </div>
                );
              })}
              <div
                className="hp-mat-color-preview"
                style={{ background: `rgb(${matConfig.emissiveR}, ${matConfig.emissiveG}, ${matConfig.emissiveB})` }}
              />
            </div>
          </div>
        </CollapsibleSection>

        {/* ── PLACEMENT MODE ── */}
        <CollapsibleSection title="PLACEMENT MODE" defaultOpen>
          <div className="debug-button-row hp-type-row">
            {HARDPOINT_TYPES.map(({ type, label, color }) => (
              <button
                key={type}
                className={`debug-view-btn${activeType === type ? " hp-type-active" : ""}`}
                style={
                  activeType === type
                    ? { borderColor: color, color }
                    : undefined
                }
                onClick={() => handleTypeChange(type)}
              >
                <span className="hp-dot" style={{ background: color }} />
                {label}
              </button>
            ))}
          </div>
          <div className="hp-instructions">
            Click on ship to place. Right-click marker to remove. Drag to orbit.
          </div>
        </CollapsibleSection>

        {/* ── POSITION ADJUST (always visible) ── */}
        <CollapsibleSection title={`ADJUST POSITION${lockedAxis ? ` [${lockedAxis.toUpperCase()} LOCKED]` : ""}`} defaultOpen>
          {selectedHp ? (
            <div className="hp-position-controls">
              <div className="hp-instructions">
                Click toggle to lock axis. Drag dot to move. Space to cycle.
              </div>
              {(["x", "y", "z"] as const).map((axis) => {
                const val = axis === "x" ? selectedHp.localX : axis === "y" ? selectedHp.localY : selectedHp.localZ;
                const isLocked = lockedAxis === axis;
                const axisColor = axis === "x" ? "#ff4444" : axis === "y" ? "#44ff44" : "#4488ff";
                return (
                  <div key={axis} className="hp-pos-group">
                    <div className="hp-axis-row">
                      <span className={`hp-axis-label hp-axis-${axis}`}>{axis.toUpperCase()}</span>
                      <input
                        type="range"
                        className="hp-pos-slider"
                        min={-POS_RANGE}
                        max={POS_RANGE}
                        step={0.01}
                        value={val}
                        onChange={(e) => handleAxisChange(selectedHp.id, axis, parseFloat(e.target.value))}
                      />
                      <input
                        type="number"
                        className="hp-axis-input"
                        value={val.toFixed(3)}
                        step={STEP}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v)) handleAxisChange(selectedHp.id, axis, v);
                        }}
                      />
                      <button
                        className={`hp-axis-lock${isLocked ? " hp-axis-lock-active" : ""}`}
                        style={isLocked ? { borderColor: axisColor, color: axisColor, background: `${axisColor}22` } : undefined}
                        onClick={() => handleToggleAxis(axis)}
                        title={`Lock ${axis.toUpperCase()} axis for drag`}
                      >
                        {axis.toUpperCase()}
                      </button>
                    </div>
                  </div>
                );
              })}
              {selectedHp.type === "thruster" && (
                <div className="hp-pos-group">
                  <div className="hp-axis-row">
                    <span className="hp-axis-label" style={{ color: "#ff6600" }}>ANG</span>
                    <input
                      type="range"
                      className="hp-pos-slider"
                      min={-180}
                      max={180}
                      step={1}
                      value={selectedHp.thrustAngleDeg ?? 0}
                      onChange={(e) => handleThrustAngleChange(selectedHp.id, parseFloat(e.target.value))}
                    />
                    <input
                      type="number"
                      className="hp-axis-input"
                      value={(selectedHp.thrustAngleDeg ?? 0).toFixed(0)}
                      step={5}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v)) handleThrustAngleChange(selectedHp.id, v);
                      }}
                    />
                    <span className="hp-tuning-unit">&deg;</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="hp-empty">Place or click a point to adjust</div>
          )}
        </CollapsibleSection>

        {/* ── PLACED HARDPOINTS ── */}
        <CollapsibleSection title={`POINTS (${hardpoints.length})`} defaultOpen>
          {hardpoints.length === 0 && (
            <div className="hp-empty">No hardpoints placed yet</div>
          )}
          {HARDPOINT_TYPES.map(({ type, label, color }) => {
            const items = grouped.get(type);
            if (!items || items.length === 0) return null;
            return (
              <div key={type}>
                <div className="debug-group-sublabel" style={{ color }}>
                  {label} ({items.length})
                </div>
                {items.map((hp) => (
                  <div
                    key={hp.id}
                    className={`hp-item${selectedId === hp.id ? " hp-selected" : ""}`}
                    onClick={() => handleSelect(hp.id)}
                  >
                    <span className="hp-dot" style={{ background: color }} />
                    <span className="hp-coords">
                      ({hp.localX.toFixed(2)}, {hp.localY.toFixed(2)},{" "}
                      {hp.localZ.toFixed(2)})
                    </span>
                    <button
                      className="hp-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(hp.id);
                      }}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </CollapsibleSection>
      </div>

      {/* Version footer — confirms the user is running the latest build */}
      <div className="hp-version">{HP_BUILD}</div>
    </div>
  );
}
