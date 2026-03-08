/**
 * ShipCard — ship grid card with hero image, class badge, stats.
 * Ported from ui-demo/hangar/src/components/ShipCard.tsx.
 */

import { useState } from "react";
import { motion } from "motion/react";
import { Box, Zap, Rocket, Cpu } from "lucide-react";
import { CLASS_COLOR, type HangarShip } from "./hangarTypes";

interface ShipCardProps {
  ship: HangarShip;
  onClick: (ship: HangarShip) => void;
}

const STATUS_COLOR: Record<string, string> = {
  Hangar: "#f0b429",
  Active: "#00e87a",
};

const STATUS_LABEL: Record<string, string> = {
  Hangar: "In Hangar",
  Active: "Active",
};

const mono: React.CSSProperties = { fontFamily: '"Share Tech Mono", monospace' };
const raj: React.CSSProperties = { fontFamily: '"Rajdhani", sans-serif' };

export function ShipCard({ ship, onClick }: ShipCardProps) {
  const [hovered, setHovered] = useState(false);
  const classColor = CLASS_COLOR[ship.class] ?? "rgba(100,120,150,0.9)";
  const statusColor = STATUS_COLOR[ship.status] ?? "#666";
  const hasImage = !!ship.imageUrl;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25 }}
      onClick={() => onClick(ship)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        cursor: "pointer",
        background: "rgba(4, 10, 22, 0.72)",
        border: `1px solid ${hovered ? "rgba(240,180,41,0.3)" : "rgba(255,255,255,0.055)"}`,
        borderTop: `2px solid ${hovered ? "#f0b429" : "transparent"}`,
        boxShadow: hovered
          ? "0 0 24px rgba(240,180,41,0.08), 0 8px 24px rgba(0,0,0,0.5)"
          : "0 2px 12px rgba(0,0,0,0.4)",
        transition: "all 0.2s ease",
        overflow: "hidden",
      }}
    >
      {/* Hero Image area */}
      <div style={{ position: "relative", aspectRatio: "16/9", overflow: "hidden", background: "#020408" }}>
        {hasImage ? (
          <img
            src={ship.imageUrl}
            alt={ship.name}
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: hovered ? 0.9 : 0.65,
              transform: hovered ? "scale(1.03)" : "scale(1)",
              transition: "opacity 0.4s ease, transform 0.6s ease",
            }}
          />
        ) : (
          /* Placeholder for built-in ships without hero images */
          <div
            style={{
              width: "100%",
              height: "100%",
              background: `
                radial-gradient(ellipse at 40% 60%, rgba(0,100,200,0.08) 0%, transparent 60%),
                linear-gradient(180deg, rgba(4,8,15,1) 0%, rgba(8,16,30,1) 100%)
              `,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                ...mono,
                fontSize: "24px",
                fontWeight: 700,
                color: "rgba(0,200,255,0.12)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {ship.name}
            </span>
          </div>
        )}

        {/* Gradient fade */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to top, rgba(4,10,22,0.95) 0%, rgba(4,10,22,0.15) 50%, transparent 100%)",
          }}
        />

        {/* Scanlines scoped to hero */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 5,
            background:
              "repeating-linear-gradient(to bottom, transparent, transparent 3px, rgba(0,0,0,0.18) 3px, rgba(0,0,0,0.18) 4px)",
          }}
        />

        {/* Class Badge */}
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            zIndex: 10,
            ...mono,
            fontSize: "8px",
            fontWeight: 800,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            padding: "3px 8px",
            color: "#fff",
            background: classColor,
            boxShadow: `0 0 10px ${classColor}`,
          }}
        >
          {ship.class}
        </div>

        {/* Name + status at bottom */}
        <div style={{ position: "absolute", bottom: "10px", left: "12px", right: "12px", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                flexShrink: 0,
                background: statusColor,
                boxShadow: `0 0 8px ${statusColor}`,
              }}
            />
            <h3
              style={{
                ...raj,
                fontSize: "21px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.02em",
                color: "#ffffff",
                margin: 0,
                textShadow: "0 2px 8px rgba(0,0,0,0.8)",
              }}
            >
              {ship.name}
            </h3>
          </div>
          <div
            style={{
              ...mono,
              fontSize: "9px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: statusColor,
              opacity: 0.75,
              marginTop: "1px",
              paddingLeft: "13px",
            }}
          >
            {STATUS_LABEL[ship.status]}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          padding: "9px 12px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "5px 8px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {(
          [
            { Icon: Box, val: `${ship.cargoSpace} m3`, color: "rgba(0,200,255,0.5)" },
            { Icon: Cpu, val: `${ship.droneBay} m3`, color: "rgba(0,200,255,0.5)" },
            { Icon: Zap, val: `${ship.hardpoints.turret} Turrets`, color: "rgba(240,90,30,0.7)" },
            { Icon: Rocket, val: `${ship.hardpoints.launcher} Launchers`, color: "rgba(240,150,40,0.7)" },
          ] as const
        ).map(({ Icon, val, color }) => (
          <div key={val} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <Icon size={10} style={{ color, flexShrink: 0 }} />
            <span style={{ ...mono, fontSize: "12px", color: "rgba(255,255,255,0.75)" }}>{val}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
