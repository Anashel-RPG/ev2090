import { useMemo, useState, useEffect } from "react";
import type { RadarContact, Vec2 } from "@/types/game";
import "./OffscreenIndicators.css";

interface Props {
  shipPosition: Vec2;
  shipRotation: number;
  contacts: RadarContact[];
  sidebarWidth?: number;
}

const VIEW_SIZE = 40; // must match CameraController viewSize
const MARGIN = 20; // px from edge
const RADAR_RANGE = 300; // must match Engine/RadarPanel
const SCANNER_HALF_ANGLE = (30 * Math.PI) / 180; // 60° total → 30° half

/** Check if a world-space contact is inside the player's scanner cone */
function isInScannerCone(
  dx: number,
  dy: number,
  heading: number,
): boolean {
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 2 || dist > RADAR_RANGE) return false;
  const contactAngle = Math.atan2(dx, dy);
  let diff = contactAngle - heading;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff) < SCANNER_HALF_ANGLE;
}

export function OffscreenIndicators({ shipPosition, shipRotation, contacts, sidebarWidth = 240 }: Props) {
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => {
      setDims({ w: window.innerWidth - sidebarWidth, h: window.innerHeight });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [sidebarWidth]);

  const indicators = useMemo(() => {
    if (!dims.w || !dims.h) return [];

    const aspect = dims.w / dims.h;
    const halfH = VIEW_SIZE / 2;
    const halfW = halfH * aspect;
    const heading = -shipRotation;

    return contacts
      .map((contact) => {
        const dx = contact.position.x - shipPosition.x;
        const dy = contact.position.y - shipPosition.y;

        // On-screen? Skip — use slightly smaller threshold to catch edge cases
        if (Math.abs(dx) < halfW - 3 && Math.abs(dy) < halfH - 3) return null;

        // For ships: only show if detected by scanner cone
        if (contact.type === "ship") {
          if (!isInScannerCone(dx, dy, heading)) return null;
        }

        // Project direction onto viewport edge
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        const scaleToEdge = Math.min(
          (halfW - 0.5) / Math.max(absX, 0.001),
          (halfH - 0.5) / Math.max(absY, 0.001),
        );
        const edgeX = dx * scaleToEdge;
        const edgeY = dy * scaleToEdge;

        // World → screen pixel coords
        let sx = ((edgeX / halfW) * dims.w) / 2 + dims.w / 2;
        let sy = (-(edgeY / halfH) * dims.h) / 2 + dims.h / 2;

        // Clamp with margin so labels don't clip
        sx = Math.max(MARGIN, Math.min(dims.w - MARGIN - 50, sx));
        sy = Math.max(MARGIN, Math.min(dims.h - MARGIN - 10, sy));

        return {
          id: contact.id,
          name: contact.name,
          type: contact.type,
          x: sx,
          y: sy,
        };
      })
      .filter(Boolean);
  }, [shipPosition, shipRotation, contacts, dims]);

  if (indicators.length === 0) return null;

  return (
    <div
      className="offscreen-indicators"
      style={{ width: dims.w, height: dims.h }}
    >
      {indicators.map(
        (ind) =>
          ind && (
            <div
              key={ind.id}
              className={`offscreen-indicator${ind.type === "ship" ? " ship-indicator" : ""}`}
              style={{ left: ind.x, top: ind.y }}
            >
              <span className="offscreen-dot" />
              <span>{ind.name}</span>
            </div>
          ),
      )}
    </div>
  );
}
