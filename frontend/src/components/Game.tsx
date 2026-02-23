import { useState, useCallback, useRef, useEffect } from "react";
import { GameCanvas } from "./GameCanvas";
import type { GameCanvasHandle } from "./GameCanvas";
import { Sidebar } from "./sidebar/Sidebar";
import { RadarPanel } from "./sidebar/RadarPanel";
import { ShipDiagnosticPanel } from "./sidebar/ShipDiagnosticPanel";
import { LightDebugPanel } from "./LightDebugPanel";
import { ChatPanel } from "./ChatPanel";
import { NicknameEditor } from "./NicknameEditor";
import { OffscreenIndicators } from "./OffscreenIndicators";
import { TouchControls } from "./TouchControls";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { INITIAL_GAME_STATE } from "@/types/game";
import type { GameState, ShipColor } from "@/types/game";
import type { DebugView } from "@/engine/systems/CameraController";

const DEFAULT_CHAT_API_URL = import.meta.env.DEV
  ? "/api/chat"
  : "https://ws.ev2090.com/api/chat";

const CHAT_API_URL =
  (import.meta.env.VITE_CHAT_API_URL?.trim() || DEFAULT_CHAT_API_URL);

const NICK_ADJECTIVES = [
  "cosmic", "stellar", "lunar", "solar", "turbo", "hyper", "mega",
  "quantum", "nebula", "void", "plasma", "photon", "rocket", "comet",
  "astro", "warp", "fusion", "nova", "zero-g", "ion",
];
const NICK_NOUNS = [
  "cadet", "pilot", "ranger", "scout", "drifter", "rider", "hawk",
  "fox", "wolf", "ace", "ghost", "spark", "bolt", "blade", "wing",
  "cruiser", "nomad", "jockey", "hopper", "glider",
];

function generateNickname(): string {
  const adj = NICK_ADJECTIVES[Math.floor(Math.random() * NICK_ADJECTIVES.length)];
  const noun = NICK_NOUNS[Math.floor(Math.random() * NICK_NOUNS.length)];
  const num = Math.floor(Math.random() * 99) + 1;
  return `${adj}-${noun}-${num}`;
}

function getStoredNickname(): string {
  try {
    const stored = localStorage.getItem("ev-nickname");
    if (stored) return stored;
    const generated = generateNickname();
    localStorage.setItem("ev-nickname", generated);
    return generated;
  } catch {
    return generateNickname();
  }
}

type LoadPhase = "loading" | "bar-fading" | "canvas-fading" | "done";

export function Game() {
  const bp = useBreakpoint();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = bp === "mobile";
  const sidebarIsDrawer = isMobile;
  const effectiveSidebarWidth = bp === "desktop" ? 240 : bp === "ipad" ? 200 : 0;

  const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
  const [lightDebugOpen, setLightDebugOpen] = useState(() => {
    try {
      return localStorage.getItem("ev-config-open") === "1";
    } catch {
      return false;
    }
  });
  const [nickname, setNickname] = useState(getStoredNickname);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [loadProgress, setLoadProgress] = useState(0);
  const engineReady = useRef(false);
  const canvasRef = useRef<GameCanvasHandle>(null);

  // Persist config panel state
  useEffect(() => {
    try {
      localStorage.setItem("ev-config-open", lightDebugOpen ? "1" : "0");
    } catch { /* storage blocked */ }
  }, [lightDebugOpen]);

  // Keep camera centered in playable area when sidebar width changes
  useEffect(() => {
    canvasRef.current?.setSidebarWidthPx(effectiveSidebarWidth);
  }, [effectiveSidebarWidth]);

  // Expose config() and testship() in browser console
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.config = () => {
      setLightDebugOpen((prev) => !prev);
    };
    w.testship = () => {
      canvasRef.current?.spawnTestShip();
    };
    return () => {
      delete w.config;
      delete w.testship;
    };
  }, []);

  // Register ready callback once canvas is available
  useEffect(() => {
    canvasRef.current?.onReady(() => {
      engineReady.current = true;
    });
  }, []);

  // JS-driven progress bar simulation
  useEffect(() => {
    if (loadPhase !== "loading") return;

    let raf: number;
    let start = performance.now();

    const tick = () => {
      const elapsed = performance.now() - start;
      const ready = engineReady.current;

      // Simulate progress: fast to 60%, slow to 90%, then waits for engine
      let simulated: number;
      if (elapsed < 300) {
        simulated = (elapsed / 300) * 60; // 0→60% in 300ms
      } else if (elapsed < 700) {
        simulated = 60 + ((elapsed - 300) / 400) * 25; // 60→85% in 400ms
      } else {
        simulated = Math.min(92, 85 + (elapsed - 700) * 0.005); // crawl toward 92%
      }

      if (ready && simulated >= 60) {
        // Engine ready — jump to 100% and start fade sequence
        setLoadProgress(100);
        // Fade out bar/text first, then fade canvas
        setTimeout(() => setLoadPhase("bar-fading"), 100);
        setTimeout(() => setLoadPhase("canvas-fading"), 700);
        setTimeout(() => setLoadPhase("done"), 2000);
        return; // stop the animation loop
      }

      setLoadProgress(Math.round(simulated));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loadPhase]);

  // Persist nickname to localStorage
  const handleNicknameChange = useCallback((name: string) => {
    setNickname(name);
    try {
      localStorage.setItem("ev-nickname", name);
    } catch {
      /* storage full or blocked */
    }
  }, []);

  const handleStateUpdate = useCallback((state: GameState) => {
    setGameState(state);
  }, []);

  const handleShipChange = useCallback((shipId: string) => {
    canvasRef.current?.changeShip(shipId);
  }, []);

  const handleColorChange = useCallback((color: ShipColor) => {
    canvasRef.current?.changeShipColor(color);
  }, []);

  const handleJumpBack = useCallback(() => {
    canvasRef.current?.jumpBack();
    // Remove focus so keyboard doesn't trigger focus border
    (document.activeElement as HTMLElement)?.blur();
  }, []);

  const getLightConfig = useCallback(() => {
    return canvasRef.current?.getLightConfig() ?? null;
  }, []);

  const handleUpdateLight = useCallback(
    (lightName: string, property: string, value: number) => {
      canvasRef.current?.updateLight(lightName, property, value);
    },
    [],
  );

  const handleUpdateMaterial = useCallback(
    (property: string, value: number) => {
      canvasRef.current?.updateShipMaterial(property, value);
    },
    [],
  );

  const handleSpawnTestShip = useCallback(() => {
    canvasRef.current?.spawnTestShip();
  }, []);

  const handleSpawnTestRing = useCallback(() => {
    canvasRef.current?.spawnTestRing();
  }, []);

  const handleClearTestShips = useCallback(() => {
    canvasRef.current?.clearTestShips();
  }, []);

  const handleSetDebugView = useCallback((view: DebugView) => {
    canvasRef.current?.setDebugView(view);
  }, []);

  const handleGetDebugView = useCallback((): DebugView => {
    return canvasRef.current?.getDebugView() ?? "normal";
  }, []);

  const handleSetBeamVisible = useCallback((visible: boolean) => {
    canvasRef.current?.setBeamVisible(visible);
  }, []);

  const handleIsBeamVisible = useCallback((): boolean => {
    return canvasRef.current?.isBeamVisible() ?? false;
  }, []);

  const isLoading = loadPhase === "loading";
  const canvasReady = loadPhase === "canvas-fading" || loadPhase === "done";

  return (
    <div className={`game-container ${canvasReady ? "game-ready" : ""}`}>
      {/* Loading overlay — positioned behind sidebar (z-index 5 < sidebar 10) */}
      {loadPhase !== "done" && (
        <div className={`game-loading-overlay ${loadPhase !== "loading" ? "game-loading-done" : ""}`}>
          <div className={`loading-content ${loadPhase === "bar-fading" || loadPhase === "canvas-fading" ? "loading-content-fading" : ""}`}>
            <div className="loading-text">INITIALIZING</div>
            <div className="loading-bar-track">
              <div className="loading-bar-fill" style={{ width: `${loadProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      <GameCanvas ref={canvasRef} onStateUpdate={handleStateUpdate} />

      {/* Debug panel — hidden on tablet/mobile */}
      {!sidebarIsDrawer && (
        <LightDebugPanel
          getLightConfig={getLightConfig}
          updateLight={handleUpdateLight}
          updateShipMaterial={handleUpdateMaterial}
          enabled={lightDebugOpen}
          onClose={() => setLightDebugOpen(false)}
          onSpawnTestShip={handleSpawnTestShip}
          onSpawnTestRing={handleSpawnTestRing}
          onClearTestShips={handleClearTestShips}
          onSetDebugView={handleSetDebugView}
          getDebugView={handleGetDebugView}
          onSetBeamVisible={handleSetBeamVisible}
          isBeamVisible={handleIsBeamVisible}
          fps={gameState.fps}
          onSetZoom={(factor) => canvasRef.current?.setZoom(factor)}
          getZoom={() => canvasRef.current?.getZoom() ?? 1}
          onSetCameraOffset={(x, y) => canvasRef.current?.setCameraOffset(x, y)}
          getCameraOffset={() => canvasRef.current?.getCameraOffset() ?? { x: 0, y: 0 }}
        />
      )}

      {/* Sidebar — desktop/ipad always visible, hidden on mobile */}
      {!isMobile && (
        <div className={`sidebar-boot-wrapper ${isLoading ? "" : "sidebar-booting"}`}>
          <Sidebar
            gameState={gameState}
            onShipChange={handleShipChange}
            onColorChange={handleColorChange}
          />
        </div>
      )}

      {/* Mobile full-screen modal — ship wireframe + stats only */}
      {isMobile && sidebarOpen && (
        <div className="mobile-ship-modal">
          <div className="mobile-modal-header">
            <span className="logo-text">EV &bull; 2090</span>
            <button
              className="mobile-modal-close"
              onClick={() => setSidebarOpen(false)}
            >
              {"\u2715"}
            </button>
          </div>
          <ShipDiagnosticPanel
            shipId={gameState.currentShipId}
            currentColor={gameState.currentShipColor}
            onColorChange={handleColorChange}
          />
        </div>
      )}

      {/* Sidebar toggle button — tablet/mobile only (hidden when mobile modal is open) */}
      {sidebarIsDrawer && !(isMobile && sidebarOpen) && (
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen((prev) => !prev)}
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {sidebarOpen ? "\u2715" : "\u2630"}
        </button>
      )}

      {/* Mini radar HUD — tablet/mobile only, when sidebar is closed */}
      {sidebarIsDrawer && !sidebarOpen && (
        <div className="hud-mini-radar">
          <RadarPanel
            shipPosition={gameState.ship.position}
            shipRotation={gameState.ship.rotation}
            contacts={gameState.radarContacts}
            size={90}
            compact
          />
        </div>
      )}

      {/* Off-screen planet & ship direction indicators */}
      <OffscreenIndicators
        shipPosition={gameState.ship.position}
        shipRotation={gameState.ship.rotation}
        contacts={gameState.radarContacts}
        sidebarWidth={effectiveSidebarWidth}
      />

      {/* HUD Overlays — desktop/ipad only (hidden in drawer modes) */}
      {!sidebarIsDrawer && (
        <NicknameEditor
          nickname={nickname}
          onNicknameChange={handleNicknameChange}
        />
      )}
      {!sidebarIsDrawer && (
        <ChatPanel apiUrl={CHAT_API_URL} nickname={nickname} />
      )}

      {/* Touch controls — tablet/mobile only */}
      {sidebarIsDrawer && <TouchControls />}

      {!sidebarIsDrawer && (gameState.navigation.nearestDistance ?? 0) > 25 && (
        <button className="hud-jump-btn" onClick={handleJumpBack}>
          JUMP BACK
        </button>
      )}
    </div>
  );
}
