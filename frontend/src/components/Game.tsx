/**
 * Game — top-level React orchestrator for EV · 2090.
 *
 * Responsibilities:
 *   • Holds all UI state (loading, intro, docking, editor panels, overlays)
 *   • Subscribes to GameState from the engine via GameCanvasHandle
 *   • Manages layout across desktop / tablet / mobile breakpoints
 *   • Registers console debug functions (config, testship, forge, etc.)
 *   • Renders the full component tree: canvas, sidebar, HUD, overlays
 *
 * Sections (in render order):
 *   1. Loading overlay — progress bar + fade sequence
 *   2. GameCanvas — Three.js engine bridge
 *   3. Ship loading overlay — community ship download spinner
 *   4. Letterbox bars — cinematic hero mode transitions
 *   5. Station panels — docked planet UI (desktop vs mobile variants)
 *   6. Quest HUD — mission objective + rescue CTA
 *   7. Hangar / Ship Forge — unified ship management overlay
 *   8. Intro screen — first-time ship selection
 *   9. Authoring panels — hardpoint editor, hero shot, config (dev tools)
 *  10. Sidebar — radar, ship diagnostics, navigation
 *  11. Chat + nickname — bottom HUD elements
 *  12. Touch controls — tablet/mobile input buttons
 *  13. Dock / Jump buttons — context-sensitive HUD actions
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { GameCanvas } from "./GameCanvas";
import type { GameCanvasHandle } from "./GameCanvas";
import { Sidebar } from "./sidebar/Sidebar";
import { RadarPanel } from "./sidebar/RadarPanel";
import { ShipDiagnosticPanel } from "./sidebar/ShipDiagnosticPanel";
import { LightDebugPanel } from "./LightDebugPanel";
import { HeroShotPanel } from "./HeroShotPanel";
import { HardpointPanel } from "./HardpointPanel";
import { FpvConfigPanel } from "./FpvConfigPanel";
import { ChatPanel } from "./ChatPanel";
import { NicknameEditor } from "./NicknameEditor";
import { OffscreenIndicators } from "./OffscreenIndicators";
import { TouchControls } from "./TouchControls";
import { StationOverlay } from "./StationOverlay";
import { StationPanel } from "./StationPanel";
import { HangarOverlay } from "./hangar/HangarOverlay";
import type { HangarContext } from "./hangar/hangarTypes";
import { CargoWarningModal, computeJettisonList } from "./CargoWarningModal";
import type { CargoWarningData } from "./CargoWarningModal";
import { IntroScreen } from "./IntroScreen";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useAuth } from "@/hooks/useAuth";
import { usePlayerEconomy, getCargoCapacity } from "@/hooks/usePlayerEconomy";
import { useMarketPrices } from "@/hooks/useMarketPrices";
import { INITIAL_GAME_STATE } from "@/types/game";
import type { GameState, ShipColor } from "@/types/game";
import type { DebugView } from "@/engine/systems/CameraController";
import { SHIP_CATALOG, getShipDef } from "@/engine/ShipCatalog";
import { ModelCache } from "@/engine/systems/ModelCache";
import { AssetCache } from "@/engine/systems/AssetCache";
import { API_BASE, LIVE_API_BASE } from "@/config/urls";
import "./Game.css";

const CHAT_API_URL   = `${LIVE_API_BASE}/api/chat`;
const BOARD_API_URL  = `${LIVE_API_BASE}/api/board`;
const FORGE_API_URL  = `${LIVE_API_BASE}/api/forge`;
const MARKET_API_URL = `${API_BASE}/api/market`;

// ─── Nickname Generation ───
// Random pilot callsign for chat — persisted in localStorage

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

/**
 * Debug scene shortcuts via URL query params (dev only).
 *
 * Usage:  ?scene=gameplay     — skip intro, go straight to flight
 *         ?scene=docked       — skip intro, auto-dock at Nexara
 *         ?scene=heroshot     — skip intro, open Hero Shot panel
 *         ?scene=hardpoint    — skip intro, open Hardpoint Editor
 *         ?scene=config       — skip intro, open Config panel
 *         ?scene=intro        — force the intro/ship-select screen
 */
type DebugScene = "gameplay" | "docked" | "heroshot" | "hardpoint" | "config" | "intro" | null;

function getDebugScene(): DebugScene {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(window.location.search);
  const scene = params.get("scene");
  if (scene === "gameplay" || scene === "docked" || scene === "heroshot" ||
      scene === "hardpoint" || scene === "config" || scene === "intro") {
    return scene;
  }
  return null;
}

export function Game() {
  const bp = useBreakpoint();
  const auth = useAuth();
  const [loginRequested, setLoginRequested] = useState(false);
  // TODO: loginRequested will drive the LoginScreen overlay (Phase 2)
  void loginRequested;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = bp === "mobile";
  const sidebarIsDrawer = isMobile;
  // Sidebar pixel width — used for camera offset so the ship stays centered in the playable area
  const effectiveSidebarWidth = bp === "desktop" ? 240 : bp === "ipad" ? 200 : 0;

  // Debug scene shortcut (dev only, via ?scene=X query param)
  const debugScene = useRef(getDebugScene());
  const skipLoading = debugScene.current !== null && debugScene.current !== "intro";

  const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
  const [lightDebugOpen, setLightDebugOpen] = useState(() => {
    if (debugScene.current === "config") return true;
    try {
      return localStorage.getItem("ev-config-open") === "1";
    } catch {
      return false;
    }
  });
  const [nickname, setNickname] = useState(getStoredNickname);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>(skipLoading ? "done" : "loading");
  const [loadProgress, setLoadProgress] = useState(skipLoading ? 100 : 0);
  const engineReady = useRef(false);
  const canvasRef = useRef<GameCanvasHandle>(null);

  // Intro screen — shown once for first-time visitors
  const [introComplete, setIntroComplete] = useState(() => {
    if (skipLoading) return true; // debug shortcut skips intro
    if (debugScene.current === "intro") return false; // force intro
    try { return !!localStorage.getItem("ev-ship"); } catch { return false; }
  });

  // Station/dock state
  const [docked, setDocked] = useState(debugScene.current === "docked");
  const [dockedPlanet, setDockedPlanet] = useState<string | null>(
    debugScene.current === "docked" ? "Nexara" : null,
  );

  // ─── Player Economy ───
  const playerEconomy = usePlayerEconomy(gameState.currentShipId);
  const { snapshot: marketSnapshot } = useMarketPrices(MARKET_API_URL, docked);

  // Hero shot authoring tool
  const [heroShotOpen, setHeroShotOpen] = useState(debugScene.current === "heroshot");
  // Hardpoint editor authoring tool
  const [hardpointEditorOpen, setHardpointEditorOpen] = useState(debugScene.current === "hardpoint");
  // Hangar / Ship Forge overlay
  const [forgeOpen, setForgeOpen] = useState(false);
  const [hangarContext, setHangarContext] = useState<HangarContext>("forge");

  // Cargo warning modal — shown when switching to a ship with insufficient cargo capacity
  const [cargoWarning, setCargoWarning] = useState<CargoWarningData | null>(null);

  // Persist config panel state
  useEffect(() => {
    try {
      localStorage.setItem("ev-config-open", lightDebugOpen ? "1" : "0");
    } catch { /* storage blocked */ }
  }, [lightDebugOpen]);

  // Editor active — hide sidebar + HUD for full-screen composition
  const editorActive = heroShotOpen || hardpointEditorOpen;

  // Keep camera centered in playable area when sidebar width changes
  // Zero sidebar width when editor is active for full viewport
  useEffect(() => {
    canvasRef.current?.setSidebarWidthPx(editorActive ? 0 : effectiveSidebarWidth);
  }, [effectiveSidebarWidth, editorActive]);

  // ─── Console Debug API ───
  // Exposes utility functions on `window` for dev inspection.
  // See CLAUDE.md "Console Debug Commands" for the full list.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.config = () => {
      setLightDebugOpen((prev) => !prev);
    };
    w.testship = () => {
      canvasRef.current?.spawnTestShip();
    };
    w.heroshot = () => {
      setHeroShotOpen((prev) => {
        if (prev) {
          canvasRef.current?.exitHeroModeAnimated();
        }
        return !prev;
      });
    };
    w.hardpoints = () => {
      setHardpointEditorOpen((prev) => {
        if (prev) {
          canvasRef.current?.exitHardpointEditor();
        }
        return !prev;
      });
    };
    w.reset = () => {
      try {
        localStorage.removeItem("ev-ship");
        localStorage.removeItem("ev-quest-solace");
        localStorage.removeItem("ev-economy");
      } catch { /* blocked */ }
      AssetCache.clear().catch(() => {}).finally(() => {
        window.location.reload();
      });
    };
    // Zoom on ship — quick zoom in for inspecting models
    w.zoom = (factor?: unknown) => {
      const f = typeof factor === "number" ? factor : 0.3;
      canvasRef.current?.setZoom(f);
      return `Zoom set to ${f} (lower = closer)`;
    };
    // Reset zoom to default gameplay level
    w.zoomreset = () => {
      canvasRef.current?.setZoom(1);
      return "Zoom reset to 1";
    };
    // Open the ship forge overlay
    w.forge = () => {
      setForgeOpen((prev) => !prev);
    };
    // Switch ship by ID from console — e.g. ship("bob")
    w.ship = (id?: unknown) => {
      if (typeof id === "string") {
        canvasRef.current?.changeShip(id);
        return `Switching to ship: ${id}`;
      }
      return "Usage: ship('bob') — pass a ship ID string";
    };
    return () => {
      delete w.config;
      delete w.testship;
      delete w.heroshot;
      delete w.hardpoints;
      delete w.reset;
      delete w.zoom;
      delete w.zoomreset;
      delete w.forge;
      delete w.ship;
    };
  }, []);

  // Register ready callback once canvas is available
  useEffect(() => {
    canvasRef.current?.onReady(() => {
      engineReady.current = true;
    });
  }, []);

  // Debug scene activation — runs once when engine is ready (dev only)
  useEffect(() => {
    const scene = debugScene.current;
    if (!scene || scene === "intro" || scene === "gameplay" || scene === "config") return;

    // Wait a tick for the engine to finish constructing
    const timer = setTimeout(() => {
      if (scene === "docked") {
        canvasRef.current?.dock();
        canvasRef.current?.enterHeroMode({ type: "planet", id: "Nexara" });
      } else if (scene === "heroshot") {
        canvasRef.current?.enterHeroMode({ type: "planet", id: "Nexara" });
      } else if (scene === "hardpoint") {
        canvasRef.current?.enterHardpointEditor();
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Start the quest timer only after the intro screen is dismissed.
  // Also restore the player's saved ship from localStorage (if any).
  useEffect(() => {
    if (introComplete) {
      canvasRef.current?.startQuest();
      // Restore saved ship — community ships are already in the catalog
      // (auto-restored from localStorage by ShipCatalog module init).
      try {
        const savedShipId = localStorage.getItem("ev-ship");
        if (savedShipId) {
          canvasRef.current?.changeShip(savedShipId);
        }
      } catch { /* blocked */ }
    }
  }, [introComplete]);

  // ─── Loading Progress — Real Asset Preload ───
  // Preloads all built-in ship models via ModelCache (which caches to IndexedDB).
  // First visit: downloads ~55MB from CDN with real progress.
  // Subsequent visits: IndexedDB cache hit → near-instant.
  useEffect(() => {
    if (loadPhase !== "loading") return;

    let cancelled = false;

    const preload = async () => {
      // Wait for engine to be ready first
      while (!engineReady.current) {
        await new Promise((r) => setTimeout(r, 50));
        if (cancelled) return;
      }

      // Preload all built-in ship models with real progress
      const modelPaths = SHIP_CATALOG.map((s) => s.modelPath);
      await ModelCache.preloadWithProgress(modelPaths, (loaded, total) => {
        if (cancelled) return;
        setLoadProgress(Math.round((loaded / total) * 100));
      });

      if (cancelled) return;

      // All loaded — start fade sequence
      setLoadProgress(100);
      setTimeout(() => setLoadPhase("bar-fading"), 100);
      setTimeout(() => setLoadPhase("canvas-fading"), 700);
      setTimeout(() => setLoadPhase("done"), 2000);
    };

    preload().catch((err) => {
      console.error("Preload failed:", err);
      // Fall through to game even on error — models will load on demand
      if (!cancelled) {
        setLoadProgress(100);
        setTimeout(() => setLoadPhase("bar-fading"), 100);
        setTimeout(() => setLoadPhase("canvas-fading"), 700);
        setTimeout(() => setLoadPhase("done"), 2000);
      }
    });

    return () => { cancelled = true; };
  }, [loadPhase]);

  // ─── Event Handlers ───

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

  const handleTriggerRescue = useCallback(() => {
    canvasRef.current?.triggerQuestRescue();
  }, []);

  const handleShipChange = useCallback((shipId: string) => {
    const newCap = getCargoCapacity(shipId);
    if (playerEconomy.cargoWeight > newCap) {
      const items = computeJettisonList(
        playerEconomy.cargo, playerEconomy.cargoWeight, newCap, marketSnapshot,
      );
      setCargoWarning({ newShipId: shipId, newCapacity: newCap, itemsToJettison: items });
      return;
    }
    canvasRef.current?.changeShip(shipId);
    try { localStorage.setItem("ev-ship", shipId); } catch { /* blocked */ }
  }, [playerEconomy.cargoWeight, playerEconomy.cargo, marketSnapshot]);

  const handleColorChange = useCallback((color: ShipColor) => {
    canvasRef.current?.changeShipColor(color);
  }, []);

  const handleIntroComplete = useCallback((shipId: string, color: ShipColor) => {
    setIntroComplete(true);
    canvasRef.current?.changeShip(shipId);
    canvasRef.current?.changeShipColor(color);
    try { localStorage.setItem("ev-ship", shipId); } catch { /* blocked */ }
  }, []);

  const handleJumpBack = useCallback(() => {
    canvasRef.current?.jumpBack();
    // Remove focus so keyboard doesn't trigger focus border
    (document.activeElement as HTMLElement)?.blur();
  }, []);

  // ─── Dock / Undock ───

  const handleDock = useCallback(() => {
    if (!gameState.dockable) return;
    canvasRef.current?.dock();
    setDocked(true);
    setDockedPlanet(gameState.dockable.planetName);

    // Enter hero mode for the planet — cinematic docking view
    canvasRef.current?.enterHeroMode({
      type: "planet",
      id: gameState.dockable.planetName,
    });
  }, [gameState.dockable]);

  // Keep a ref to the latest handleDock so the engine callback always fires current logic
  const dockRef = useRef(handleDock);
  dockRef.current = handleDock;

  // Register keyboard dock shortcut (D/L) with the engine — once on mount
  useEffect(() => {
    canvasRef.current?.setDockRequestCallback(() => dockRef.current());
  }, []);

  const handleUndock = useCallback(() => {
    // Animated exit from hero mode first, then undock
    canvasRef.current?.exitHeroModeAnimated(1.5);
    canvasRef.current?.undock();
    setDocked(false);
    setDockedPlanet(null);
  }, []);

  const handleRepair = useCallback(() => {
    canvasRef.current?.repairShip();
  }, []);

  const handleRefuel = useCallback(() => {
    canvasRef.current?.refuelShip();
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

  // ─── Ship Loading / Forge ───

  const [shipLoading, setShipLoading] = useState(false);

  // Auto-hide ship loading overlay when model finishes loading
  useEffect(() => {
    if (shipLoading && gameState.shipModelLoaded) {
      // Small delay so the fade-out looks smooth
      const t = setTimeout(() => setShipLoading(false), 400);
      return () => clearTimeout(t);
    }
  }, [shipLoading, gameState.shipModelLoaded]);

  // Hangar / Forge — select a ship (with cargo overflow check)
  const pendingHangarDef = useRef<import("@/engine/ShipCatalog").ShipDef | null>(null);
  const handleHangarShipSelect = useCallback((shipId: string, def: import("@/engine/ShipCatalog").ShipDef) => {
    const newCap = getCargoCapacity(shipId);
    if (playerEconomy.cargoWeight > newCap) {
      pendingHangarDef.current = def;
      const items = computeJettisonList(
        playerEconomy.cargo, playerEconomy.cargoWeight, newCap, marketSnapshot,
      );
      setCargoWarning({ newShipId: shipId, newCapacity: newCap, itemsToJettison: items });
      return;
    }
    if (def.source === "community") {
      canvasRef.current?.registerCommunityShip(def);
      setShipLoading(true);
    }
    canvasRef.current?.changeShip(shipId);
    try { localStorage.setItem("ev-ship", shipId); } catch { /* blocked */ }
    setForgeOpen(false);
  }, [playerEconomy.cargoWeight, playerEconomy.cargo, marketSnapshot]);

  // Cargo warning modal — confirm jettison & switch
  const handleCargoWarningConfirm = useCallback(() => {
    if (!cargoWarning) return;
    const { newShipId, itemsToJettison } = cargoWarning;
    // Jettison items
    playerEconomy.jettison(itemsToJettison.map(i => ({ commodityId: i.commodityId, quantity: i.quantity })));
    // Register community ship if pending from hangar
    const def = pendingHangarDef.current;
    if (def?.source === "community") {
      canvasRef.current?.registerCommunityShip(def);
      setShipLoading(true);
    }
    pendingHangarDef.current = null;
    canvasRef.current?.changeShip(newShipId);
    try { localStorage.setItem("ev-ship", newShipId); } catch { /* blocked */ }
    setForgeOpen(false);
    setCargoWarning(null);
  }, [cargoWarning, playerEconomy]);

  const handleCargoWarningCancel = useCallback(() => {
    pendingHangarDef.current = null;
    setCargoWarning(null);
  }, []);

  const isLoading = loadPhase === "loading";
  const canvasReady = (loadPhase === "canvas-fading" || loadPhase === "done") && introComplete;

  return (
    <div className={`game-container ${canvasReady ? "game-ready" : ""} ${docked ? "game-docked" : ""}`}>
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

      <GameCanvas
        ref={canvasRef}
        onStateUpdate={handleStateUpdate}
      />

      {/* Ship loading overlay — shown while community ship model downloads */}
      {shipLoading && (
        <div className={`ship-loading-overlay ${gameState.shipModelLoaded ? "ship-loading-fade" : ""}`}>
          <div className="ship-loading-content">
            <div className="ship-loading-spinner" />
            <div className="ship-loading-text">LOADING SHIP MODEL</div>
          </div>
        </div>
      )}

      {/* Letterbox cinematic bars — show during hero mode transitions.
           Hidden once fully docked (station panel takes over), but kept for
           combat / comm-link cinematics. The bars still render during the
           dock *transition* so the cinematic zoom-in looks correct. */}
      {gameState.heroLetterbox > 0.001 && !docked && (
        <>
          <div
            className="hero-letterbox-bar hero-letterbox-top"
            style={{ height: `${gameState.heroLetterbox * 12}vh` }}
          />
          <div
            className="hero-letterbox-bar hero-letterbox-bottom"
            style={{ height: `${gameState.heroLetterbox * 12}vh` }}
          />
        </>
      )}

      {/* Station docking — sci-fi panel on desktop, CRT terminal on mobile */}
      {docked && dockedPlanet && !sidebarIsDrawer && (
        <StationPanel
          planetName={dockedPlanet}
          shipId={gameState.currentShipId}
          heroLetterbox={gameState.heroLetterbox}
          onUndock={handleUndock}
          onRepair={handleRepair}
          onRefuel={handleRefuel}
          shields={gameState.ship.shields}
          armor={gameState.ship.armor}
          fuel={gameState.ship.fuel}
          onOpenHangar={() => { setHangarContext("hangar"); setForgeOpen(true); }}
          marketSnapshot={marketSnapshot}
          playerCredits={playerEconomy.credits}
          playerCargo={playerEconomy.cargo}
          cargoWeight={playerEconomy.cargoWeight}
          cargoCapacity={playerEconomy.cargoCapacity}
          onBuy={(commodityId, qty, price) => playerEconomy.buy(commodityId, qty, price, dockedPlanet!.toLowerCase())}
          onSell={(commodityId, qty, price) => playerEconomy.sell(commodityId, qty, price, dockedPlanet!.toLowerCase())}
        />
      )}
      {docked && dockedPlanet && sidebarIsDrawer && (
        <StationOverlay
          planetName={dockedPlanet}
          nickname={nickname}
          boardApiUrl={BOARD_API_URL}
          onUndock={handleUndock}
          onRepair={handleRepair}
          onRefuel={handleRefuel}
          onOpenHangar={() => { setHangarContext("hangar"); setForgeOpen(true); }}
          shields={gameState.ship.shields}
          armor={gameState.ship.armor}
          fuel={gameState.ship.fuel}
          credits={playerEconomy.credits}
          cargo={playerEconomy.cargo}
          cargoWeight={playerEconomy.cargoWeight}
          cargoCapacity={playerEconomy.cargoCapacity}
        />
      )}

      {/* Mission objective — text-only top-right HUD (hidden during FPV) */}
      {!sidebarIsDrawer && !docked && !editorActive && !gameState.fpv && gameState.questComms?.objective && (
        <div className="hud-objective">{gameState.questComms.objective}</div>
      )}

      {/* Quest ship on-screen overlay — label + rescue CTA */}
      {gameState.questRescueCta && gameState.questComms &&
       !["IDLE", "COMPLETE"].includes(gameState.questComms.phase) &&
       !gameState.questComms.controlsLocked && (
        <div
          className={`quest-ship-overlay${gameState.questComms.rescuable ? " quest-rescuable" : ""}`}
          style={{
            left: gameState.questRescueCta.screenX,
            top: gameState.questRescueCta.screenY,
          }}
          onClick={gameState.questComms.rescuable ? handleTriggerRescue : undefined}
        >
          {/* Acquisition frame — visual hover effect */}
          <div className="quest-acq-frame" />

          {/* Ship name label — blue */}
          <div className="quest-ship-name">SOLACE</div>

          {/* Rescue CTA — dotted line + label */}
          {gameState.questComms.rescuable && (
            <>
              <svg className="quest-rescue-connector" width="90" height="70" viewBox="0 0 90 70">
                <line x1="2" y1="65" x2="85" y2="5"
                  stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeDasharray="4 3" />
              </svg>
              <div className="quest-rescue-label">RESCUE SHIP</div>
            </>
          )}
        </div>
      )}

      {/* Rescue animation text — during rescue/fading */}
      {gameState.questRescueCta && gameState.questComms?.controlsLocked && (
        <div
          className={`rescue-text ${gameState.questComms.phase === "FADING" ? "rescue-text-complete" : ""}`}
          style={{
            left: gameState.questRescueCta.screenX,
            top: gameState.questRescueCta.screenY,
          }}
        >
          {gameState.questComms.phase === "FADING"
            ? "6 CREW RESCUED"
            : "RESCUING..."}
        </div>
      )}

      {/* Hangar / Ship Forge overlay */}
      {forgeOpen && (
        <HangarOverlay
          open={forgeOpen}
          context={hangarContext}
          onClose={() => setForgeOpen(false)}
          onSelectShip={handleHangarShipSelect}
          onUndock={hangarContext === "hangar" ? handleUndock : undefined}
          forgeApiUrl={FORGE_API_URL}
          nickname={nickname}
          currentShipId={gameState.currentShipId}
          isAuthenticated={auth.isAuthenticated}
          onRequestLogin={() => setLoginRequested(true)}
        />
      )}

      {/* Cargo overflow warning — ship switch with insufficient capacity */}
      {cargoWarning && (
        <CargoWarningModal
          currentWeight={playerEconomy.cargoWeight}
          newCapacity={cargoWarning.newCapacity}
          newShipName={getShipDef(cargoWarning.newShipId)?.name ?? cargoWarning.newShipId}
          itemsToJettison={cargoWarning.itemsToJettison}
          onConfirm={handleCargoWarningConfirm}
          onCancel={handleCargoWarningCancel}
        />
      )}

      {/* Intro screen — first-time ship selection (fades in as soon as loading bar completes) */}
      {!introComplete && loadPhase !== "loading" && (
        <IntroScreen onComplete={handleIntroComplete} />
      )}

      {/* Hardpoint Editor authoring panel */}
      {!sidebarIsDrawer && (
        <HardpointPanel
          enabled={hardpointEditorOpen}
          onClose={() => {
            setHardpointEditorOpen(false);
            canvasRef.current?.exitHardpointEditor();
          }}
          currentShipId={gameState.currentShipId}
          enterHardpointEditor={() => canvasRef.current?.enterHardpointEditor()}
          exitHardpointEditor={() => canvasRef.current?.exitHardpointEditor()}
          setPlacementType={(type) => canvasRef.current?.setHardpointPlacementType(type)}
          getPlacementType={() => canvasRef.current?.getHardpointPlacementType() ?? "thruster"}
          getHardpoints={() => canvasRef.current?.getHardpoints() ?? []}
          deleteHardpoint={(id) => canvasRef.current?.deleteHardpoint(id)}
          selectHardpoint={(id) => canvasRef.current?.selectHardpoint(id)}
          getSelectedId={() => canvasRef.current?.getSelectedHardpointId() ?? null}
          changeShip={(shipId) => canvasRef.current?.changeShipForHardpointEditor(shipId)}
          updatePosition={(id, axis, value) => canvasRef.current?.updateHardpointPosition(id, axis, value)}
          updateThrustAngle={(id, angleDeg) => canvasRef.current?.updateHardpointThrustAngle(id, angleDeg)}
          setShipScale={(s) => canvasRef.current?.setHardpointShipScale(s)}
          getShipScale={() => canvasRef.current?.getHardpointShipScale() ?? 0.4}
          setLockedAxis={(a) => canvasRef.current?.setHardpointLockedAxis(a)}
          getLockedAxis={() => canvasRef.current?.getHardpointLockedAxis() ?? null}
          setMaterialProperty={(prop, val) => canvasRef.current?.setHardpointMaterialProperty(prop, val)}
          getMaterialConfig={() => canvasRef.current?.getHardpointMaterialConfig() ?? {
            metalness: 0.4, roughness: 0.2, emissiveIntensity: 0.15,
            emissiveR: 34, emissiveG: 34, emissiveB: 51,
          }}
        />
      )}

      {/* Hero Shot authoring panel */}
      {!sidebarIsDrawer && (
        <HeroShotPanel
          enabled={heroShotOpen}
          onClose={() => {
            setHeroShotOpen(false);
          }}
          enterHeroMode={(subject) => canvasRef.current?.enterHeroMode(subject)}
          exitHeroModeAnimated={(dur) => canvasRef.current?.exitHeroModeAnimated(dur)}
          isInHeroMode={() => canvasRef.current?.isInHeroMode() ?? false}
          setConfig={(prop, val) => canvasRef.current?.setHeroConfig(prop, val)}
          getConfig={() => canvasRef.current?.getHeroConfig() ?? null}
          previewToGameplay={(dur, cb) => canvasRef.current?.heroPreviewToGameplay(dur, cb)}
          previewToComposed={(dur, cb) => canvasRef.current?.heroPreviewToComposed(dur, cb)}
          isAnimating={() => canvasRef.current?.isHeroAnimating() ?? false}
          getPlanetNames={() => canvasRef.current?.getPlanetNames() ?? []}
          currentShipId={gameState.currentShipId}
          setShipRotation={(r) => canvasRef.current?.setShipRotation(r)}
          getShipRotation={() => canvasRef.current?.getShipRotation() ?? 0}
          setShipTilt={(r) => canvasRef.current?.setShipTilt(r)}
          getShipTilt={() => canvasRef.current?.getShipTilt() ?? (-22 * Math.PI) / 180}
          setShipRoll={(r) => canvasRef.current?.setShipRoll(r)}
          getShipRoll={() => canvasRef.current?.getShipRoll() ?? 0}
          setShipScale={(s) => canvasRef.current?.setShipScale(s)}
          getShipScale={() => canvasRef.current?.getShipScale() ?? 1}
          setHeroShipRotateMode={(on) => canvasRef.current?.setHeroShipRotateMode(on)}
          isHeroShipRotateMode={() => canvasRef.current?.isHeroShipRotateMode() ?? false}
        />
      )}

      {/* Exit Comm Mode button — shown when in NPC comm mode */}
      {gameState.commViewTarget && (
        <button
          className="hud-exit-comm-btn"
          onClick={() => canvasRef.current?.exitCommMode()}
        >
          EXIT COMM MODE
        </button>
      )}

      {/* FPV post-processing config panel — visible when FPV is fully active (hidden during comm view and bridge) */}
      <FpvConfigPanel
        visible={gameState.fpvTransition > 0.95 && !gameState.commViewTarget && gameState.bridgeTransition < 0.01}
        getConfig={() => canvasRef.current?.getFpvPostConfig() ?? {}}
        setParam={(key, val) => canvasRef.current?.setFpvPostParam(key, val)}
      />

      {/* Bridge tuning now handled by Tweakpane (BridgeTuner.ts in engine) */}

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
          onOpenHeroShot={() => {
            setHeroShotOpen(true);
            setLightDebugOpen(false);
          }}
          onOpenHardpointEditor={() => {
            setHardpointEditorOpen(true);
            canvasRef.current?.enterHardpointEditor();
            setLightDebugOpen(false);
          }}
          currentShipId={gameState.currentShipId}
          fps={gameState.fps}
          onSetZoom={(factor) => canvasRef.current?.setZoom(factor)}
          getZoom={() => canvasRef.current?.getZoom() ?? 1}
          onSetCameraOffset={(x, y) => canvasRef.current?.setCameraOffset(x, y)}
          getCameraOffset={() => canvasRef.current?.getCameraOffset() ?? { x: 0, y: 0 }}
        />
      )}

      {/* Sidebar — desktop/ipad always visible, hidden on mobile, editor, and when docked */}
      {!isMobile && !editorActive && !docked && (
        <div className={`sidebar-boot-wrapper ${isLoading ? "" : "sidebar-booting"} ${gameState.fpv ? "sidebar-fpv-hidden" : ""}`}>
          <Sidebar
            gameState={gameState}
            onShipChange={handleShipChange}
            onColorChange={handleColorChange}
            onConfigToggle={() => setLightDebugOpen((prev) => !prev)}
            onForgeOpen={() => { setHangarContext("forge"); setForgeOpen(true); }}
            credits={playerEconomy.credits}
            cargo={playerEconomy.cargo}
            cargoWeight={playerEconomy.cargoWeight}
            cargoCapacity={playerEconomy.cargoCapacity}
            marketSnapshot={marketSnapshot}
            transactions={playerEconomy.transactions}
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
          <ShipDiagnosticPanel shipId={gameState.currentShipId} />
        </div>
      )}

      {/* Sidebar toggle button — tablet/mobile only (hidden during intro and when mobile modal is open) */}
      {sidebarIsDrawer && introComplete && !(isMobile && sidebarOpen) && (
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen((prev) => !prev)}
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          {sidebarOpen ? "\u2715" : "\u2630"}
        </button>
      )}

      {/* Mini radar HUD — tablet/mobile only, when sidebar is closed and intro done */}
      {sidebarIsDrawer && !sidebarOpen && introComplete && (
        <div className="hud-mini-radar">
          <RadarPanel
            shipPosition={gameState.ship.position}
            shipHeading={gameState.ship.heading}
            contacts={gameState.radarContacts}
            size={90}
            compact
          />
        </div>
      )}

      {/* Off-screen planet & ship direction indicators — hidden when docked or FPV */}
      {!editorActive && !docked && !gameState.fpv && (
        <OffscreenIndicators
          shipPosition={gameState.ship.position}
          shipHeading={gameState.ship.heading}
          contacts={gameState.radarContacts}
          sidebarWidth={effectiveSidebarWidth}
          questTargetName={gameState.questComms?.phase !== "IDLE" && gameState.questComms?.phase !== "COMPLETE" ? gameState.questComms?.targetName : undefined}
        />
      )}

      {/* HUD Overlays — hidden when docked, in drawer modes, editor, or FPV */}
      {!sidebarIsDrawer && !editorActive && !docked && !gameState.fpv && (
        <NicknameEditor
          nickname={nickname}
          onNicknameChange={handleNicknameChange}
        />
      )}
      {!sidebarIsDrawer && !editorActive && !docked && !gameState.fpv && (
        <ChatPanel
          apiUrl={CHAT_API_URL}
          nickname={nickname}
          questComms={gameState.questComms}
        />
      )}

      {/* Touch controls — tablet/mobile only */}
      {sidebarIsDrawer && <TouchControls />}

      {/* DOCK button — shown when near a planet and slow enough (hidden during FPV) */}
      {!docked && !sidebarIsDrawer && !editorActive && !gameState.fpv && gameState.dockable && (
        <button className="hud-dock-btn" onClick={handleDock}>
          DOCK AT {gameState.dockable.planetName.toUpperCase()}
        </button>
      )}

      {!sidebarIsDrawer && !docked && !editorActive && !gameState.fpv && !gameState.questComms && (gameState.navigation.nearestDistance ?? 0) > 25 && (
        <button className="hud-jump-btn" onClick={handleJumpBack}>
          JUMP BACK
        </button>
      )}
    </div>
  );
}
