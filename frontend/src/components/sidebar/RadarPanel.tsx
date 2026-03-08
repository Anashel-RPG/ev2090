import { useMemo } from "react";
import type { RadarContact, Vec2 } from "@/types/game";
import "./radar.css";

interface Props {
  shipPosition: Vec2;
  shipHeading: number;
  contacts: RadarContact[];
  size?: number;
  compact?: boolean;
}

const RADAR_SIZE = 160;
const RADAR_RANGE = 300; // world units visible on radar
const SCANNER_ANGLE = 60; // degrees — total arc width of the scanner cone
const SCANNER_REACH = 0.75; // fraction of radar radius the cone extends

/** Check if a contact is inside the scanner cone */
function isInCone(
  cx: number,
  cy: number,
  center: number,
  heading: number,
  halfAngle: number,
): boolean {
  const dx = cx - center;
  const dy = -(cy - center); // flip Y back to math coords
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 2) return false; // skip center (ship itself)
  const contactAngle = Math.atan2(dx, dy); // same convention as heading
  let diff = contactAngle - heading;
  // Normalize to [-PI, PI]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff) < halfAngle;
}

export function RadarPanel({ shipPosition, shipHeading: physicsHeading, contacts, size, compact }: Props) {
  const radarSize = size ?? RADAR_SIZE;
  const center = radarSize / 2;
  const coneRadius = (center - 4) * SCANNER_REACH;

  // Build the scanner cone SVG path (a pie-slice / wedge)
  const halfAngle = (SCANNER_ANGLE / 2) * (Math.PI / 180);
  // Physics heading: 0 = up. In SVG, up = -Y → negate for display.
  const heading = -physicsHeading;

  const leftAngle = heading - halfAngle;
  const rightAngle = heading + halfAngle;

  // Arc endpoints (SVG coords: Y is inverted)
  const lx = center + Math.sin(leftAngle) * coneRadius;
  const ly = center - Math.cos(leftAngle) * coneRadius;
  const rx = center + Math.sin(rightAngle) * coneRadius;
  const ry = center - Math.cos(rightAngle) * coneRadius;

  // SVG arc: large-arc-flag = 0 (cone < 180°), sweep = 1 (clockwise)
  const conePath = [
    `M ${center} ${center}`,
    `L ${lx} ${ly}`,
    `A ${coneRadius} ${coneRadius} 0 0 1 ${rx} ${ry}`,
    "Z",
  ].join(" ");

  // Compute which contacts are in the cone
  const contactData = useMemo(() => {
    const scale = (center - 8) / RADAR_RANGE;
    return contacts
      .map((contact) => {
        const dx = contact.position.x - shipPosition.x;
        const dy = contact.position.y - shipPosition.y;
        const sx = center + dx * scale;
        const sy = center - dy * scale;
        const dist = Math.sqrt((sx - center) ** 2 + (sy - center) ** 2);
        if (dist > center - 4) return null;

        const inCone = isInCone(sx, sy, center, heading, halfAngle);

        const color = contact.hostile
          ? "#ff4444"
          : contact.type === "planet"
            ? "#4488ff"
            : "#00ff88";

        return { ...contact, sx, sy, inCone, color };
      })
      .filter(Boolean);
  }, [contacts, shipPosition, center, heading, halfAngle]);

  const svgContent = (
        <svg
          width={radarSize}
          height={radarSize}
          viewBox={`0 0 ${radarSize} ${radarSize}`}
        >
          {/* Background */}
          <circle
            cx={center}
            cy={center}
            r={center - 2}
            fill="#0a0f14"
            stroke="#1a3a2a"
            strokeWidth="1"
          />

          {/* Range rings */}
          {[0.33, 0.66, 1].map((r) => (
            <circle
              key={r}
              cx={center}
              cy={center}
              r={(center - 4) * r}
              fill="none"
              stroke="#0d2a1a"
              strokeWidth="0.5"
            />
          ))}

          {/* Crosshairs */}
          <line
            x1={center}
            y1={4}
            x2={center}
            y2={radarSize - 4}
            stroke="#0d2a1a"
            strokeWidth="0.5"
          />
          <line
            x1={4}
            y1={center}
            x2={radarSize - 4}
            y2={center}
            stroke="#0d2a1a"
            strokeWidth="0.5"
          />

          {/* Scanner cone — translucent wedge showing scanner FOV */}
          <defs>
            <radialGradient id="cone-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00ff88" stopOpacity="0.15" />
              <stop offset="60%" stopColor="#00ff88" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#00ff88" stopOpacity="0" />
            </radialGradient>
          </defs>
          <path d={conePath} fill="url(#cone-grad)" stroke="none" />

          {/* Contacts: planets first, then ships on top */}
          {contactData
            .filter((c) => c && c.type === "planet")
            .map((c) => {
              if (!c) return null;
              return (
                <circle
                  key={c.id}
                  cx={c.sx}
                  cy={c.sy}
                  r={2.5}
                  fill={c.color}
                  opacity={c.inCone ? 1 : 0.5}
                />
              );
            })}
          {contactData
            .filter((c) => c && c.type === "ship")
            .map((c) => {
              if (!c) return null;
              return (
                <g key={c.id}>
                  {/* Ping pulse when in scanner cone */}
                  {c.inCone && (
                    <circle
                      cx={c.sx}
                      cy={c.sy}
                      r={2.5}
                      fill="none"
                      stroke={c.color}
                      strokeWidth="1"
                      opacity="0.6"
                      className="radar-ping"
                    />
                  )}
                  <circle
                    cx={c.sx}
                    cy={c.sy}
                    r={2}
                    fill={c.color}
                    opacity={c.inCone ? 1 : 0.7}
                  />
                </g>
              );
            })}

          {/* Player ship (center dot) */}
          <circle cx={center} cy={center} r={2} fill="#00ff88" />
        </svg>
  );

  if (compact) {
    return (
      <div className="radar-container">
        {svgContent}
      </div>
    );
  }

  return (
    <div className="panel radar-panel">
      <div className="panel-header">RADAR</div>
      <div className="radar-container">
        {svgContent}
      </div>
    </div>
  );
}
