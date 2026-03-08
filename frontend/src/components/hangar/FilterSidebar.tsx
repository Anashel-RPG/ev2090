/**
 * FilterSidebar — ship class multi-select + range slider filters.
 * Ported from ui-demo/hangar, Tailwind removed, uses game class names.
 */

import { CLASS_COLOR, getUniqueClasses, type HangarShip } from "./hangarTypes";
import "./FilterSidebar.css";

interface FilterState {
  class: string[];
  minCargo: number;
  minTurrets: number;
  minLaunchers: number;
  minDroneBay: number;
}

interface FilterSidebarProps {
  filters: FilterState;
  onFilterChange: (key: string, value: unknown) => void;
  ships: HangarShip[];
}

const label: React.CSSProperties = {
  fontFamily: '"Share Tech Mono", monospace',
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.18em",
  color: "rgba(0,200,255,0.5)",
};

export type { FilterState };

export function FilterSidebar({ filters, onFilterChange, ships }: FilterSidebarProps) {
  const classes = getUniqueClasses(ships);

  const toggleClass = (c: string) => {
    const next = filters.class.includes(c)
      ? filters.class.filter((x) => x !== c)
      : [...filters.class, c];
    onFilterChange("class", next);
  };

  return (
    <aside className="hangar-filter-sidebar">
      {/* Header */}
      <div className="hangar-filter-header">
        <div style={{ ...label, letterSpacing: "0.24em" }}>Ship Management</div>
      </div>

      <div className="hangar-filter-body">
        {/* Ship Class */}
        <div>
          <div style={{ ...label, marginBottom: "10px" }}>Ship Class</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {classes.map((c) => {
              const active = filters.class.includes(c);
              const color = CLASS_COLOR[c] ?? "rgba(100,120,150,0.85)";
              const bg = color.replace(/[\d.]+\)$/, "0.07)");
              return (
                <button
                  key={c}
                  onClick={() => toggleClass(c)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    padding: "6px 8px",
                    background: active ? bg : "transparent",
                    border: `1px solid ${active ? color : "rgba(255,255,255,0.05)"}`,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      width: "7px",
                      height: "7px",
                      flexShrink: 0,
                      background: active ? color : "rgba(255,255,255,0.12)",
                      boxShadow: active ? `0 0 8px ${color}` : "none",
                      transition: "all 0.15s",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: '"Share Tech Mono", monospace',
                      fontSize: "12px",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: active ? "#fff" : "rgba(255,255,255,0.7)",
                      transition: "color 0.15s",
                    }}
                  >
                    {c}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Range Filters */}
        <RangeFilter
          label="Min Cargo"
          value={filters.minCargo}
          max={30000}
          step={100}
          onChange={(v) => onFilterChange("minCargo", v)}
          unit="m3"
        />
        <RangeFilter
          label="Min Turrets"
          value={filters.minTurrets}
          max={8}
          onChange={(v) => onFilterChange("minTurrets", v)}
        />
        <RangeFilter
          label="Min Launchers"
          value={filters.minLaunchers}
          max={8}
          onChange={(v) => onFilterChange("minLaunchers", v)}
        />
        <RangeFilter
          label="Min Drone Bay"
          value={filters.minDroneBay}
          max={200}
          step={10}
          onChange={(v) => onFilterChange("minDroneBay", v)}
          unit="m3"
        />
      </div>
    </aside>
  );
}

function RangeFilter({
  label: lbl,
  value,
  max,
  step = 1,
  onChange,
  unit = "",
}: {
  label: string;
  value: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  const pct = (value / max) * 100;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px" }}>
        <span
          style={{
            fontFamily: '"Share Tech Mono", monospace',
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            color: "rgba(255,255,255,0.7)",
          }}
        >
          {lbl}
        </span>
        <span
          style={{
            fontFamily: '"Share Tech Mono", monospace',
            fontSize: "12px",
            color: value > 0 ? "#f0b429" : "rgba(255,255,255,0.25)",
            transition: "color 0.2s",
          }}
        >
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        className="hangar-range"
        min="0"
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right,
            rgba(0,200,255,0.55) 0%,
            rgba(0,200,255,0.55) ${pct}%,
            rgba(255,255,255,0.07) ${pct}%,
            rgba(255,255,255,0.07) 100%)`,
        }}
      />
    </div>
  );
}
