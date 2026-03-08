/**
 * ForgeCreatePanel — AI ship commission flow.
 * Flow: mode select → (AI: describe → concept → build → done | Upload: drop .glb)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Wand2, Upload } from "lucide-react";
import type { ShipDef } from "@/engine/ShipCatalog";
import { buildShipDef, type CommunityShipMeta, type HangarShip } from "./hangarTypes";
import "./ForgeCreatePanel.css";

interface ForgeCreatePanelProps {
  forgeApiUrl: string;
  forgeApiKey?: string;
  nickname: string;
  ships?: HangarShip[];
  onShipCreated: (shipId: string, def: ShipDef) => void;
  onCatalogRefresh: () => void;
}

type ForgeMode = "ai" | "upload";
type Step = "idle" | "upload" | "concept_loading" | "blueprint_review" | "render_loading" | "concept_review" | "building_3d" | "complete" | "failed";

/* ─── Hero banner — random ship with a real hero render ─── */

interface ForgeHeroImageProps {
  ships?: HangarShip[];
  title: string;
  subtitle: string;
  compact?: boolean;
  whiteTitle?: boolean;
}

function ForgeHeroImage({ ships, title, subtitle, compact, whiteTitle }: ForgeHeroImageProps) {
  // Pick once on mount: prefer ships with actual hero renders
  const withHero = (ships ?? []).filter((s) => !!s.imageUrl);
  const picked = withHero.length > 0 ? withHero[Math.floor(Math.random() * withHero.length)] : null;
  const heroUrlRef = useRef<string | null>(picked?.imageUrl ?? null);
  const heroUrl = heroUrlRef.current;

  return (
    <div className={`forge-hero${compact ? " forge-hero--compact" : ""}`}>
      {heroUrl ? (
        <img src={heroUrl} alt="" className="forge-hero-img" draggable={false} />
      ) : (
        <div className="forge-hero-fallback" />
      )}
      <div className="forge-hero-scanlines" />
      <div className="forge-hero-overlay">
        <div className={`forge-hero-title${whiteTitle ? " forge-hero-title--white" : ""}`}>{title}</div>
        <div className="forge-hero-sub">{subtitle}</div>
      </div>
    </div>
  );
}

/** Maps the current mode + step to hero banner title/subtitle */
function getHeroContent(
  mode: ForgeMode | null,
  step: Step,
  completedShipName?: string,
): { title: string; subtitle: string; compact: boolean; whiteTitle: boolean } {
  if (mode === null) {
    return { title: "Commission a New Vessel", subtitle: "SELECT COMMISSION TYPE", compact: false, whiteTitle: false };
  }
  const modeName = mode === "ai" ? "AI COMMISSION" : "3D ARTIST";
  switch (step) {
    case "idle":             return { title: "Describe Your Vessel",     subtitle: modeName,                compact: true, whiteTitle: true };
    case "upload":           return { title: "Submit Your Model",        subtitle: modeName,                compact: true, whiteTitle: true };
    case "concept_loading":  return { title: "Generating Blueprint",     subtitle: modeName,                compact: true, whiteTitle: true };
    case "blueprint_review": return { title: "Blueprint Ready",          subtitle: "SELECT COLORS & APPLY", compact: true, whiteTitle: true };
    case "render_loading":   return { title: "Rendering Ship",           subtitle: modeName,                compact: true, whiteTitle: true };
    case "concept_review":   return { title: "Render Preview",           subtitle: "APPROVE OR REPAINT",    compact: true, whiteTitle: true };
    case "building_3d":      return { title: "Building 3D Model",        subtitle: modeName,                compact: true, whiteTitle: true };
    case "complete":         return { title: completedShipName ?? "Commission Complete", subtitle: "READY TO FLY", compact: true, whiteTitle: true };
    case "failed":           return { title: "Generation Failed",        subtitle: modeName,                compact: true, whiteTitle: true };
    default:                 return { title: "Commission a New Vessel",  subtitle: modeName,                compact: true, whiteTitle: true };
  }
}

export function ForgeCreatePanel({ forgeApiUrl, forgeApiKey, nickname, ships, onShipCreated, onCatalogRefresh }: ForgeCreatePanelProps) {
  /* ─── Mode selection ─── */
  const [selectedMode, setSelectedMode] = useState<ForgeMode | null>(null);
  const [fading, setFading] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ─── Flow state ─── */
  const [step, setStep] = useState<Step>("idle");
  const [prompt, setPrompt] = useState("");
  const [shipName, setShipName] = useState("");
  const [shipClass, setShipClass] = useState("");
  const [primaryColor, setPrimaryColor] = useState("Dark Grey");
  const [secondaryColor, setSecondaryColor] = useState("White");
  const [autoCompleteLore, setAutoCompleteLore] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [blueprintUrl, setBlueprintUrl] = useState<string | null>(null);
  const [conceptUrl, setConceptUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [completedShip, setCompletedShip] = useState<CommunityShipMeta | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [bonusInfoOpen, setBonusInfoOpen] = useState(false);

  const authHeaders = useRef<Record<string, string>>(
    forgeApiKey ? { Authorization: `Bearer ${forgeApiKey}` } : {},
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ─── Mode selection — fade out selection page, then reveal form ─── */

  const handleSelectMode = useCallback((mode: ForgeMode) => {
    // If already in this mode, do nothing
    if (selectedMode === mode) return;
    // If switching modes (already selected), just swap immediately
    if (selectedMode !== null) {
      setSelectedMode(mode);
      setStep(mode === "ai" ? "idle" : "upload");
      setError(null);
      return;
    }
    // First selection — fade out the big cards, then show form
    setFading(true);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setSelectedMode(mode);
      setStep(mode === "ai" ? "idle" : "upload");
      setError(null);
      setFading(false);
    }, 300);
  }, [selectedMode]);

  useEffect(() => () => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
  }, []);

  useEffect(() => {
    authHeaders.current = forgeApiKey ? { Authorization: `Bearer ${forgeApiKey}` } : {};
  }, [forgeApiKey]);

  /* ─── Step 1: Generate Concept ─── */

  const handleGenerateConcept = useCallback(async () => {
    if (!prompt.trim()) return;
    setStep("concept_loading");
    setError(null);

    // ── Pre-step: Grok lore processing (moderation + optional auto-complete) ──
    let finalName = "";
    let finalLore = autoCompleteLore ? "" : shipName.trim();

    try {
      const loreRes = await fetch(`${forgeApiUrl}/process-lore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: prompt.trim(),
          lore: autoCompleteLore ? "" : shipName.trim(),
          autoComplete: autoCompleteLore,
          shipClass: shipClass || undefined,
        }),
      });

      if (loreRes.ok) {
        const loreData = (await loreRes.json()) as {
          name?: string;
          lore?: string;
          blocked?: boolean;
        };

        if (loreData.blocked) {
          setError("Your description was flagged as inappropriate. Please revise and try again.");
          setStep("idle");
          return;
        }

        finalName = loreData.name?.trim() ?? "";
        finalLore = loreData.lore?.trim() ?? finalLore;

        // Update the lore textarea if auto-complete generated content
        if (autoCompleteLore && loreData.lore) {
          setShipName(loreData.lore);
        }
      }
    } catch {
      // Fail open — lore processing is best-effort
    }

    // ── Main step: Generate concept image ──
    try {
      const res = await fetch(`${forgeApiUrl}/generate-concept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders.current },
        body: JSON.stringify({
          prompt: prompt.trim(),
          nickname,
          shipName: finalName || undefined,
          lore: finalLore || undefined,
          shipClass: shipClass || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to generate blueprint");
        setStep("idle");
        return;
      }

      setJobId(data.jobId);
      setBlueprintUrl(data.blueprintUrl ?? null);
      if (data.shipName && !finalName) setShipName(data.shipName);
      setStep("blueprint_review");
    } catch {
      setError("Network error — try again");
      setStep("idle");
    }
  }, [prompt, shipName, shipClass, autoCompleteLore, nickname, forgeApiUrl]);

  /* ─── Step 1b: Generate Colored Render ─── */

  const handleGenerateRender = useCallback(async () => {
    if (!jobId) return;
    setStep("render_loading");
    setError(null);

    try {
      const res = await fetch(`${forgeApiUrl}/generate-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders.current },
        body: JSON.stringify({ jobId, primaryColor, secondaryColor }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to generate colored render");
        setStep("blueprint_review");
        return;
      }

      setConceptUrl(data.conceptUrl);
      setStep("concept_review");
    } catch {
      setError("Network error — try again");
      setStep("blueprint_review");
    }
  }, [jobId, primaryColor, secondaryColor, forgeApiUrl]);

  /* ─── Step 2: Approve & Build 3D ─── */

  const startPolling = useCallback(
    (jId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);

      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${forgeApiUrl}/status/${jId}`);
          if (!res.ok) return;
          const data = await res.json();

          setProgress(data.progress ?? 0);

          if (data.status === "succeeded" && data.ship) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
            setCompletedShip(data.ship);
            setStep("complete");
            onCatalogRefresh();
          } else if (data.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
            setError(data.error ?? "3D generation failed");
            setStep("failed");
          }
        } catch {
          // Transient — keep polling
        }
      }, 5000);
    },
    [forgeApiUrl, onCatalogRefresh],
  );

  const handleApproveAndBuild = useCallback(async () => {
    if (!jobId) return;
    setStep("building_3d");
    setProgress(0);
    setError(null);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    try {
      const res = await fetch(`${forgeApiUrl}/generate-3d`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders.current },
        body: JSON.stringify({ jobId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to start 3D generation");
        setStep("concept_review");
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      startPolling(jobId);
    } catch {
      setError("Network error — try again");
      setStep("concept_review");
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [jobId, forgeApiUrl, startPolling]);

  /* ─── Reset ─── */

  // From blueprint_review or failed: restart from scratch
  const handleTryAgain = useCallback(() => {
    setStep("idle");
    setBlueprintUrl(null);
    setConceptUrl(null);
    setJobId(null);
    setError(null);
    setProgress(0);
    setElapsed(0);
  }, []);

  // From concept_review: go back to blueprint to repaint with different colors
  const handleRepaint = useCallback(() => {
    setConceptUrl(null);
    setError(null);
    setStep("blueprint_review");
  }, []);

  const handleForgeAnother = useCallback(() => {
    setSelectedMode(null);
    setStep("idle");
    setPrompt("");
    setShipName("");
    setShipClass("");
    setPrimaryColor("Dark Grey");
    setSecondaryColor("White");
    setAutoCompleteLore(false);
    setBlueprintUrl(null);
    setConceptUrl(null);
    setJobId(null);
    setError(null);
    setCompletedShip(null);
    setProgress(0);
    setElapsed(0);
    setUploadFile(null);
    setBonusInfoOpen(false);
    if (pollRef.current) clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  /* ─── Fly completed ship ─── */

  const handleFlyShip = useCallback(
    (ship: CommunityShipMeta) => {
      onShipCreated(ship.id, buildShipDef(ship));
    },
    [onShipCreated],
  );

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const modeSelected = selectedMode !== null;

  return (
    <div className="forge-create-view">

      {/* ─── Hero banner — dynamic title/subtitle based on current phase ─── */}
      {(() => {
        const h = getHeroContent(selectedMode, step, completedShip?.name);
        return <ForgeHeroImage ships={ships} title={h.title} subtitle={h.subtitle} compact={h.compact} whiteTitle={h.whiteTitle} />;
      })()}

      {/* ══════════════════════════════════════════
          PHASE 1 — Big centered selection cards
          Shown until a mode is chosen; fades out on click
         ══════════════════════════════════════════ */}
      {!modeSelected && (
        <div className={`forge-select-section${fading ? " forge-select-section--out" : ""}`}>
          <div className="forge-select-label">Choose your creative mode</div>
          <div className="forge-select-cards">

            {/* AI Commission */}
            <div
              className="forge-select-card"
              role="button"
              tabIndex={0}
              onClick={() => handleSelectMode("ai")}
              onKeyDown={(e) => e.key === "Enter" && handleSelectMode("ai")}
            >
              <span className="forge-select-card-icon"><Wand2 size={36} /></span>
              <div className="forge-select-card-title">AI COMMISSION</div>
              <div className="forge-select-card-sub">
                Describe your vision and let AI generate concept art and a full 3D model ready for your fleet.
              </div>
              <div className="forge-select-card-cta">DESCRIBE YOUR VESSEL →</div>
            </div>

            {/* 3D Artist */}
            <div
              className="forge-select-card"
              role="button"
              tabIndex={0}
              onClick={() => handleSelectMode("upload")}
              onKeyDown={(e) => e.key === "Enter" && handleSelectMode("upload")}
            >
              <span className="forge-select-card-icon"><Upload size={36} /></span>
              <div className="forge-select-card-title">3D ARTIST</div>
              <div className="forge-select-card-sub">
                You have a finished 3D model. Submit your own .glb file and bring your design into the galaxy.
              </div>
              <div
                className="forge-unique-bonus-wrapper"
                onMouseEnter={() => setBonusInfoOpen(true)}
                onMouseLeave={() => setBonusInfoOpen(false)}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="forge-unique-bonus-badge">UNIQUE BONUS</span>
                <span className="forge-unique-bonus-info-btn" aria-hidden="true">i</span>
                {bonusInfoOpen && (
                  <div className="forge-unique-bonus-tooltip">
                    Human-created models carry a unique gameplay bonus in the fleet.
                    Creators can also make their ships tradable in the economy,
                    yielding passive income for their character.
                  </div>
                )}
              </div>
              <div className="forge-select-card-cta">UPLOAD YOUR MODEL →</div>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          PHASE 2 — Small mode nav chips (top right)
          Appears after selection; click to switch mode
         ══════════════════════════════════════════ */}
      {modeSelected && (
        <div className="forge-mode-nav">
          <div
            className={`forge-mode-chip${selectedMode === "ai" ? " forge-mode-chip--active" : " forge-mode-chip--dimmed"}`}
            role="button"
            tabIndex={0}
            onClick={() => handleSelectMode("ai")}
            onKeyDown={(e) => e.key === "Enter" && handleSelectMode("ai")}
          >
            <span className="forge-mode-chip-icon"><Wand2 size={14} /></span>
            <span className="forge-mode-chip-label">AI COMMISSION</span>
          </div>
          <div
            className={`forge-mode-chip${selectedMode === "upload" ? " forge-mode-chip--active" : " forge-mode-chip--dimmed"}`}
            role="button"
            tabIndex={0}
            onClick={() => handleSelectMode("upload")}
            onKeyDown={(e) => e.key === "Enter" && handleSelectMode("upload")}
          >
            <span className="forge-mode-chip-icon"><Upload size={14} /></span>
            <span className="forge-mode-chip-label">3D ARTIST</span>
          </div>
        </div>
      )}

      {/* ─── Form content — fades in after mode chosen ─── */}
      {modeSelected && (
        <div className="forge-create-inner forge-create-inner--anim">
          {error && <div className="forge-error">{error}</div>}

          {/* AI COMMISSION — describe form */}
          {selectedMode === "ai" && step === "idle" && (
            <>
              <div className="forge-input-group">
                <label className="forge-input-label">SHIP DESCRIPTION</label>
                <textarea
                  className="forge-input forge-textarea"
                  placeholder="Spaceship freighter, three rear engines. Single 3D view. Reinforced armor plates on engine nacelles and bridge only. Elongated rectangular hull with loading ramp bay..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, 200))}
                  maxLength={200}
                />
                <div className="forge-char-count">{prompt.length}/200</div>
              </div>

              <div className="forge-input-group">
                <label className="forge-input-label">SHIP CLASS</label>
                <select
                  className="forge-input forge-select"
                  value={shipClass}
                  onChange={(e) => setShipClass(e.target.value)}
                >
                  <option value="">— Select a class —</option>
                  {["INTERCEPTOR","FIGHTER","ASSAULT","FRIGATE","CAPITAL","RAIDER",
                    "COURIER","UTILITY","RECON","PATROL","EXPLORER","FREIGHTER",
                    "PROTOTYPE","EXPERIMENTAL","CUSTOM"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div className="forge-input-group">
                <div className="forge-label-row">
                  <label className="forge-input-label">SHIP NAME &amp; LORE</label>
                  <label className="forge-checkbox-label">
                    <input
                      type="checkbox"
                      className="forge-checkbox"
                      checked={autoCompleteLore}
                      onChange={(e) => setAutoCompleteLore(e.target.checked)}
                    />
                    AI AUTO-COMPLETE
                  </label>
                </div>
                <textarea
                  className="forge-input forge-textarea forge-lore-textarea"
                  placeholder={
                    autoCompleteLore
                      ? "AI will generate the name and lore from your description above..."
                      : "The ISS Nebula Fang was created in the depths of the Kerrigan Nebula by a rogue engineer collective that..."
                  }
                  value={shipName}
                  onChange={(e) => setShipName(e.target.value.slice(0, 400))}
                  maxLength={400}
                  disabled={autoCompleteLore}
                />
                {!autoCompleteLore && (
                  <div className="forge-char-count">{shipName.length}/400</div>
                )}
              </div>

              <button
                className="forge-btn-primary"
                disabled={!prompt.trim()}
                onClick={handleGenerateConcept}
              >
                GENERATE CONCEPT
              </button>

              {!!forgeApiKey && <div className="forge-admin-badge">ADMIN</div>}
            </>
          )}

          {/* 3D ARTIST — upload form */}
          {selectedMode === "upload" && step === "upload" && (
            <>
              <label className="forge-upload-drop" htmlFor="forge-file-upload">
                <div className="forge-upload-drop-icon"><Upload size={28} /></div>
                <div className="forge-upload-drop-label">DROP .GLB FILE HERE</div>
                <div className="forge-upload-drop-hint">or click to browse</div>
                <input
                  id="forge-file-upload"
                  type="file"
                  accept=".glb"
                  className="forge-upload-file-input"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </label>

              {uploadFile && (
                <div className="forge-upload-selected">✓ {uploadFile.name}</div>
              )}

              <button
                className="forge-btn-primary"
                disabled={!uploadFile}
                onClick={() => alert("Model upload pipeline coming soon.")}
              >
                SUBMIT FOR REVIEW
              </button>

              <div className="forge-upload-soon">
                Submissions are reviewed before publishing to the catalog
              </div>
            </>
          )}

          {/* BLUEPRINT LOADING */}
          {step === "concept_loading" && (
            <div className="forge-spinner">
              <div className="forge-spinner-dots">&#9679; &#9679; &#9679;</div>
              <div className="forge-spinner-text">GENERATING BLUEPRINT...</div>
            </div>
          )}

          {/* BLUEPRINT REVIEW — pick colors then generate render */}
          {step === "blueprint_review" && blueprintUrl && (
            <>
              <img className="forge-concept-img" src={blueprintUrl} alt="Ship blueprint" />
              <div className="forge-color-row">
                <div className="forge-input-group forge-color-half">
                  <label className="forge-input-label">PRIMARY COLOR</label>
                  <select
                    className="forge-input forge-select"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                  >
                    {["Dark Grey","Light Grey","Gunmetal","Dark Silver","Matte Black","White",
                      "Navy Blue","Deep Blue","Steel Blue","Dark Red","Crimson","Dark Green",
                      "Olive Drab","Sand","Tan","Bronze","Copper","Dark Purple"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="forge-input-group forge-color-half">
                  <label className="forge-input-label">SECONDARY COLOR</label>
                  <select
                    className="forge-input forge-select"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                  >
                    {["White","Yellow","Gold","Orange","Red","Crimson","Blue","Cyan","Teal",
                      "Green","Lime","Purple","Magenta","Pink","Silver","Black","Bronze","Copper"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="forge-concept-actions">
                <button className="forge-btn-secondary" onClick={handleTryAgain}>
                  RESTART
                </button>
                <button className="forge-btn-primary" onClick={handleGenerateRender}>
                  APPLY COLORS &amp; RENDER
                </button>
              </div>
            </>
          )}

          {/* RENDER LOADING */}
          {step === "render_loading" && (
            <div className="forge-spinner">
              {blueprintUrl && (
                <img
                  className="forge-concept-img"
                  src={blueprintUrl}
                  alt="Blueprint reference"
                  style={{ marginBottom: 28, opacity: 0.5 }}
                />
              )}
              <div className="forge-spinner-dots">&#9679; &#9679; &#9679;</div>
              <div className="forge-spinner-text">RENDERING SHIP...</div>
            </div>
          )}

          {/* CONCEPT REVIEW — approve colored render for 3D */}
          {step === "concept_review" && conceptUrl && (
            <>
              <img className="forge-concept-img" src={conceptUrl} alt="Ship colored render" />
              <div className="forge-concept-actions">
                <button className="forge-btn-secondary" onClick={handleRepaint}>
                  REPAINT
                </button>
                <button className="forge-btn-primary" onClick={handleApproveAndBuild}>
                  APPROVE &amp; BUILD 3D
                </button>
              </div>
            </>
          )}

          {/* BUILDING 3D */}
          {step === "building_3d" && (
            <div className="forge-progress-section">
              <div className="forge-progress-stage">BUILDING 3D MODEL</div>
              <div className="forge-progress-pct">{progress}%</div>
              <div className="forge-progress-bar-track">
                <div className="forge-progress-bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="forge-progress-elapsed">{formatElapsed(elapsed)}</div>
              <div className="forge-progress-hint">This may take 1-2 minutes</div>
              {conceptUrl && (
                <img
                  className="forge-concept-img"
                  src={conceptUrl}
                  alt="Building from concept"
                  style={{ marginTop: 24, maxHeight: 200, opacity: 0.55 }}
                />
              )}
            </div>
          )}

          {/* COMPLETE */}
          {step === "complete" && completedShip && (
            <>
              <div className="forge-step-title">{completedShip.name}</div>
              <div className="forge-complete-class">{completedShip.class}</div>
              <div className="forge-complete-lore">{completedShip.lore}</div>

              {completedShip.thumbnailUrl && (
                <img
                  className="forge-concept-img"
                  src={completedShip.thumbnailUrl}
                  alt={completedShip.name}
                  style={{ maxHeight: 220 }}
                />
              )}

              <div className="forge-stats">
                <StatBar label="SPEED" value={completedShip.stats.speed} />
                <StatBar label="ARMOR" value={completedShip.stats.armor} />
                <StatBar label="CARGO" value={completedShip.stats.cargo} />
                <StatBar label="FIREPOWER" value={completedShip.stats.firepower} />
              </div>

              <button className="forge-btn-fly" onClick={() => handleFlyShip(completedShip)}>
                FLY THIS SHIP
              </button>
              <button className="forge-btn-secondary" onClick={handleForgeAnother}>
                FORGE ANOTHER
              </button>
            </>
          )}

          {/* FAILED */}
          {step === "failed" && (
            <>
              <div className="forge-step-title">Generation Failed</div>
              <div className="forge-subtitle">SOMETHING WENT WRONG</div>
              <button className="forge-btn-secondary" onClick={handleTryAgain}>
                TRY AGAIN
              </button>
              <button className="forge-btn-secondary" onClick={handleForgeAnother}>
                START OVER
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Stat bar helper ─── */

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="forge-stat-row">
      <div className="forge-stat-label">{label}</div>
      <div className="forge-stat-bar">
        <div className="forge-stat-fill" style={{ width: `${value * 10}%` }} />
      </div>
      <div className="forge-stat-val">{value * 10}</div>
    </div>
  );
}
