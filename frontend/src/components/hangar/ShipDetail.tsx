/**
 * ShipDetail — fullscreen ship detail modal with 3D preview.
 * Ported from ui-demo/hangar/src/components/ShipDetail.tsx.
 *
 * 3D renderer extracted to engine/ShipDetailRenderer.ts per architecture rules.
 *
 * Admin features (when isAdmin + community ship):
 *   - Regenerate lore via Grok
 *   - Regenerate hero header image via Grok + Gemini (with ship pose capture)
 *   - Light tuning UI with copy button (dev tool)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import {
  X, Play, Shield, Zap, Crosshair, Box, Cpu, Activity, Scan, LogOut,
  Trash2, RefreshCw, Image, RotateCcw, Camera, Loader, Clipboard,
  Sun, Check, ThumbsDown,
} from "lucide-react";
import { ShipDetailRenderer, type DetailLightConfig, type DetailMaterialConfig } from "@/engine/ShipDetailRenderer";
import { HangarButton } from "./HangarUI";
import { CLASS_COLOR, CLASS_HERO_TINT, DEFAULT_HERO_TINT, type HangarShip, type HangarContext } from "./hangarTypes";
import "./ShipDetail.css";

interface ShipDetailProps {
  ship: HangarShip;
  context: HangarContext;
  onClose: () => void;
  onFly: (ship: HangarShip) => void;
  onDelete?: (shipId: string) => void;
  isAdmin?: boolean;
  forgeApiUrl?: string;
  forgeApiKey?: string;
  onLoreUpdated?: (shipId: string, newLore: string) => void;
  onHeroUpdated?: (shipId: string, heroUrl: string) => void;
}

const mono: React.CSSProperties = { fontFamily: '"Share Tech Mono", monospace' };
const raj: React.CSSProperties = { fontFamily: '"Rajdhani", sans-serif' };

const sectionLabel: React.CSSProperties = {
  ...mono,
  fontSize: "9px",
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: "rgba(0,200,255,0.45)",
};

export function ShipDetail({
  ship, context, onClose, onFly, onDelete, isAdmin,
  forgeApiUrl, forgeApiKey, onLoreUpdated, onHeroUpdated,
}: ShipDetailProps) {
  const classColor = CLASS_COLOR[ship.class] ?? "rgba(100,120,150,0.9)";
  const canAdmin = isAdmin && !!forgeApiUrl && !!forgeApiKey;

  // Local state for live updates
  const [currentLore, setCurrentLore] = useState(ship.description);
  const [currentHeroUrl, setCurrentHeroUrl] = useState(ship.imageUrl);

  // Lore regen state
  const [lorePrompt, setLorePrompt] = useState(
    `The ${ship.name}, a ${ship.class} class spaceship`
  );
  const [loreLoading, setLoreLoading] = useState(false);
  const [loreOpen, setLoreOpen] = useState(false);

  // Hero regen state
  const [heroMode, setHeroMode] = useState(false);
  const [heroDescription, setHeroDescription] = useState(
    "An epic color render of a spaceship shot."
  );
  const [heroLoading, setHeroLoading] = useState(false);
  const [heroDraftUrl, setHeroDraftUrl] = useState<string | null>(null); // Preview before approve

  // Light tuning (3D renderer)
  const [lightOpen, setLightOpen] = useState(false);
  const [lightCopied, setLightCopied] = useState(false);

  // Hero visual tuning (image brightness, bloom, gradient tint)
  const [heroVisualOpen, setHeroVisualOpen] = useState(false);
  const [heroVisualCopied, setHeroVisualCopied] = useState(false);
  const [heroVisual, setHeroVisual] = useState(() => {
    const tint = CLASS_HERO_TINT[ship.class] ?? DEFAULT_HERO_TINT;
    return {
      imgOpacity: 1,
      bloomOpacity: 0.53,
      bloomBlur: 22,
      bottomGradR: tint.r,
      bottomGradG: tint.g,
      bottomGradB: tint.b,
      bottomGradOpacity: 1,
      bottomGradMidOpacity: 0.25,
      sideGradOpacity: 0.38,
    };
  });

  // Renderer ref for pose control + capture
  const rendererRef = useRef<ShipDetailRenderer | null>(null);

  /* ─── Lore Regeneration ─── */

  const handleRegenerateLore = useCallback(async () => {
    if (!forgeApiUrl || !forgeApiKey || !lorePrompt.trim()) return;
    setLoreLoading(true);
    try {
      const res = await fetch(`${forgeApiUrl}/ship/${ship.id}/lore`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${forgeApiKey}`,
        },
        body: JSON.stringify({
          prompt: lorePrompt.trim(),
          currentLore,
          shipName: ship.name,
          shipClass: ship.class,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { lore: string };
        setCurrentLore(data.lore);
        setLorePrompt("");
        setLoreOpen(false);
        onLoreUpdated?.(ship.id, data.lore);
      } else {
        const err = await res.json() as { error?: string };
        alert(err.error ?? "Failed to regenerate lore");
      }
    } catch {
      alert("Network error — could not regenerate lore");
    } finally {
      setLoreLoading(false);
    }
  }, [forgeApiUrl, forgeApiKey, lorePrompt, currentLore, ship.id, ship.name, ship.class, onLoreUpdated]);

  /* ─── Hero Image Regeneration (draft → preview → approve) ─── */

  // Polling ref — must be declared before callbacks that use it
  const heroPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (heroPollingRef.current) clearInterval(heroPollingRef.current);
    };
  }, []);

  const enterHeroMode = useCallback(() => {
    setHeroMode(true);
    setHeroDraftUrl(null);
    const r = rendererRef.current;
    if (r) {
      r.setPaused(true);
      r.setInteractive(true);
    }
  }, []);

  const exitHeroMode = useCallback(() => {
    setHeroMode(false);
    setHeroDescription("");
    setHeroDraftUrl(null);
    setHeroLoading(false);
    if (heroPollingRef.current) {
      clearInterval(heroPollingRef.current);
      heroPollingRef.current = null;
    }
    const r = rendererRef.current;
    if (r) {
      r.setInteractive(false);
      r.setPaused(false);
    }
  }, []);

  const handleGenerateHeroDraft = useCallback(async () => {
    if (!forgeApiUrl || !forgeApiKey || !heroDescription.trim()) return;
    const r = rendererRef.current;
    if (!r) return;

    setHeroLoading(true);
    try {
      const screenshot = r.captureScreenshot();
      if (!screenshot) {
        alert("Failed to capture screenshot");
        setHeroLoading(false);
        return;
      }

      const res = await fetch(`${forgeApiUrl}/ship/${ship.id}/hero`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${forgeApiKey}`,
        },
        body: JSON.stringify({
          description: heroDescription.trim(),
          screenshot,
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(err.error ?? "Failed to start hero generation");
        setHeroLoading(false);
        return;
      }

      // Response is immediate — now poll for completion
      if (heroPollingRef.current) clearInterval(heroPollingRef.current);

      const pollStart = Date.now();
      const POLL_TIMEOUT = 5 * 60 * 1000; // 5 min max

      heroPollingRef.current = setInterval(async () => {
        try {
          if (Date.now() - pollStart > POLL_TIMEOUT) {
            clearInterval(heroPollingRef.current!);
            heroPollingRef.current = null;
            setHeroLoading(false);
            alert("Hero generation timed out. Try again.");
            return;
          }

          const statusRes = await fetch(`${forgeApiUrl}/ship/${ship.id}/hero/status`, {
            headers: { Authorization: `Bearer ${forgeApiKey}` },
          });

          if (!statusRes.ok) return;

          const status = await statusRes.json() as {
            status: "pending" | "ready" | "error" | "idle";
            heroUrl?: string;
            error?: string;
          };

          if (status.status === "ready" && status.heroUrl) {
            clearInterval(heroPollingRef.current!);
            heroPollingRef.current = null;
            setHeroLoading(false);
            setHeroDraftUrl(status.heroUrl + "?t=" + Date.now());
          } else if (status.status === "error") {
            clearInterval(heroPollingRef.current!);
            heroPollingRef.current = null;
            setHeroLoading(false);
            alert(status.error ?? "Hero generation failed");
          }
        } catch {
          // Network hiccup — keep polling
        }
      }, 3000);
    } catch {
      alert("Network error — could not start hero generation");
      setHeroLoading(false);
    }
  }, [forgeApiUrl, forgeApiKey, heroDescription, ship.id]);

  // Step 2: Approve draft — confirm as official hero
  const handleApproveHero = useCallback(async () => {
    if (!forgeApiUrl || !forgeApiKey || !heroDraftUrl) return;
    try {
      const res = await fetch(`${forgeApiUrl}/ship/${ship.id}/hero/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${forgeApiKey}`,
        },
      });
      if (res.ok) {
        const data = await res.json() as { heroUrl: string };
        setCurrentHeroUrl(data.heroUrl + "?t=" + Date.now());
        onHeroUpdated?.(ship.id, data.heroUrl);
        exitHeroMode();
      } else {
        const err = await res.json() as { error?: string };
        alert(err.error ?? "Failed to approve hero");
      }
    } catch {
      alert("Network error — could not approve hero");
    }
  }, [forgeApiUrl, forgeApiKey, heroDraftUrl, ship.id, exitHeroMode, onHeroUpdated]);

  // Step 2b: Reject draft — discard and try again
  const handleRejectHero = useCallback(() => {
    setHeroDraftUrl(null);
  }, []);

  /* ─── Light Config Copy ─── */

  const handleCopyLightConfig = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    const config = {
      ship: { id: ship.id, name: ship.name },
      ...r.getFullConfig(),
    };
    const json = JSON.stringify(config, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      setLightCopied(true);
      setTimeout(() => setLightCopied(false), 2000);
    });
  }, [ship.id, ship.name]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(2, 5, 12, 0.94)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !heroMode) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.25 }}
        style={{
          width: "100%",
          maxWidth: "1100px",
          height: "90vh",
          background: "rgba(4, 10, 22, 0.9)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderTop: "2px solid rgba(240,180,41,0.35)",
          boxShadow: "0 0 60px rgba(0,0,0,0.7), 0 0 20px rgba(240,180,41,0.05)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="hangar-detail-close"
        >
          <X size={14} />
        </button>

        {/* Hero visual tuner toggle (admin dev tool — unhide to tune BG settings) */}
        {false && canAdmin && !heroMode && (
          <button
            className={`hero-visual-tuner-btn${heroVisualOpen ? " active" : ""}`}
            onClick={() => setHeroVisualOpen(v => !v)}
            title="Hero visual tuner"
          >
            <Sun size={11} /> BG
          </button>
        )}

        {/* Hero Image area */}
        <div
          style={{
            flex: 1,
            position: "relative",
            background: "#020408",
            overflow: "hidden",
            minHeight: "40vh",
          }}
        >
          {currentHeroUrl ? (
            <>
              {/* Base image — dims to 15% in hero mode so user can see positioning without polluting Gemini input */}
              <img
                src={currentHeroUrl}
                alt={ship.name}
                style={{ width: "100%", height: "100%", objectFit: "cover", opacity: heroMode ? 0.15 : heroVisual.imgOpacity, transition: "opacity 0.3s" }}
              />
              {/* Bloom pass — blurred copy layered on top */}
              {heroVisual.bloomOpacity > 0 && !heroMode && (
                <img
                  src={currentHeroUrl}
                  alt=""
                  aria-hidden
                  style={{
                    position: "absolute", inset: 0,
                    width: "100%", height: "100%", objectFit: "cover",
                    opacity: heroVisual.bloomOpacity,
                    filter: `blur(${heroVisual.bloomBlur}px) saturate(1.6)`,
                    mixBlendMode: "screen",
                  }}
                />
              )}
            </>
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                background: `
                  radial-gradient(ellipse at 30% 50%, rgba(0,100,200,0.06) 0%, transparent 60%),
                  linear-gradient(180deg, rgba(4,8,15,1) 0%, rgba(8,16,30,1) 100%)
                `,
              }}
            />
          )}

          {/* Gradient fades */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(to top,
                rgba(${heroVisual.bottomGradR},${heroVisual.bottomGradG},${heroVisual.bottomGradB},${heroVisual.bottomGradOpacity}) 0%,
                rgba(${heroVisual.bottomGradR},${heroVisual.bottomGradG},${heroVisual.bottomGradB},${heroVisual.bottomGradMidOpacity}) 40%,
                transparent 100%)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(to right, rgba(4,10,22,${heroVisual.sideGradOpacity}) 0%, transparent 40%, rgba(4,10,22,${Math.round(heroVisual.sideGradOpacity * 50) / 100}) 100%)`,
            }}
          />

          {/* Tactical grid overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              backgroundImage:
                "linear-gradient(rgba(0,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.025) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />

          {/* Hero visual tuner panel (admin dev tool) */}
          {canAdmin && heroVisualOpen && !heroMode && (
            <HeroVisualTuner
              values={heroVisual}
              onChange={setHeroVisual}
              onCopy={() => {
                const out = { ship: { id: ship.id, name: ship.name }, heroVisual };
                navigator.clipboard.writeText(JSON.stringify(out, null, 2)).then(() => {
                  setHeroVisualCopied(true);
                  setTimeout(() => setHeroVisualCopied(false), 2000);
                });
              }}
              copied={heroVisualCopied}
            />
          )}

          {/* Ship identity */}
          <div style={{ position: "absolute", bottom: "28px", left: "32px", zIndex: 20 }}>
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <span
                style={{
                  ...mono,
                  fontSize: "9px",
                  fontWeight: 800,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  padding: "3px 10px",
                  color: "#fff",
                  background: classColor,
                  boxShadow: `0 0 12px ${classColor}`,
                }}
              >
                {ship.class} Class
              </span>
              <span
                style={{
                  ...mono,
                  fontSize: "9px",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  padding: "3px 10px",
                  color: "rgba(180,200,220,0.6)",
                  background: "rgba(0,0,0,0.5)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                ID: {ship.id.slice(0, 6).toUpperCase()}
              </span>
            </div>
            <h1
              style={{
                ...raj,
                fontSize: "clamp(42px, 6vw, 72px)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "-0.02em",
                lineHeight: 1,
                color: "#ffffff",
                margin: 0,
                textShadow: "0 4px 20px rgba(0,0,0,0.9)",
              }}
            >
              {ship.name}
            </h1>
          </div>

          {/* 3D Ship renderer — overlaid on hero area */}
          <ShipRenderer
            modelId={ship.modelId}
            shipDef={ship._shipDef}
            heroMode={heroMode}
            onRendererReady={(r) => { rendererRef.current = r; }}
          />

          {/* Hero mode overlay controls */}
          {heroMode && !heroDraftUrl && (
            <div className="hero-mode-overlay">
              <div className="hero-mode-header">
                <RotateCcw size={14} />
                <span>DRAG TO ROTATE SHIP</span>
                {/* Light tuner toggle */}
                {canAdmin && (
                  <button
                    className={`hero-mode-light-btn ${lightOpen ? "active" : ""}`}
                    onClick={() => setLightOpen(!lightOpen)}
                  >
                    <Sun size={12} /> Lights
                  </button>
                )}
                <button className="hero-mode-cancel" onClick={exitHeroMode}>
                  <X size={12} /> Cancel
                </button>
              </div>

              {/* Light tuner panel */}
              {lightOpen && (
                <LightTuner
                  rendererRef={rendererRef}
                  onCopy={handleCopyLightConfig}
                  copied={lightCopied}
                />
              )}

              <div className="hero-mode-controls">
                <textarea
                  className="hero-mode-textarea"
                  placeholder="Describe the hero scene... e.g. 'emerging from a glowing nebula, dramatic blue rim lighting, asteroid debris field'"
                  value={heroDescription}
                  onChange={(e) => setHeroDescription(e.target.value)}
                  rows={3}
                  maxLength={500}
                  disabled={heroLoading}
                />
                <button
                  className="hero-mode-generate"
                  onClick={handleGenerateHeroDraft}
                  disabled={heroLoading || !heroDescription.trim()}
                >
                  {heroLoading ? (
                    <><Loader size={14} className="spin-icon" /> Generating...</>
                  ) : (
                    <><Camera size={14} /> Generate Draft</>
                  )}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Hero draft preview — approve or reject (covers entire modal) */}
        {heroMode && heroDraftUrl && (
          <div className="hero-draft-overlay">
            <img
              src={heroDraftUrl}
              alt="Hero draft preview"
              className="hero-draft-image"
            />
            <div className="hero-draft-actions">
              <span className="hero-draft-label">PREVIEW — Apply this hero image?</span>
              <button className="hero-draft-approve" onClick={handleApproveHero}>
                <Check size={14} /> Approve
              </button>
              <button className="hero-draft-reject" onClick={handleRejectHero}>
                <ThumbsDown size={14} /> Retry
              </button>
              <button className="hero-mode-cancel" onClick={exitHeroMode}>
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        )}

        {/* Bottom: lore + specs */}
        <div className="hangar-detail-bottom">
          {/* Left: database entry */}
          <div className="hangar-detail-lore">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                paddingBottom: "10px",
                borderBottom: "1px solid rgba(255,255,255,0.055)",
              }}
            >
              <Scan size={13} style={{ color: "rgba(0,200,255,0.5)" }} />
              <span style={sectionLabel}>Database Entry</span>
              {ship.creator && (
                <span
                  style={{
                    ...mono,
                    fontSize: "10px",
                    color: "rgba(200,216,232,0.35)",
                    marginLeft: "auto",
                    letterSpacing: "0.06em",
                  }}
                >
                  {ship.creator}
                </span>
              )}
            </div>

            <p
              style={{
                ...mono,
                fontSize: "15px",
                lineHeight: 1.7,
                color: "rgba(200,216,232,0.7)",
                margin: "16px 0 0",
              }}
            >
              {currentLore}
            </p>

            {/* Admin: Regenerate Lore */}
            {canAdmin && (
              <div className="admin-lore-section">
                {!loreOpen ? (
                  <button
                    className="admin-action-btn"
                    onClick={() => setLoreOpen(true)}
                  >
                    <RefreshCw size={11} /> Regenerate Lore
                  </button>
                ) : (
                  <div className="admin-lore-form">
                    <textarea
                      className="admin-lore-textarea"
                      placeholder="Instructions for Grok... e.g. 'make it more mysterious, mention stealth capabilities'"
                      value={lorePrompt}
                      onChange={(e) => setLorePrompt(e.target.value)}
                      rows={2}
                      maxLength={300}
                      disabled={loreLoading}
                    />
                    <div className="admin-lore-actions">
                      <button
                        className="admin-action-btn"
                        onClick={() => { setLoreOpen(false); setLorePrompt(""); }}
                        disabled={loreLoading}
                      >
                        Cancel
                      </button>
                      <button
                        className="admin-action-btn admin-action-primary"
                        onClick={handleRegenerateLore}
                        disabled={loreLoading || !lorePrompt.trim()}
                      >
                        {loreLoading ? (
                          <><Loader size={11} className="spin-icon" /> Generating...</>
                        ) : (
                          <><RefreshCw size={11} /> Regenerate</>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: specs + CTA */}
          <div className="hangar-detail-specs">
            <div className="hangar-detail-specs-scroll">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  paddingBottom: "10px",
                  borderBottom: "1px solid rgba(255,255,255,0.055)",
                }}
              >
                <Activity size={13} style={{ color: "rgba(0,200,255,0.5)" }} />
                <span style={sectionLabel}>Technical Specs</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                <SpecRow Icon={Box} label="Cargo" value={`${ship.cargoSpace} m3`} bar={ship.cargoSpace / 30000} />
                <SpecRow Icon={Cpu} label="Drone Bay" value={`${ship.droneBay} m3`} bar={ship.droneBay / 200} />
                <SpecRow Icon={Zap} label="Turrets" value={`${ship.hardpoints.turret}`} bar={ship.hardpoints.turret / 8} />
                <SpecRow Icon={Crosshair} label="Launchers" value={`${ship.hardpoints.launcher}`} bar={ship.hardpoints.launcher / 8} />
                <SpecRow Icon={Shield} label="Defense" value="A-Class" />
                <SpecRow Icon={Activity} label="Sig. Radius" value="125 m" />
              </div>
            </div>

            {/* CTA footer */}
            <div className="hangar-detail-cta">
              <HangarButton
                variant="primary"
                size="lg"
                style={{ width: "100%", height: "48px", fontSize: "13px", letterSpacing: "0.16em" }}
                onClick={() => onFly(ship)}
              >
                {context === "hangar" ? (
                  <>
                    <LogOut size={16} />
                    Undock Ship
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    Fly This Ship
                  </>
                )}
              </HangarButton>

              {/* Admin actions */}
              {canAdmin && (
                <div className="admin-cta-group">
                  <button
                    className="admin-action-btn admin-action-hero"
                    onClick={enterHeroMode}
                    disabled={heroMode}
                  >
                    <Image size={12} /> Regenerate Hero
                  </button>

                  {onDelete && (
                    <button
                      className="admin-action-btn admin-action-danger"
                      onClick={() => onDelete(ship.id)}
                    >
                      <Trash2 size={12} /> Delete Ship
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Light Tuner — admin dev tool for tweaking the 3D lighting rig ─── */

const LIGHT_SLIDERS: Array<{ key: keyof DetailLightConfig; label: string; min: number; max: number; step: number }> = [
  { key: "exposure", label: "Exposure", min: 0.2, max: 3, step: 0.05 },
  { key: "ambientIntensity", label: "Ambient", min: 0, max: 2, step: 0.05 },
  { key: "keyIntensity", label: "Key Int.", min: 0, max: 5, step: 0.1 },
  { key: "keyX", label: "Key X", min: -10, max: 10, step: 0.5 },
  { key: "keyY", label: "Key Y", min: -10, max: 10, step: 0.5 },
  { key: "keyZ", label: "Key Z", min: -10, max: 10, step: 0.5 },
  { key: "fillIntensity", label: "Fill Int.", min: 0, max: 3, step: 0.05 },
  { key: "fillX", label: "Fill X", min: -10, max: 10, step: 0.5 },
  { key: "fillY", label: "Fill Y", min: -10, max: 10, step: 0.5 },
  { key: "fillZ", label: "Fill Z", min: -10, max: 10, step: 0.5 },
  { key: "rimIntensity", label: "Rim Int.", min: 0, max: 3, step: 0.05 },
  { key: "rimX", label: "Rim X", min: -10, max: 10, step: 0.5 },
  { key: "rimY", label: "Rim Y", min: -10, max: 10, step: 0.5 },
  { key: "rimZ", label: "Rim Z", min: -10, max: 10, step: 0.5 },
  { key: "fov", label: "FOV", min: 10, max: 80, step: 1 },
];

const MATERIAL_SLIDERS: Array<{ key: keyof DetailMaterialConfig; label: string; min: number; max: number; step: number }> = [
  { key: "metalness", label: "Metal", min: 0, max: 1, step: 0.01 },
  { key: "roughness", label: "Rough", min: 0, max: 1, step: 0.01 },
  { key: "emissiveIntensity", label: "Emis. Int.", min: 0, max: 3, step: 0.05 },
  { key: "emissiveR", label: "Emis. R", min: 0, max: 255, step: 1 },
  { key: "emissiveG", label: "Emis. G", min: 0, max: 255, step: 1 },
  { key: "emissiveB", label: "Emis. B", min: 0, max: 255, step: 1 },
];

/* ─── Hero Visual Tuner ─── */

type HeroVisualValues = {
  imgOpacity: number;
  bloomOpacity: number;
  bloomBlur: number;
  bottomGradR: number; bottomGradG: number; bottomGradB: number;
  bottomGradOpacity: number;
  bottomGradMidOpacity: number;
  sideGradOpacity: number;
};

const HERO_VISUAL_SLIDERS: Array<{ key: keyof HeroVisualValues; label: string; min: number; max: number; step: number }> = [
  { key: "imgOpacity",          label: "Img Opacity",  min: 0,   max: 1,   step: 0.01 },
  { key: "bloomOpacity",        label: "Bloom",        min: 0,   max: 0.8, step: 0.01 },
  { key: "bloomBlur",           label: "Bloom Blur",   min: 4,   max: 80,  step: 1 },
  { key: "bottomGradR",         label: "Bot. R",       min: 0,   max: 255, step: 1 },
  { key: "bottomGradG",         label: "Bot. G",       min: 0,   max: 255, step: 1 },
  { key: "bottomGradB",         label: "Bot. B",       min: 0,   max: 255, step: 1 },
  { key: "bottomGradOpacity",   label: "Bot. Opacity", min: 0,   max: 1,   step: 0.01 },
  { key: "bottomGradMidOpacity",label: "Bot. Mid Op.", min: 0,   max: 1,   step: 0.01 },
  { key: "sideGradOpacity",     label: "Side Grad.",   min: 0,   max: 1,   step: 0.01 },
];

function HeroVisualTuner({
  values,
  onChange,
  onCopy,
  copied,
}: {
  values: HeroVisualValues;
  onChange: (v: HeroVisualValues) => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const tintPreview = `rgb(${values.bottomGradR},${values.bottomGradG},${values.bottomGradB})`;
  return (
    <div className="light-tuner" style={{ top: "48px", left: "12px", right: "auto" }}>
      <div className="light-tuner-header">
        <Sun size={11} />
        <span>HERO VISUAL</span>
        <div
          style={{ width: 14, height: 14, borderRadius: 2, background: tintPreview, border: "1px solid rgba(255,255,255,0.15)" }}
          title="Bottom gradient tint"
        />
        <button className="light-tuner-copy" onClick={onCopy}>
          {copied ? <><Check size={10} /> Copied</> : <><Clipboard size={10} /> Copy</>}
        </button>
      </div>
      <div className="light-tuner-grid">
        {HERO_VISUAL_SLIDERS.map(({ key, label, min, max, step }) => (
          <label key={key} className="light-tuner-row">
            <span className="light-tuner-label">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={values[key]}
              onChange={(e) => onChange({ ...values, [key]: parseFloat(e.target.value) })}
              className="light-tuner-slider"
            />
            <span className="light-tuner-value">
              {step >= 1 ? Math.round(values[key]) : values[key].toFixed(2)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ─── 3D Light Tuner (admin dev tool for tweaking the 3D lighting rig) ─── */

function LightTuner({
  rendererRef,
  onCopy,
  copied,
}: {
  rendererRef: React.RefObject<ShipDetailRenderer | null>;
  onCopy: () => void;
  copied: boolean;
}) {
  const [values, setValues] = useState<DetailLightConfig>(() => {
    return rendererRef.current?.getLightConfig() ?? {} as DetailLightConfig;
  });
  const [matValues, setMatValues] = useState<DetailMaterialConfig>(() => {
    return rendererRef.current?.getMaterialConfig() ?? {} as DetailMaterialConfig;
  });

  const handleChange = useCallback((key: keyof DetailLightConfig, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    rendererRef.current?.setLightConfig({ [key]: val });
  }, [rendererRef]);

  const handleMatChange = useCallback((key: keyof DetailMaterialConfig, val: number) => {
    setMatValues((prev) => ({ ...prev, [key]: val }));
    rendererRef.current?.setMaterialConfig({ [key]: val });
  }, [rendererRef]);

  return (
    <div className="light-tuner">
      <div className="light-tuner-header">
        <Sun size={11} />
        <span>LIGHT + MATERIAL</span>
        <button className="light-tuner-copy" onClick={onCopy}>
          {copied ? <><Check size={10} /> Copied</> : <><Clipboard size={10} /> Copy</>}
        </button>
      </div>
      <div className="light-tuner-grid">
        {LIGHT_SLIDERS.map(({ key, label, min, max, step }) => (
          <label key={key} className="light-tuner-row">
            <span className="light-tuner-label">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={values[key] ?? 0}
              onChange={(e) => handleChange(key, parseFloat(e.target.value))}
              className="light-tuner-slider"
            />
            <span className="light-tuner-value">{(values[key] ?? 0).toFixed(2)}</span>
          </label>
        ))}
      </div>
      <div className="light-tuner-header" style={{ borderTop: "1px solid rgba(240,180,41,0.1)" }}>
        <Box size={11} />
        <span>MATERIAL</span>
      </div>
      <div className="light-tuner-grid">
        {MATERIAL_SLIDERS.map(({ key, label, min, max, step }) => (
          <label key={key} className="light-tuner-row">
            <span className="light-tuner-label">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={matValues[key] ?? 0}
              onChange={(e) => handleMatChange(key, parseFloat(e.target.value))}
              className="light-tuner-slider"
            />
            <span className="light-tuner-value">{step >= 1 ? (matValues[key] ?? 0).toFixed(0) : (matValues[key] ?? 0).toFixed(2)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ─── 3D Ship Renderer (delegates to engine class) ─── */

function ShipRenderer({
  modelId,
  shipDef,
  heroMode,
  onRendererReady,
}: {
  modelId: string;
  shipDef: import("@/engine/ShipCatalog").ShipDef;
  heroMode: boolean;
  onRendererReady: (r: ShipDetailRenderer) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ShipDetailRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new ShipDetailRenderer(canvas, modelId, shipDef);
    rendererRef.current = renderer;
    onRendererReady(renderer);
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [modelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update pose mode + camera framing when heroMode changes
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setPaused(heroMode);
    r.setInteractive(heroMode);
    r.setHeroMode(heroMode);
  }, [heroMode]);

  // Resize renderer when canvas display size changes (hero mode toggle, window resize)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver(() => {
      const r = rendererRef.current;
      if (!r) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const dpr = Math.min(window.devicePixelRatio, 2);
        r.resize(Math.round(rect.width * dpr), Math.round(rect.height * dpr));
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={`ship-detail-canvas-wrap${heroMode ? " ship-detail-canvas-wrap-hero" : ""}`}>
      <canvas
        ref={canvasRef}
        width={420}
        height={340}
        className={`ship-detail-canvas${heroMode ? " ship-detail-canvas-hero" : ""}`}
      />
    </div>
  );
}

/* ─── Spec Row sub-component ─── */

function SpecRow({
  Icon,
  label,
  value,
  bar,
}: {
  Icon: React.ElementType;
  label: string;
  value: string;
  bar?: number;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Icon size={12} style={{ color: "rgba(0,200,255,0.4)" }} />
          <span
            style={{
              fontFamily: '"Share Tech Mono", monospace',
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "rgba(180,200,220,0.45)",
            }}
          >
            {label}
          </span>
        </div>
        <span
          style={{
            fontFamily: '"Share Tech Mono", monospace',
            fontSize: "11px",
            color: "rgba(220,235,250,0.85)",
          }}
        >
          {value}
        </span>
      </div>
      {bar !== undefined && (
        <div style={{ height: "2px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${bar * 100}%` }}
            transition={{ duration: 0.8, delay: 0.1 }}
            style={{ height: "100%", background: "rgba(0,200,255,0.5)" }}
          />
        </div>
      )}
    </div>
  );
}
