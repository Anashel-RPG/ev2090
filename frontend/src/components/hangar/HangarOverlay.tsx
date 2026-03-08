/**
 * HangarOverlay — unified ship management overlay.
 * Replaces ShipForgeOverlay with the stunning ui-demo hangar design.
 *
 * Two contexts:
 *   "forge"  — opened from sidebar. Full catalog + COMMISSION tab. CTA = "Fly This Ship"
 *   "hangar" — opened from station panel. Catalog only. CTA = "Undock Ship"
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { AnimatePresence } from "motion/react";
import { getAllShips, type ShipDef } from "@/engine/ShipCatalog";
import {
  type HangarContext,
  type HangarShip,
  type CommunityShipMeta,
  toHangarShip,
  communityToHangarShip,
  buildShipDef,
  clearForgeApiKey,
  getForgeApiKey,
  setForgeApiKey,
} from "./hangarTypes";
import { FilterSidebar, type FilterState } from "./FilterSidebar";
import { ShipCard } from "./ShipCard";
import { ShipDetail } from "./ShipDetail";
import { ForgeCreatePanel } from "./ForgeCreatePanel";
import "./HangarOverlay.css";

type ViewTab = "fleet" | "commission";

interface HangarOverlayProps {
  open: boolean;
  context: HangarContext;
  onClose: () => void;
  onSelectShip: (shipId: string, def: ShipDef) => void;
  onUndock?: () => void;
  forgeApiUrl: string;
  nickname: string;
  currentShipId: string;
  // Auth gating
  isAuthenticated?: boolean;
  onRequestLogin?: () => void;
}

export function HangarOverlay({
  open,
  context,
  onClose,
  onSelectShip,
  onUndock,
  forgeApiUrl,
  nickname,
  currentShipId,
  isAuthenticated = false,
  onRequestLogin,
}: HangarOverlayProps) {
  const [viewTab, setViewTab] = useState<ViewTab>("fleet");
  const [selectedShip, setSelectedShip] = useState<HangarShip | null>(null);

  // Admin key (dev only) — stored in env or localStorage
  const [forgeApiKey, setForgeApiKeyState] = useState<string>(() => getForgeApiKey());
  const isAdmin = !!forgeApiKey;
  const [apiKeyPromptOpen, setApiKeyPromptOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  // Community catalog from API
  const [communityCatalog, setCommunityCatalog] = useState<CommunityShipMeta[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Forge lock state — admin API key bypasses, but guests are always blocked
  const [forgeLocked, setForgeLocked] = useState(true);
  // Whether the worker has the required AI API keys (Meshy, Gemini, Grok)
  const [aiAvailable, setAiAvailable] = useState(false);
  // In dev mode, skip auth requirement so local testing works without login flow
  const canForge = import.meta.env.DEV
    ? (!forgeLocked || isAdmin)
    : isAuthenticated && (!forgeLocked || isAdmin);

  // Filters
  const [filters, setFilters] = useState<FilterState>({
    class: [],
    minCargo: 0,
    minTurrets: 0,
    minLaunchers: 0,
    minDroneBay: 0,
  });

  // Fetch config + catalog on open
  useEffect(() => {
    if (!open) return;
    fetch(`${forgeApiUrl}/config`)
      .then((r) => r.json())
      .then((data: { forgeLocked?: boolean; aiAvailable?: boolean }) => {
        setForgeLocked(data.forgeLocked ?? false);
        setAiAvailable(data.aiAvailable ?? false);
      })
      .catch(() => { /* non-critical */ });
    if (communityCatalog.length === 0) {
      fetchCatalog();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep key state in sync (dev only)
  useEffect(() => {
    if (!open) return;
    setForgeApiKeyState(getForgeApiKey());
  }, [open]);

  const fetchCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch(`${forgeApiUrl}/catalog?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setCommunityCatalog(data.ships ?? []);
      }
    } catch {
      // Non-critical
    } finally {
      setCatalogLoading(false);
    }
  }, [forgeApiUrl]);

  // Build unified HangarShip[] from built-in + community
  const allShips: HangarShip[] = useMemo(() => {
    const builtIn = getAllShips().map((def) =>
      toHangarShip(def, def.id === currentShipId),
    );

    const community = communityCatalog.map((meta) => {
      const def = buildShipDef(meta);
      const ship = communityToHangarShip(meta, def);
      if (meta.id === currentShipId) ship.status = "Active";
      return ship;
    });

    // Dedup by ID — community version wins (fresher data from API)
    const communityIds = new Set(community.map((s) => s.id));
    return [
      ...builtIn.filter((s) => !communityIds.has(s.id)),
      ...community,
    ];
  }, [communityCatalog, currentShipId]);

  // Apply filters
  const filteredShips = useMemo(() => {
    return allShips.filter((s) => {
      if (filters.class.length > 0 && !filters.class.includes(s.class)) return false;
      if (s.cargoSpace < filters.minCargo) return false;
      if (s.hardpoints.turret < filters.minTurrets) return false;
      if (s.hardpoints.launcher < filters.minLaunchers) return false;
      if (s.droneBay < filters.minDroneBay) return false;
      return true;
    });
  }, [allShips, filters]);

  const handleFilterChange = useCallback((key: string, value: unknown) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Select a ship to fly
  const handleFlyShip = useCallback(
    (ship: HangarShip) => {
      onSelectShip(ship.id, ship._shipDef);
      setSelectedShip(null);
      if (context === "hangar" && onUndock) {
        onUndock();
      }
    },
    [onSelectShip, context, onUndock],
  );

  // Delete ship (admin only)
  const handleDeleteShip = useCallback(
    async (shipId: string) => {
      if (!isAdmin) return;
      if (!confirm("Delete this ship permanently? This cannot be undone.")) return;
      try {
        const res = await fetch(`${forgeApiUrl}/ship/${shipId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${forgeApiKey}` },
        });
        if (res.ok) {
          setCommunityCatalog((prev) => prev.filter((s) => s.id !== shipId));
          setSelectedShip(null);
        } else {
          const data = await res.json();
          alert(data.error ?? "Failed to delete ship");
        }
      } catch {
        alert("Network error — could not delete ship");
      }
    },
    [forgeApiUrl, isAdmin, forgeApiKey],
  );

  // Forge creation callback
  const handleShipCreated = useCallback(
    (shipId: string, def: ShipDef) => {
      onSelectShip(shipId, def);
    },
    [onSelectShip],
  );

  // Reset tab and selection on context change
  useEffect(() => {
    setViewTab("fleet");
    setSelectedShip(null);
  }, [context]);

  if (!open) return null;

  return (
    <div className="hangar-overlay">
      <div className="hangar-fullscreen">
        {/* ─── Header ─── */}
        <div className="hangar-header">
          <div className="hangar-header-left">
            <div className="hangar-title">
              {context === "hangar" ? "HANGAR" : "SHIP FORGE"}
            </div>
            <div className="hangar-tabs">
              <button
                className={`hangar-tab ${viewTab === "fleet" ? "hangar-tab-active" : ""}`}
                onClick={() => { setViewTab("fleet"); setSelectedShip(null); }}
              >
                FLEET
              </button>
              {context === "forge" && (
                <button
                  className={`hangar-tab ${viewTab === "commission" ? "hangar-tab-active" : ""}${!aiAvailable || !canForge ? " hangar-tab-disabled" : ""}`}
                  disabled={!aiAvailable}
                  title={
                    !aiAvailable
                      ? "Ship Forge AI is not configured — add MESHY_API_KEY, GEMINI_API_KEY, and GROK_API to worker/.dev.vars"
                      : undefined
                  }
                  onClick={() => {
                    if (!aiAvailable) return;
                    if (canForge) {
                      setViewTab("commission");
                      return;
                    }
                    // Guest → prompt login instead of admin key
                    if (!isAuthenticated && onRequestLogin) {
                      onRequestLogin();
                      return;
                    }
                    // Authenticated but forge-locked: allow admin key entry to bypass in dev
                    setApiKeyDraft("");
                    setApiKeyPromptOpen(true);
                  }}
                >
                  COMMISSION {!aiAvailable ? "⚙" : isAdmin ? "\uD83D\uDD11" : !isAuthenticated || forgeLocked ? "\uD83D\uDD12" : ""}
                </button>
              )}
            </div>
          </div>
          <button className="hangar-close" onClick={onClose}>&times;</button>
        </div>

        {/* Admin key prompt (dev only) */}
        {apiKeyPromptOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 80,
              background: "rgba(0,0,0,0.72)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setApiKeyPromptOpen(false);
            }}
          >
            <div
              style={{
                width: "min(560px, 100%)",
                background: "rgba(4, 10, 22, 0.98)",
                border: "1px solid rgba(255,255,255,0.09)",
                borderTop: "2px solid rgba(240,180,41,0.35)",
                boxShadow: "0 0 40px rgba(0,0,0,0.7)",
                padding: 16,
              }}
            >
              <div style={{ fontFamily: '"Share Tech Mono", monospace', fontSize: 12, letterSpacing: "0.14em", color: "rgba(220,235,250,0.9)" }}>
                FORGE LOCKED — ADMIN KEY REQUIRED
              </div>
              <div style={{ marginTop: 10, color: "rgba(180,200,220,0.7)", fontSize: 13, lineHeight: 1.5 }}>
                Production forge creation is currently locked. If you have an admin key, enter it to enable commissioning and save ships to production.
              </div>
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                placeholder="Paste admin API key…"
                style={{
                  marginTop: 14,
                  width: "100%",
                  padding: "10px 12px",
                  background: "rgba(0,0,0,0.45)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  color: "rgba(240,250,255,0.9)",
                  outline: "none",
                }}
                autoFocus
              />
              <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
                <button
                  className="hangar-tab"
                  onClick={() => {
                    clearForgeApiKey();
                    setForgeApiKeyState("");
                    setApiKeyPromptOpen(false);
                  }}
                >
                  CLEAR
                </button>
                <button className="hangar-tab" onClick={() => setApiKeyPromptOpen(false)}>
                  CANCEL
                </button>
                <button
                  className="hangar-tab hangar-tab-active"
                  onClick={() => {
                    setForgeApiKey(apiKeyDraft);
                    const k = getForgeApiKey();
                    setForgeApiKeyState(k);
                    setApiKeyPromptOpen(false);
                    if (k) setViewTab("commission");
                  }}
                  disabled={!apiKeyDraft.trim()}
                >
                  SAVE KEY
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── Fleet tab — filter sidebar + ship grid ─── */}
        {viewTab === "fleet" && (
          <div className={`hangar-body ${selectedShip ? "hangar-body-hidden" : ""}`}>
            <FilterSidebar
              filters={filters}
              onFilterChange={handleFilterChange}
              ships={allShips}
            />
            <div className="hangar-grid-area">
              {catalogLoading && allShips.length === 0 && (
                <div className="hangar-spinner">
                  <div className="hangar-spinner-dots">&#9679; &#9679; &#9679;</div>
                  <div className="hangar-spinner-text">LOADING FLEET REGISTRY...</div>
                </div>
              )}
              {!catalogLoading && filteredShips.length === 0 && (
                <div className="hangar-empty">
                  No ships match your filters.
                </div>
              )}
              {filteredShips.length > 0 && (
                <div className="hangar-grid">
                  <AnimatePresence>
                    {filteredShips.map((ship) => (
                      <ShipCard
                        key={ship.id}
                        ship={ship}
                        onClick={setSelectedShip}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── Ship Detail modal ─── */}
        <AnimatePresence>
          {viewTab === "fleet" && selectedShip && (
            <ShipDetail
              ship={selectedShip}
              context={context}
              onClose={() => setSelectedShip(null)}
              onFly={handleFlyShip}
              onDelete={isAdmin ? handleDeleteShip : undefined}
              isAdmin={isAdmin}
              forgeApiKey={forgeApiKey}
              forgeApiUrl={forgeApiUrl}
              onLoreUpdated={(shipId, newLore) => {
                setCommunityCatalog((prev) =>
                  prev.map((s) => (s.id === shipId ? { ...s, lore: newLore } : s)),
                );
                setSelectedShip((prev) =>
                  prev && prev.id === shipId ? { ...prev, description: newLore } : prev,
                );
              }}
              onHeroUpdated={(shipId, heroUrl) => {
                setCommunityCatalog((prev) =>
                  prev.map((s) => (s.id === shipId ? { ...s, heroUrl } : s)),
                );
                setSelectedShip((prev) =>
                  prev && prev.id === shipId ? { ...prev, imageUrl: heroUrl } : prev,
                );
              }}
            />
          )}
        </AnimatePresence>

        {/* ─── Commission tab — forge creation panel ─── */}
        {viewTab === "commission" && (
          <ForgeCreatePanel
            forgeApiUrl={forgeApiUrl}
            forgeApiKey={forgeApiKey}
            nickname={nickname}
            ships={allShips}
            onShipCreated={handleShipCreated}
            onCatalogRefresh={fetchCatalog}
          />
        )}
      </div>
    </div>
  );
}
