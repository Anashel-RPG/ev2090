import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { Engine } from "@/engine/Engine";
import { registerCommunityShip } from "@/engine/ShipCatalog";
import type { ShipDef } from "@/engine/ShipCatalog";
import type { DebugView } from "@/engine/systems/CameraController";
import type { ShipMaterialConfig } from "@/engine/systems/HardpointEditor";
import type { GameState, LightConfig, ShipColor, Hardpoint, HardpointType, HeroSubject, HeroShotConfig } from "@/types/game";

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
  dock: () => void;
  undock: () => void;
  repairShip: () => void;
  refuelShip: () => void;
  triggerQuestRescue: () => void;
  startQuest: () => void;
  // Hero Shot authoring
  enterHeroMode: (subject: HeroSubject) => void;
  exitHeroMode: () => void;
  exitHeroModeAnimated: (duration?: number) => void;
  isInHeroMode: () => boolean;
  setHeroConfig: (property: string, value: number) => void;
  getHeroConfig: () => HeroShotConfig | null;
  heroPreviewToGameplay: (duration?: number, onComplete?: () => void) => void;
  heroPreviewToComposed: (duration?: number, onComplete?: () => void) => void;
  isHeroAnimating: () => boolean;
  getPlanetNames: () => string[];
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
  // Hardpoint Editor
  enterHardpointEditor: () => void;
  exitHardpointEditor: () => void;
  isInHardpointEditor: () => boolean;
  setHardpointPlacementType: (type: HardpointType) => void;
  getHardpointPlacementType: () => HardpointType;
  getHardpoints: () => Hardpoint[];
  deleteHardpoint: (id: string) => void;
  selectHardpoint: (id: string | null) => void;
  getSelectedHardpointId: () => string | null;
  changeShipForHardpointEditor: (shipId: string) => void;
  updateHardpointPosition: (id: string, axis: "x" | "y" | "z", value: number) => void;
  setHardpointShipScale: (scale: number) => void;
  getHardpointShipScale: () => number;
  setHardpointShipHeading: (radians: number) => void;
  getHardpointShipHeading: () => number;
  setHardpointLockedAxis: (axis: "x" | "y" | "z" | null) => void;
  getHardpointLockedAxis: () => "x" | "y" | "z" | null;
  updateHardpointThrustAngle: (id: string, angleDeg: number) => void;
  setHardpointMaterialProperty: (property: keyof ShipMaterialConfig, value: number) => void;
  getHardpointMaterialConfig: () => ShipMaterialConfig;
  // Ship Forge
  registerCommunityShip: (def: ShipDef) => void;
  // FPV Camera
  toggleFpv: () => void;
  isFpvActive: () => boolean;
  // FPV Post-Processing Config
  getFpvPostConfig: () => Record<string, number>;
  setFpvPostParam: (key: string, value: number) => void;
  // Bridge Config
  getBridgeCameraConfig: () => Record<string, number>;
  setBridgeCameraParam: (key: string, value: number) => void;
  // Comm Mode
  exitCommMode: () => void;
  // Dock shortcut callback
  setDockRequestCallback: (cb: () => void) => void;
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
      dock: () => {
        engineRef.current?.dock();
      },
      undock: () => {
        engineRef.current?.undock();
      },
      repairShip: () => {
        engineRef.current?.repairShip();
      },
      refuelShip: () => {
        engineRef.current?.refuelShip();
      },
      triggerQuestRescue: () => {
        engineRef.current?.triggerQuestRescue();
      },
      startQuest: () => {
        engineRef.current?.startQuest();
      },
      // Hero Shot
      enterHeroMode: (subject: HeroSubject) => {
        engineRef.current?.enterHeroMode(subject);
      },
      exitHeroMode: () => {
        engineRef.current?.exitHeroMode();
      },
      exitHeroModeAnimated: (duration?: number) => {
        engineRef.current?.exitHeroModeAnimated(duration);
      },
      isInHeroMode: () => {
        return engineRef.current?.isInHeroMode() ?? false;
      },
      setHeroConfig: (property: string, value: number) => {
        engineRef.current?.setHeroConfig(property, value);
      },
      getHeroConfig: () => {
        return engineRef.current?.getHeroConfig() ?? null;
      },
      heroPreviewToGameplay: (duration?: number, onComplete?: () => void) => {
        engineRef.current?.heroPreviewToGameplay(duration, onComplete);
      },
      heroPreviewToComposed: (duration?: number, onComplete?: () => void) => {
        engineRef.current?.heroPreviewToComposed(duration, onComplete);
      },
      isHeroAnimating: () => {
        return engineRef.current?.isHeroAnimating() ?? false;
      },
      getPlanetNames: () => {
        return engineRef.current?.getPlanetNames() ?? [];
      },
      setShipRotation: (radians: number) => {
        engineRef.current?.setShipRotationForHero(radians);
      },
      getShipRotation: () => {
        return engineRef.current?.getShipRotation() ?? 0;
      },
      setShipTilt: (radians: number) => {
        engineRef.current?.setShipTiltForHero(radians);
      },
      getShipTilt: () => {
        return engineRef.current?.getShipTilt() ?? (-22 * Math.PI) / 180;
      },
      setShipRoll: (radians: number) => {
        engineRef.current?.setShipRollForHero(radians);
      },
      getShipRoll: () => {
        return engineRef.current?.getShipRoll() ?? 0;
      },
      setShipScale: (scale: number) => {
        engineRef.current?.setShipScaleForHero(scale);
      },
      getShipScale: () => {
        return engineRef.current?.getShipScale() ?? 1;
      },
      setHeroShipRotateMode: (on: boolean) => {
        engineRef.current?.setHeroShipRotateMode(on);
      },
      isHeroShipRotateMode: () => {
        return engineRef.current?.isHeroShipRotateMode() ?? false;
      },
      // Hardpoint Editor
      enterHardpointEditor: () => {
        engineRef.current?.enterHardpointEditor();
      },
      exitHardpointEditor: () => {
        engineRef.current?.exitHardpointEditor();
      },
      isInHardpointEditor: () => {
        return engineRef.current?.isInHardpointEditor() ?? false;
      },
      setHardpointPlacementType: (type: HardpointType) => {
        engineRef.current?.setHardpointPlacementType(type);
      },
      getHardpointPlacementType: () => {
        return engineRef.current?.getHardpointPlacementType() ?? "thruster";
      },
      getHardpoints: () => {
        return engineRef.current?.getHardpoints() ?? [];
      },
      deleteHardpoint: (id: string) => {
        engineRef.current?.deleteHardpoint(id);
      },
      selectHardpoint: (id: string | null) => {
        engineRef.current?.selectHardpoint(id);
      },
      getSelectedHardpointId: () => {
        return engineRef.current?.getSelectedHardpointId() ?? null;
      },
      changeShipForHardpointEditor: (shipId: string) => {
        engineRef.current?.changeShipForHardpointEditor(shipId);
      },
      updateHardpointPosition: (id: string, axis: "x" | "y" | "z", value: number) => {
        engineRef.current?.updateHardpointPosition(id, axis, value);
      },
      setHardpointShipScale: (scale: number) => {
        engineRef.current?.setHardpointShipScale(scale);
      },
      getHardpointShipScale: () => {
        return engineRef.current?.getHardpointShipScale() ?? 0.4;
      },
      setHardpointShipHeading: (radians: number) => {
        engineRef.current?.setHardpointShipHeading(radians);
      },
      getHardpointShipHeading: () => {
        return engineRef.current?.getHardpointShipHeading() ?? 0;
      },
      setHardpointLockedAxis: (axis: "x" | "y" | "z" | null) => {
        engineRef.current?.setHardpointLockedAxis(axis);
      },
      getHardpointLockedAxis: () => {
        return engineRef.current?.getHardpointLockedAxis() ?? null;
      },
      updateHardpointThrustAngle: (id: string, angleDeg: number) => {
        engineRef.current?.updateHardpointThrustAngle(id, angleDeg);
      },
      setHardpointMaterialProperty: (property: keyof ShipMaterialConfig, value: number) => {
        engineRef.current?.setHardpointMaterialProperty(property, value);
      },
      getHardpointMaterialConfig: () => {
        return engineRef.current?.getHardpointMaterialConfig() ?? {
          metalness: 0.4, roughness: 0.2, emissiveIntensity: 0.15,
          emissiveR: 34, emissiveG: 34, emissiveB: 51,
        };
      },
      // Ship Forge
      registerCommunityShip: (def: ShipDef) => {
        registerCommunityShip(def);
      },
      toggleFpv: () => {
        engineRef.current?.toggleFpv();
      },
      isFpvActive: () => {
        return engineRef.current?.isFpvActive() ?? false;
      },
      getFpvPostConfig: () => {
        return engineRef.current?.getFpvPostConfig() ?? {};
      },
      setFpvPostParam: (key: string, value: number) => {
        engineRef.current?.setFpvPostParam(key, value);
      },
      getBridgeCameraConfig: () => {
        return engineRef.current?.getBridgeCameraConfig() ?? {};
      },
      setBridgeCameraParam: (key: string, value: number) => {
        engineRef.current?.setBridgeCameraParam(key, value);
      },
      exitCommMode: () => {
        engineRef.current?.exitCommMode();
      },
      setDockRequestCallback: (cb: () => void) => {
        engineRef.current?.setDockRequestCallback(cb);
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
