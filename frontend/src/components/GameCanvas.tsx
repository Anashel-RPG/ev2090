import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { Engine } from "@/engine/Engine";
import type { DebugView } from "@/engine/systems/CameraController";
import type { GameState, LightConfig, ShipColor } from "@/types/game";

interface Props {
  onStateUpdate: (state: GameState) => void;
}

export interface GameCanvasHandle {
  changeShip: (shipId: string) => void;
  changeShipColor: (color: ShipColor) => void;
  getLightConfig: () => LightConfig | null;
  updateLight: (lightName: string, property: string, value: number) => void;
  updateShipMaterial: (property: string, value: number) => void;
  jumpBack: () => void;
  onReady: (cb: () => void) => void;
  spawnTestShip: () => void;
  spawnTestRing: () => void;
  clearTestShips: () => void;
  setDebugView: (view: DebugView) => void;
  getDebugView: () => DebugView;
  setBeamVisible: (visible: boolean) => void;
  isBeamVisible: () => boolean;
  setSidebarWidthPx: (px: number) => void;
  setZoom: (factor: number) => void;
  getZoom: () => number;
  setCameraOffset: (x: number, y: number) => void;
  getCameraOffset: () => { x: number; y: number };
}

export const GameCanvas = forwardRef<GameCanvasHandle, Props>(
  ({ onStateUpdate }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<Engine | null>(null);
    const readyCb = useRef<(() => void) | null>(null);

    useImperativeHandle(ref, () => ({
      changeShip: (shipId: string) => {
        engineRef.current?.changeShip(shipId);
      },
      changeShipColor: (color: ShipColor) => {
        engineRef.current?.changeShipColor(color);
      },
      getLightConfig: () => {
        return engineRef.current?.getLightConfig() ?? null;
      },
      updateLight: (lightName: string, property: string, value: number) => {
        engineRef.current?.updateLight(lightName, property, value);
      },
      updateShipMaterial: (property: string, value: number) => {
        engineRef.current?.updateShipMaterial(property, value);
      },
      jumpBack: () => {
        engineRef.current?.jumpToNearestPlanet();
      },
      onReady: (cb: () => void) => {
        readyCb.current = cb;
      },
      spawnTestShip: () => {
        engineRef.current?.spawnTestShip();
      },
      spawnTestRing: () => {
        engineRef.current?.spawnTestRing();
      },
      clearTestShips: () => {
        engineRef.current?.clearTestShips();
      },
      setDebugView: (view: DebugView) => {
        engineRef.current?.setDebugView(view);
      },
      getDebugView: () => {
        return engineRef.current?.getDebugView() ?? "normal";
      },
      setBeamVisible: (visible: boolean) => {
        engineRef.current?.setBeamVisible(visible);
      },
      isBeamVisible: () => {
        return engineRef.current?.isBeamVisible() ?? false;
      },
      setSidebarWidthPx: (px: number) => {
        engineRef.current?.setSidebarWidthPx(px);
      },
      setZoom: (factor: number) => {
        engineRef.current?.setZoom(factor);
      },
      getZoom: () => {
        return engineRef.current?.getZoom() ?? 1;
      },
      setCameraOffset: (x: number, y: number) => {
        engineRef.current?.setCameraOffset(x, y);
      },
      getCameraOffset: () => {
        return engineRef.current?.getCameraOffset() ?? { x: 0, y: 0 };
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const engine = new Engine(canvas, container);
      engine.subscribe(onStateUpdate);
      engineRef.current = engine;

      // Signal ready after first frames render + assets start loading
      const readyTimer = setTimeout(() => {
        readyCb.current?.();
      }, 800);

      return () => {
        clearTimeout(readyTimer);
        engine.dispose();
        engineRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <div ref={containerRef} className="game-canvas-container">
        <canvas ref={canvasRef} />
        <div className="game-hud">
          <div className="hud-controls">
            <span>W/&#x2191; Thrust</span>
            <span>A/&#x2190; D/&#x2192; Rotate</span>
            <span>S/&#x2193; Brake</span>
          </div>
        </div>
      </div>
    );
  },
);

GameCanvas.displayName = "GameCanvas";
