import { useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getShipDef } from "@/engine/ShipCatalog";
import { SHIP_COLORS } from "@/types/game";
import type { ShipColor } from "@/types/game";
import "./diagnostic.css";

interface Props {
  shipId: string;
  currentColor: ShipColor;
  onColorChange: (color: ShipColor) => void;
}

/** Stat bar for diagnostic display */
function DiagStat({ label, value }: { label: string; value: number }) {
  const filled = Math.round(value);
  const empty = 10 - filled;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);

  return (
    <div className="diag-stat">
      <span className="diag-stat-label">{label}</span>
      <span className="diag-stat-bar">{bar}</span>
      <span className="diag-stat-val">{value * 10}</span>
    </div>
  );
}

const COLOR_HEX: Record<ShipColor, string> = {
  Blue: "#4488ff",
  Green: "#44cc44",
  Orange: "#ff8844",
  Purple: "#aa44ff",
  Red: "#ff4444",
  Fire: "#ff6611",
};

export function ShipDiagnosticPanel({
  shipId,
  currentColor,
  onColorChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shipDef = getShipDef(shipId);

  // Build available colors: standard 5 + any custom textures for this ship
  const availableColors = useMemo(() => {
    const colors: ShipColor[] = [...SHIP_COLORS];
    if (shipDef?.extraTextures) {
      for (const colorName of Object.keys(shipDef.extraTextures)) {
        if (!colors.includes(colorName as ShipColor)) {
          colors.push(colorName as ShipColor);
        }
      }
    }
    return colors;
  }, [shipDef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shipDef) return;

    const width = 210;
    const height = 150;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    camera.position.set(5, 3, 5);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x00ff88, 0.15));

    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });

    const solidMat = new THREE.MeshBasicMaterial({
      color: 0x003322,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });

    const loader = new GLTFLoader();
    let model: THREE.Group | null = null;

    loader.load(shipDef.modelPath, (gltf) => {
      model = gltf.scene;

      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = wireframeMat;
          const solidClone = new THREE.Mesh(child.geometry, solidMat);
          solidClone.position.copy(child.position);
          solidClone.rotation.copy(child.rotation);
          solidClone.scale.copy(child.scale);
          child.parent?.add(solidClone);
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetScale = 3.0 / maxDim;
      model.scale.setScalar(targetScale);

      const center = box
        .getCenter(new THREE.Vector3())
        .multiplyScalar(targetScale);
      model.position.sub(center);

      scene.add(model);
    });

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (model) {
        model.rotation.y += 0.008;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      renderer.dispose();
    };
  }, [shipId, shipDef]);

  if (!shipDef) return null;

  return (
    <div className="panel">
      <div className="panel-header">SHIP DIAGNOSTIC</div>
      <div className="diagnostic-container">
        <canvas
          ref={canvasRef}
          width={210}
          height={150}
          className="diagnostic-canvas"
        />
        <div className="diagnostic-scanlines" />
      </div>

      {/* Color selector */}
      <div className="color-selector">
        {availableColors.map((color) => (
          <button
            key={color}
            className={`color-swatch ${currentColor === color ? "active" : ""}`}
            style={
              {
                "--swatch-color": COLOR_HEX[color],
              } as React.CSSProperties
            }
            onClick={() => onColorChange(color)}
            title={color}
          />
        ))}
      </div>

      <div className="diagnostic-info">
        <div className="diag-class">
          <span className="diag-class-label">CLASS</span>
          <span className="diag-class-value">{shipDef.class}</span>
        </div>
        <div className="diag-stats">
          <DiagStat label="SPD" value={shipDef.stats.speed} />
          <DiagStat label="ARM" value={shipDef.stats.armor} />
          <DiagStat label="CRG" value={shipDef.stats.cargo} />
          <DiagStat label="FPR" value={shipDef.stats.firepower} />
        </div>
      </div>
    </div>
  );
}
