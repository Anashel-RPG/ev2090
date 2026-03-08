/**
 * ShipForge — Durable Object for AI ship generation.
 *
 * Three-step pipeline:
 *   0. Grok enhances the user's raw prompt into a detailed image prompt
 *   1. Gemini generates a concept image from the enhanced prompt
 *   2. Player approves → MeshyAI converts image to 3D GLB
 *
 * Storage key patterns:
 *   job:{jobId}                        → ForgeJob (in-flight generation state)
 *   ship:{paddedTimestamp}:{shipId}     → CommunityShipMeta (completed, lexicographic sort)
 *   rate:{fingerprint}:{YYYY-MM-DD}    → number (daily count)
 */

/* ─── Interfaces ─────────────────────────────────────────── */

interface ForgeJob {
  id: string;
  status: "concept_loading" | "blueprint_ready" | "render_loading" | "concept_ready" | "building_3d" | "succeeded" | "failed";
  prompt: string;
  shipName: string;
  nickname: string;
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
  // Optional user-supplied or Grok-generated fields
  lore?: string;
  userShipClass?: string;
  // Colors chosen by the player
  primaryColor?: string;
  secondaryColor?: string;
  // Grok structural spec (intermediate)
  structuralSpec?: string;
  // Gemini blueprint (pass 1)
  blueprintUrl?: string;
  // Gemini colored render (pass 2) — this is what Meshy receives
  conceptUrl?: string;
  // MeshyAI
  meshyTaskId?: string;
  meshyProgress?: number;
  // Final results
  modelUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

interface CommunityShipMeta {
  id: string;
  name: string;
  class: string;
  prompt: string;
  creator: string;
  modelUrl: string;
  thumbnailUrl: string;
  conceptUrl: string;
  heroUrl?: string;
  stats: { speed: number; armor: number; cargo: number; firepower: number };
  lore: string;
  createdAt: number;
  // Built-in ship extras (optional — community ships don't use these)
  source?: "builtin" | "community";
  texturePath?: string;
  extraTextures?: Record<string, string>;
  modelScale?: number;
  defaultHeadingDeg?: number;
  defaultHardpoints?: Array<{ type: string; localX: number; localY: number; localZ: number; label?: string; thrustAngleDeg?: number }>;
  thrusterPos?: { x: number; y: number; z: number };
  materialConfig?: {
    metalness?: number;
    roughness?: number;
    emissiveIntensity?: number;
    emissiveR?: number;
    emissiveG?: number;
    emissiveB?: number;
  };
}

interface MeshyPollMessage {
  jobId: string;
  meshyTaskId: string;
  attempt: number;
}

interface Env {
  SHIP_MODELS: R2Bucket;
  IMAGES: ImagesBinding;     // Cloudflare Images binding (PNG→JPEG conversion)
  MESHY_QUEUE: Queue<MeshyPollMessage>;
  MESHY_API_KEY: string;
  GEMINI_API_KEY: string;
  GROK_API: string;
  FORGE_LOCKED: string;     // "true" to block public creation (catalog stays open)
  FORGE_API_KEY: string;    // secret key for admin operations (delete, lore regen, hero gen)
}

/* ─── Constants ──────────────────────────────────────────── */

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const MAX_DAILY_GENERATIONS = 100;
const MAX_PROMPT_LENGTH = 200;
const MAX_NAME_LENGTH = 30;
const MAX_NICKNAME_LENGTH = 16;
const MESHY_API_BASE = "https://api.meshy.ai/openapi/v1";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GROK_API_BASE = "https://api.x.ai/v1";
const GROK_MODEL = "grok-4-1-fast-non-reasoning";
const CDN_BASE = "https://ws.ev2090.com/api/forge/asset";
const MAX_CATALOG_SHIPS = 200;

/** Standardized studio render style — appended to every colored render call to ensure consistent quality */
const STUDIO_RENDER_STYLE = `Neutral seamless mid-grey cyclorama background (RGB 115,115,115). Soft three-point diffuse studio lighting: primary fill from upper-left, gentle rim from upper-right, weak ambient under-fill. Zero cast shadows. No environment reflections, no HDRI, no bloom. Flat even product photography illumination. Photorealistic 3D render, sharp focus, 8K detail, clean game asset presentation. Eve Online style.`;

/** Blueprint generation style — appended to Grok's structural spec for Gemini pass 1 */
const BLUEPRINT_STYLE = `Technical 3D projection blueprint. Dark navy blue background with precise white wireframe construction lines. Isometric or slight three-quarter angle showing the full ship structure. Full annotation lines with component labels. Engineering schematic style. High precision, crisp linework. Single unified view of the complete vessel.`;

/** System prompt for Grok — minimal prefix + simplify, nothing else */
const GROK_SYSTEM_PROMPT = `You are a blueprint label writer. Your only job is to take the user's ship description and output a single clean line starting with "Blueprint of a spaceship" followed by the key concept.

Rules:
- Always start with: "Blueprint of a spaceship"
- Keep only the 1–2 most important structural features (hull type, engine count, or weapon type). Drop everything else.
- Remove colors, materials, names, lore, and any non-structural detail.
- Maximum 20 words total.
- Output the single line only — no punctuation at the end, no markdown, no explanation.`;

/** Prompt template for Gemini pass 2: converting a blueprint into a colored game-asset render */
const COLORED_RENDER_TEMPLATE = `A photorealistic 3D game asset render of this spaceship based on the blueprint reference image. Primary hull color: PRIMARY_COLOR. Secondary accent panels and trim: SECONDARY_COLOR. ${STUDIO_RENDER_STYLE}`;

/** System prompt for Grok to regenerate ship lore (admin endpoint) */
const GROK_LORE_SYSTEM_PROMPT = `You are a lore writer for EV 2090, a spaceship simulation game set in 2090.
Write compelling, atmospheric ship lore in 1-3 short paragraphs (max 600 characters total).
Write in-universe as a naval intelligence database entry. Terse, evocative, functional.
No markdown, no quotes, no titles, no bullet points.
Return ONLY the lore text.`;

/**
 * Grok system prompt — AUTO-COMPLETE mode.
 * Generates ship name + lore from the user's description and removes all NSFW.
 */
const GROK_LORE_AUTOCOMPLETE_PROMPT = `You are a lore writer for EV·2090, a spaceship simulation game set in 2090.

Your tasks:
1. Invent a ship name that fits the description. Use naval vessel naming conventions (e.g. "ISS Vanguard", "ERCS Phantom Echo", "Nebula Fang"). Keep it short and memorable.
2. Write 2-3 short paragraphs of in-universe lore for this ship. Style: naval intelligence database entry — terse, evocative, functional. Max 500 characters total.
3. Remove ALL NSFW content, explicit violence glorification, sexual content, hate speech, or adult themes. If the input is entirely inappropriate, set "blocked" to true.

Respond ONLY with valid JSON — no markdown, no code fences, no explanation:
{"name":"ship name","lore":"lore text","blocked":false}`;

/**
 * Grok system prompt — MODERATION mode.
 * Proofreads user lore, extracts ship name, removes only explicitly harmful content.
 */
const GROK_LORE_MODERATE_PROMPT = `You are a content moderator and editor for EV·2090, a spaceship simulation game set in 2090.

Your tasks:
1. Lightly proofread the user's lore text: fix obvious typos and grammar, but preserve their creative voice and intent.
2. Extract the ship name from the text if one is clearly stated (e.g. if they wrote "The ISS Fang was built...", return "ISS Fang"). Return an empty string if none is found.
3. Remove ONLY explicitly sexual content, graphic gore, or targeted hate speech. Keep the user's creative storytelling intact. Light violence and dark themes are fine.
4. If the lore field is empty, return it as an empty string.
5. Set "blocked" to true ONLY if the entire submission is impossible to clean (e.g. pure hate speech).

Respond ONLY with valid JSON — no markdown, no code fences, no explanation:
{"name":"extracted ship name or empty string","lore":"cleaned lore text","blocked":false}`;

/** System prompt for Grok to enhance hero image descriptions */
const GROK_HERO_SYSTEM_PROMPT = `You are an expert prompt engineer for AI image generation.
Transform the user's description into a cinematic hero banner prompt for a spaceship.
A 3D render of the ship will be provided as visual reference — the generated image must feature a ship that looks exactly like the reference.
Focus on:
- Dramatic cinematic lighting and atmosphere
- Space environment (nebulae, stars, planetary backdrops, asteroid fields)
- Cinematic composition (rule of thirds, dynamic angle, depth of field)
- The ship as the clear focal point, occupying 40-60% of the frame
- High quality rendering terms (ultra-detailed, volumetric lighting, 8k, photorealistic)
- Eve Online / Star Citizen visual style
The output image must be a 16:9 cinematic banner suitable as a hero header.
Output ONLY the final prompt text. No markdown, no quotes, no explanations.`;

/* ─── Helpers ────────────────────────────────────────────── */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function hashFingerprint(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(ip + salt);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convert an ArrayBuffer to base64 without spreading large arrays (avoids call stack overflow) */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

const JPEG_QUALITY = 90;

/** Convert a base64-encoded image (typically PNG from Gemini) to JPEG via Cloudflare Images binding */
async function toJpeg(
  images: ImagesBinding,
  base64Data: string,
  sourceMimeType: string,
): Promise<{ bytes: Uint8Array; mimeType: string; ext: string }> {
  if (sourceMimeType.includes("jpeg") || sourceMimeType.includes("jpg")) {
    const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    return { bytes, mimeType: "image/jpeg", ext: "jpg" };
  }
  try {
    const rawBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(rawBytes); controller.close(); },
    });
    const output = await images.input(stream).output({ format: "image/jpeg", quality: JPEG_QUALITY });
    const jpegBytes = new Uint8Array(await output.response().arrayBuffer());
    return { bytes: jpegBytes, mimeType: "image/jpeg", ext: "jpg" };
  } catch (err) {
    console.warn("JPEG conversion failed, keeping original format:", err);
    const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    const ext = sourceMimeType.includes("jpeg") ? "jpg" : "png";
    return { bytes, mimeType: sourceMimeType, ext };
  }
}

/** Convert an ArrayBuffer image to JPEG via Cloudflare Images binding */
async function toJpegFromBytes(
  images: ImagesBinding,
  buffer: ArrayBuffer,
): Promise<{ bytes: Uint8Array; mimeType: string; ext: string }> {
  try {
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(buffer)); controller.close(); },
    });
    const output = await images.input(stream).output({ format: "image/jpeg", quality: JPEG_QUALITY });
    const jpegBytes = new Uint8Array(await output.response().arrayBuffer());
    return { bytes: jpegBytes, mimeType: "image/jpeg", ext: "jpg" };
  } catch (err) {
    console.warn("JPEG conversion failed, keeping original format:", err);
    return { bytes: new Uint8Array(buffer), mimeType: "image/png", ext: "png" };
  }
}

function generateStatsFromPrompt(prompt: string): CommunityShipMeta["stats"] {
  const p = prompt.toLowerCase();
  const rand = () => 5 + Math.floor(Math.random() * 3);

  const speed = /fast|swift|sleek|nimble|quick|racer|light/.test(p)
    ? 7 + Math.floor(Math.random() * 3)
    : /heavy|massive|bulky|slow|tank/.test(p)
      ? 2 + Math.floor(Math.random() * 2)
      : rand();

  const armor = /armored|tank|heavy|fortress|hull|shield|thick/.test(p)
    ? 7 + Math.floor(Math.random() * 3)
    : /light|fragile|sleek|thin/.test(p)
      ? 2 + Math.floor(Math.random() * 2)
      : rand();

  const cargo = /cargo|hauler|transport|freighter|supply/.test(p)
    ? 7 + Math.floor(Math.random() * 3)
    : /fighter|strike|small|compact/.test(p)
      ? 2 + Math.floor(Math.random() * 2)
      : rand();

  const firepower = /weapon|gun|cannon|missile|turret|attack|strike/.test(p)
    ? 7 + Math.floor(Math.random() * 3)
    : /scout|recon|peaceful|civilian/.test(p)
      ? 2 + Math.floor(Math.random() * 2)
      : rand();

  return {
    speed: Math.min(10, Math.max(1, speed)),
    armor: Math.min(10, Math.max(1, armor)),
    cargo: Math.min(10, Math.max(1, cargo)),
    firepower: Math.min(10, Math.max(1, firepower)),
  };
}

function deriveShipClass(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/fighter|strike|attack|combat/.test(p)) return "FIGHTER";
  if (/cargo|hauler|transport|freighter/.test(p)) return "FREIGHTER";
  if (/scout|recon|stealth|spy/.test(p)) return "RECON";
  if (/capital|flagship|cruiser|battleship/.test(p)) return "CAPITAL";
  if (/patrol|police|guard|escort/.test(p)) return "PATROL";
  if (/explorer|survey|science|research/.test(p)) return "EXPLORER";
  if (/raider|pirate|smuggler/.test(p)) return "RAIDER";
  const classes = ["PROTOTYPE", "EXPERIMENTAL", "CUSTOM"];
  return classes[Math.floor(Math.random() * classes.length)];
}

function generateLore(prompt: string, name: string): string {
  const trimmed = prompt.length > 80 ? prompt.slice(0, 77) + "..." : prompt;
  return `${name} — forged from the void. ${trimmed.charAt(0).toUpperCase() + trimmed.slice(1)}.`;
}

/* ─── Durable Object ─────────────────────────────────────── */

export class ShipForge implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET /config — public config for the frontend (is creation locked? are AI keys present?)
    if ((url.pathname === "/config" || url.pathname === "/config/") && request.method === "GET") {
      const locked = this.env.FORGE_LOCKED === "true";
      const aiAvailable = !!(
        this.env.MESHY_API_KEY?.trim() &&
        this.env.GEMINI_API_KEY?.trim() &&
        this.env.GROK_API?.trim()
      );
      return json({ forgeLocked: locked, aiAvailable });
    }

    // POST /process-lore — Grok moderation + optional lore auto-complete (ungated, no rate limit)
    if (url.pathname === "/process-lore" && request.method === "POST") {
      return this.handleProcessLore(request);
    }

    // POST /generate-concept — gated by FORGE_LOCKED (admin API key bypasses)
    if (url.pathname === "/generate-concept" && request.method === "POST") {
      if (this.isLocked(request)) {
        return errorResponse("Ship creation is currently locked. Browse the catalog!", 403);
      }
      return this.handleGenerateConcept(request);
    }

    // POST /generate-render — takes approved blueprint + colors → colored render (Gemini pass 2)
    if (url.pathname === "/generate-render" && request.method === "POST") {
      if (this.isLocked(request)) {
        return errorResponse("Ship creation is currently locked.", 403);
      }
      return this.handleGenerateRender(request);
    }

    // POST /generate-3d — gated by FORGE_LOCKED
    if (url.pathname === "/generate-3d" && request.method === "POST") {
      if (this.isLocked(request)) {
        return errorResponse("Ship creation is currently locked.", 403);
      }
      return this.handleGenerate3D(request);
    }

    // GET /status/:jobId
    const statusMatch = url.pathname.match(/^\/status\/([a-f0-9-]+)$/);
    if (statusMatch && request.method === "GET") {
      return this.handleGetStatus(statusMatch[1]);
    }

    // GET /catalog
    if ((url.pathname === "/catalog" || url.pathname === "/catalog/") && request.method === "GET") {
      return this.handleGetCatalog(url);
    }

    // POST /poll — called by Queue consumer to poll a MeshyAI job
    if (url.pathname === "/poll" && request.method === "POST") {
      return this.handlePollJob(request);
    }

    // DELETE /ship/:shipId — admin-only: remove a ship from catalog + R2
    const deleteMatch = url.pathname.match(/^\/ship\/([a-z0-9-]+)$/);
    if (deleteMatch && request.method === "DELETE") {
      if (!this.isAdmin(request)) {
        return errorResponse("Unauthorized", 403);
      }
      return this.handleDeleteShip(deleteMatch[1]);
    }

    // PATCH /ship/:shipId/lore — admin-only: regenerate ship lore via Grok
    const loreMatch = url.pathname.match(/^\/ship\/([a-z0-9-]+)\/lore$/);
    if (loreMatch && request.method === "PATCH") {
      if (!this.isAdmin(request)) {
        return errorResponse("Unauthorized", 403);
      }
      return this.handleRegenerateLore(loreMatch[1], request);
    }

    // PATCH /ship/:shipId/hero — admin-only: generate hero draft (not applied yet)
    const heroMatch = url.pathname.match(/^\/ship\/([a-z0-9-]+)\/hero$/);
    if (heroMatch && request.method === "PATCH") {
      if (!this.isAdmin(request)) {
        return errorResponse("Unauthorized", 403);
      }
      return this.handleRegenerateHero(heroMatch[1], request);
    }

    // GET /ship/:shipId/hero/status — admin-only: poll hero generation progress
    const heroStatusMatch = url.pathname.match(/^\/ship\/([a-z0-9-]+)\/hero\/status$/);
    if (heroStatusMatch && request.method === "GET") {
      if (!this.isAdmin(request)) {
        return errorResponse("Unauthorized", 403);
      }
      return this.handleHeroStatus(heroStatusMatch[1]);
    }

    // POST /ship/:shipId/hero/approve — admin-only: approve draft as official hero
    const heroApproveMatch = url.pathname.match(/^\/ship\/([a-z0-9-]+)\/hero\/approve$/);
    if (heroApproveMatch && request.method === "POST") {
      if (!this.isAdmin(request)) {
        return errorResponse("Unauthorized", 403);
      }
      return this.handleApproveHero(heroApproveMatch[1]);
    }

    // POST /seed-builtins — admin-only: populate DO storage with built-in ship metadata
    if (url.pathname === "/seed-builtins" && request.method === "POST") {
      if (!this.isAdmin(request)) {
        return errorResponse("Unauthorized", 403);
      }
      return this.handleSeedBuiltins(request);
    }

    // POST /admin/migrate-images — admin-only: convert existing PNGs to JPEG in R2
    if (url.pathname === "/admin/migrate-images" && request.method === "POST") {
      if (!this.isAdmin(request)) {
        return errorResponse("Unauthorized", 403);
      }
      return this.handleMigrateImages(request);
    }

    // GET /asset/* — serve R2 files (concept images, models, thumbnails)
    if (url.pathname.startsWith("/asset/") && request.method === "GET") {
      const key = url.pathname.slice("/asset/".length);
      return this.handleGetAsset(key);
    }

    return errorResponse("Not found", 404);
  }

  /**
   * POST /process-lore
   * Pre-processes user input through Grok before concept generation.
   * - autoComplete=true  → generate ship name + lore from description, remove ALL NSFW
   * - autoComplete=false → proofread lore, extract ship name, remove only explicit content
   * Rate-limited to 30 requests per IP per day to prevent Grok API quota abuse.
   */
  private async handleProcessLore(request: Request): Promise<Response> {
    // Rate limit — shared fingerprint with concept generation, separate daily bucket
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const fingerprint = await hashFingerprint(ip, this.env.FORGE_API_KEY || "fallback");
    const today = new Date().toISOString().slice(0, 10);
    const loreLimitKey = `lore:${fingerprint}:${today}`;
    const loreCount = (await this.state.storage.get<number>(loreLimitKey)) ?? 0;
    if (loreCount >= 30) {
      return errorResponse("Rate limit exceeded. Try again tomorrow.", 429);
    }
    await this.state.storage.put(loreLimitKey, loreCount + 1, { expirationTtl: 90000 });

    let body: { description?: string; lore?: string; autoComplete?: boolean; shipClass?: string };
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const description = (body.description ?? "").trim().slice(0, 500);
    const rawLore     = (body.lore ?? "").trim().slice(0, 800);
    const autoComplete = !!body.autoComplete;

    const systemPrompt = autoComplete
      ? GROK_LORE_AUTOCOMPLETE_PROMPT
      : GROK_LORE_MODERATE_PROMPT;

    const userMessage = autoComplete
      ? `Ship description: ${description}`
      : `Ship description: ${description}\n\nUser lore:\n${rawLore}`;

    try {
      const grokRes = await fetch(`${GROK_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.GROK_API}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROK_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userMessage },
          ],
          max_tokens: 600,
          temperature: autoComplete ? 0.8 : 0.3,
        }),
      });

      if (!grokRes.ok) {
        console.warn("process-lore Grok failed:", grokRes.status);
        // Fail open — return raw input so the user isn't blocked
        return json({ name: "", lore: rawLore, blocked: false });
      }

      const grokData = (await grokRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = grokData.choices?.[0]?.message?.content?.trim() ?? "";

      // Parse JSON response from Grok; strip optional code fences if present
      const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      let parsed: { name?: string; lore?: string; blocked?: boolean };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.warn("process-lore: Grok returned non-JSON, using raw lore:", raw);
        return json({ name: "", lore: rawLore, blocked: false });
      }

      if (parsed.blocked) {
        return json({ name: "", lore: "", blocked: true });
      }

      return json({
        name:    (parsed.name  ?? "").trim().slice(0, 60),
        lore:    (parsed.lore  ?? rawLore).trim().slice(0, 800),
        blocked: false,
      });
    } catch (err) {
      console.error("process-lore error:", err);
      // Fail open — don't block the user if Grok is down
      return json({ name: "", lore: rawLore, blocked: false });
    }
  }

  /** Check if forge creation is locked for public users.
   *  - FORGE_LOCKED !== "true" → open
   *  - Valid admin API key → bypass (same auth as delete/lore/hero endpoints)
   *  - Otherwise → locked (public creation blocked)
   */
  private isLocked(request: Request): boolean {
    if (this.env.FORGE_LOCKED !== "true") return false;
    // Admin API key bypasses the lock (works in both dev and production)
    if (this.isAdmin(request)) return false;
    return true;
  }

  /** Admin auth check — works in both dev and production (for admin-only endpoints like seed, lore regen, hero regen) */
  private isAdmin(request: Request): boolean {
    const auth = request.headers.get("Authorization");
    if (!auth || !this.env.FORGE_API_KEY) return false;
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    return token === this.env.FORGE_API_KEY;
  }

  /* ─── Step 1a: Generate Blueprint (Grok → Gemini pass 1) ─── */

  private async handleGenerateConcept(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as {
        prompt?: string;
        nickname?: string;
        shipName?: string;
        lore?: string;
        shipClass?: string;
      };

      const prompt = (body.prompt ?? "").trim();
      const nickname = (body.nickname ?? "Pilot").slice(0, MAX_NICKNAME_LENGTH);
      const shipName = (body.shipName ?? "").trim().slice(0, MAX_NAME_LENGTH) || this.randomShipName();
      const lore = (body.lore ?? "").trim().slice(0, 800) || undefined;
      const userShipClass = (body.shipClass ?? "").trim().toUpperCase() || undefined;

      if (!prompt) return errorResponse("Prompt required");
      if (prompt.length > MAX_PROMPT_LENGTH) return errorResponse("Prompt too long");

      // Rate limit
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const fingerprint = await hashFingerprint(ip, this.env.FORGE_API_KEY || "fallback");
      const today = new Date().toISOString().slice(0, 10);
      const rateKey = `rate:${fingerprint}:${today}`;
      const count = (await this.state.storage.get<number>(rateKey)) ?? 0;
      if (count >= MAX_DAILY_GENERATIONS) {
        return errorResponse("Rate limit exceeded. Try again later.", 429);
      }

      const jobId = crypto.randomUUID();

      // ── Pass 0: Grok → structural blueprint specification ──
      let structuralSpec: string;
      try {
        const grokRes = await fetch(`${GROK_API_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.env.GROK_API}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: GROK_MODEL,
            messages: [
              { role: "system", content: GROK_SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            max_tokens: 1500,
            temperature: 0.7,
          }),
        });

        if (grokRes.ok) {
          const grokData = (await grokRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          structuralSpec = grokData.choices?.[0]?.message?.content?.trim() || prompt;
        } else {
          console.warn("Grok blueprint API failed, using raw prompt:", grokRes.status);
          structuralSpec = prompt;
        }
      } catch (grokErr) {
        console.warn("Grok blueprint error, using raw prompt:", grokErr);
        structuralSpec = prompt;
      }

      // ── Pass 1: Gemini → blueprint schematic image ──
      const blueprintPrompt = `${structuralSpec}. ${BLUEPRINT_STYLE}`;

      const blueprintRes = await fetch(
        `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${this.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: blueprintPrompt }] }],
            generationConfig: {
              responseModalities: ["IMAGE", "TEXT"],
              imageConfig: { aspectRatio: "16:9" },
            },
          }),
        },
      );

      if (!blueprintRes.ok) {
        const errText = await blueprintRes.text();
        console.error("Gemini blueprint API error:", blueprintRes.status, errText);
        return errorResponse("Generation failed", 502);
      }

      const blueprintBase64 = this.extractGeminiImage(await blueprintRes.json());
      if (!blueprintBase64) {
        return errorResponse("Generation failed. Try a different prompt.", 502);
      }

      // Upload blueprint to R2 (convert to JPEG for smaller file size)
      const bp = await toJpeg(this.env.IMAGES, blueprintBase64.data, blueprintBase64.mimeType);
      const blueprintR2Key = `forge/${jobId}/blueprint.${bp.ext}`;
      await this.env.SHIP_MODELS.put(blueprintR2Key, bp.bytes, {
        httpMetadata: { contentType: bp.mimeType },
      });
      const blueprintUrl = `${CDN_BASE}/${blueprintR2Key}`;

      // Increment rate limit
      await this.state.storage.put(rateKey, count + 1);

      // Save job — waiting for player to pick colors and approve
      const job: ForgeJob = {
        id: jobId,
        status: "blueprint_ready",
        prompt,
        shipName,
        nickname,
        fingerprint,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        structuralSpec,
        blueprintUrl,
        ...(lore          && { lore }),
        ...(userShipClass && { userShipClass }),
      };
      await this.state.storage.put(`job:${jobId}`, job);

      return json({ jobId, blueprintUrl, shipName });
    } catch (err) {
      console.error("generate-concept error:", err);
      return errorResponse("Internal error", 500);
    }
  }

  /* ─── Step 1b: Generate Colored Render (Gemini pass 2, player-approved colors) ─── */

  private async handleGenerateRender(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as {
        jobId?: string;
        primaryColor?: string;
        secondaryColor?: string;
      };

      const jobId = body.jobId;
      if (!jobId) return errorResponse("jobId required");

      const primaryColor = (body.primaryColor ?? "Dark Grey").trim().slice(0, 30);
      const secondaryColor = (body.secondaryColor ?? "White").trim().slice(0, 30);

      const job = await this.state.storage.get<ForgeJob>(`job:${jobId}`);
      if (!job) return errorResponse("Job not found", 404);
      if (job.status !== "blueprint_ready") {
        return errorResponse("Blueprint not ready or colors already applied");
      }
      if (!job.blueprintUrl) return errorResponse("Internal error", 500);

      // Fetch blueprint from R2 to pass inline to Gemini
      const bpKey = job.blueprintUrl.replace(`${CDN_BASE}/`, "");
      const bpObj = await this.env.SHIP_MODELS.get(bpKey);
      if (!bpObj) return errorResponse("Internal error", 500);
      const bpBuffer = await bpObj.arrayBuffer();
      const bpBase64 = arrayBufferToBase64(bpBuffer);
      const bpMime = bpObj.httpMetadata?.contentType ?? "image/png";

      // ── Pass 2: Gemini → colored game-asset render ──
      const colorPrompt = COLORED_RENDER_TEMPLATE
        .replace("PRIMARY_COLOR", primaryColor)
        .replace("SECONDARY_COLOR", secondaryColor);
      // Mark job as rendering
      job.status = "render_loading";
      job.primaryColor = primaryColor;
      job.secondaryColor = secondaryColor;
      job.updatedAt = Date.now();
      await this.state.storage.put(`job:${jobId}`, job);

      const colorRes = await fetch(
        `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${this.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: colorPrompt },
                { inlineData: { mimeType: bpMime, data: bpBase64 } },
              ],
            }],
            generationConfig: {
              responseModalities: ["IMAGE", "TEXT"],
              imageConfig: { aspectRatio: "16:9" },
            },
          }),
        },
      );

      if (!colorRes.ok) {
        const errText = await colorRes.text();
        console.error("Gemini color render API error:", colorRes.status, errText);
        job.status = "blueprint_ready";
        job.updatedAt = Date.now();
        await this.state.storage.put(`job:${jobId}`, job);
        return errorResponse("Generation failed", 502);
      }

      const colorBase64 = this.extractGeminiImage(await colorRes.json());
      if (!colorBase64) {
        job.status = "blueprint_ready";
        job.updatedAt = Date.now();
        await this.state.storage.put(`job:${jobId}`, job);
        return errorResponse("Generation failed. Try different colors.", 502);
      }

      // Upload colored concept to R2 (convert to JPEG for smaller file size)
      const c = await toJpeg(this.env.IMAGES, colorBase64.data, colorBase64.mimeType);
      const conceptR2Key = `forge/${jobId}/concept.${c.ext}`;
      await this.env.SHIP_MODELS.put(conceptR2Key, c.bytes, {
        httpMetadata: { contentType: c.mimeType },
      });
      const conceptUrl = `${CDN_BASE}/${conceptR2Key}`;

      // Update job to concept_ready — player can now approve for 3D
      job.status = "concept_ready";
      job.conceptUrl = conceptUrl;
      job.updatedAt = Date.now();
      await this.state.storage.put(`job:${jobId}`, job);

      return json({ jobId, conceptUrl });
    } catch (err) {
      console.error("generate-render error:", err);
      return errorResponse("Internal error", 500);
    }
  }

  /** Extract the first image from a Gemini generateContent response */
  private extractGeminiImage(geminiData: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType: string; data: string };
          text?: string;
        }>;
      };
    }>;
  }): { data: string; mimeType: string } | null {
    for (const candidate of geminiData.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.inlineData?.data) {
          return {
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || "image/png",
          };
        }
      }
    }
    return null;
  }

  /* ─── Step 2: Convert to 3D (MeshyAI) ─── */

  private async handleGenerate3D(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as { jobId?: string };
      const jobId = body.jobId;

      if (!jobId) return errorResponse("jobId required");

      const job = await this.state.storage.get<ForgeJob>(`job:${jobId}`);
      if (!job) return errorResponse("Job not found", 404);
      if (job.status !== "concept_ready") {
        console.warn(`generate-3d: job ${jobId} in state '${job.status}', expected 'concept_ready'`);
        return errorResponse("Job is not ready for 3D generation");
      }
      if (!job.conceptUrl) {
        console.warn(`generate-3d: job ${jobId} missing concept image`);
        return errorResponse("Job is not ready for 3D generation");
      }

      // Build texture hint from stored colors
      const texHint = [
        job.primaryColor && `Primary hull: ${job.primaryColor}`,
        job.secondaryColor && `Secondary accents: ${job.secondaryColor}`,
      ].filter(Boolean).join(". ");

      // Call MeshyAI Image-to-3D
      const meshyRes = await fetch(`${MESHY_API_BASE}/image-to-3d`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.MESHY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_url: job.conceptUrl,
          ai_model: "meshy-6",
          topology: "triangle",
          target_polycount: 15000,
          should_remesh: true,
          should_texture: true,
          enable_pbr: true,
          ...(texHint && { texture_prompt: texHint }),
        }),
      });

      if (!meshyRes.ok) {
        const errText = await meshyRes.text();
        console.error("MeshyAI error:", meshyRes.status, errText);
        return errorResponse("Generation failed", 502);
      }

      const meshyData = (await meshyRes.json()) as { result: string };
      const meshyTaskId = meshyData.result;

      // Update job
      job.status = "building_3d";
      job.meshyTaskId = meshyTaskId;
      job.meshyProgress = 0;
      job.updatedAt = Date.now();
      await this.state.storage.put(`job:${jobId}`, job);

      // Queue the first poll (consumer will re-queue until done)
      await this.env.MESHY_QUEUE.send(
        { jobId, meshyTaskId, attempt: 1 },
        { delaySeconds: 10 },
      );

      return json({ jobId, status: "building_3d" });
    } catch (err) {
      console.error("generate-3d error:", err);
      return errorResponse("Internal error", 500);
    }
  }

  /* ─── Poll MeshyAI (called by Queue consumer via internal fetch) ─── */

  private async handlePollJob(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as { jobId?: string; meshyTaskId?: string };
      const { jobId, meshyTaskId } = body;

      if (!jobId || !meshyTaskId) return errorResponse("jobId and meshyTaskId required");

      const storageKey = `job:${jobId}`;
      const job = await this.state.storage.get<ForgeJob>(storageKey);
      if (!job) return json({ action: "done", reason: "job_not_found" });
      if (job.status !== "building_3d") return json({ action: "done", reason: `status_${job.status}` });

      const result = await this.pollMeshyTask(storageKey, job, meshyTaskId);
      return json(result);
    } catch (err) {
      console.error("handlePollJob error:", err);
      return json({ action: "retry" }); // let queue retry on error
    }
  }

  private async pollMeshyTask(
    storageKey: string,
    job: ForgeJob,
    meshyTaskId: string,
  ): Promise<{ action: "done" | "retry"; reason?: string }> {
    try {
      const res = await fetch(`${MESHY_API_BASE}/image-to-3d/${meshyTaskId}`, {
        headers: { Authorization: `Bearer ${this.env.MESHY_API_KEY}` },
      });

      if (!res.ok) {
        console.error("MeshyAI poll error:", res.status);
        return { action: "retry" };
      }

      const task = (await res.json()) as {
        status: string;
        progress: number;
        model_urls?: { glb?: string };
        thumbnail_url?: string;
        task_error?: { message: string };
      };

      job.meshyProgress = task.progress;
      job.updatedAt = Date.now();

      if (task.status === "SUCCEEDED") {
        await this.finalizeShip(storageKey, job, task);
        return { action: "done", reason: "succeeded" };
      } else if (task.status === "FAILED") {
        job.status = "failed";
        const rawError = task.task_error?.message ?? "unknown";
        console.error(`Job ${job.id} MeshyAI failed:`, rawError);
        job.error = "3D generation failed. Try a different prompt.";
        await this.state.storage.put(storageKey, job);
        return { action: "done", reason: "failed" };
      } else {
        // Still processing
        await this.state.storage.put(storageKey, job);
        return { action: "retry", reason: `progress_${task.progress}` };
      }
    } catch (err) {
      console.error("pollMeshyTask error:", err);
      return { action: "retry" };
    }
  }

  private async finalizeShip(
    storageKey: string,
    job: ForgeJob,
    task: { model_urls?: { glb?: string }; thumbnail_url?: string },
  ): Promise<void> {
    try {
      const glbUrl = task.model_urls?.glb;
      if (!glbUrl) {
        console.error(`Job ${job.id} finalizeShip: no GLB URL in MeshyAI response`);
        job.status = "failed";
        job.error = "3D model generation incomplete. Try a different prompt.";
        await this.state.storage.put(storageKey, job);
        return;
      }

      // Download GLB from MeshyAI and upload to R2
      const glbRes = await fetch(glbUrl);
      if (!glbRes.ok) throw new Error(`Failed to download GLB: ${glbRes.status}`);
      const glbBlob = await glbRes.arrayBuffer();

      const modelR2Key = `forge/${job.id}/model.glb`;
      await this.env.SHIP_MODELS.put(modelR2Key, glbBlob, {
        httpMetadata: { contentType: "model/gltf-binary" },
      });

      // Download thumbnail if available (convert to JPEG for smaller file size)
      let thumbnailCdnUrl = "";
      if (task.thumbnail_url) {
        try {
          const thumbRes = await fetch(task.thumbnail_url);
          if (thumbRes.ok) {
            const thumbBlob = await thumbRes.arrayBuffer();
            const thumb = await toJpegFromBytes(this.env.IMAGES, thumbBlob);
            const thumbR2Key = `forge/${job.id}/thumb.${thumb.ext}`;
            await this.env.SHIP_MODELS.put(thumbR2Key, thumb.bytes, {
              httpMetadata: { contentType: thumb.mimeType },
            });
            thumbnailCdnUrl = `${CDN_BASE}/${thumbR2Key}`;
          }
        } catch {
          // Thumbnail is non-critical
        }
      }

      const modelCdnUrl = `${CDN_BASE}/${modelR2Key}`;

      // Update job as succeeded
      job.status = "succeeded";
      job.modelUrl = modelCdnUrl;
      job.thumbnailUrl = thumbnailCdnUrl || job.conceptUrl || "";
      job.updatedAt = Date.now();
      await this.state.storage.put(storageKey, job);

      // Save to community catalog
      const stats = generateStatsFromPrompt(job.prompt);
      const shipClass = job.userShipClass || deriveShipClass(job.prompt);
      const lore = job.lore || generateLore(job.prompt, job.shipName);

      const shipMeta: CommunityShipMeta = {
        id: job.id,
        name: job.shipName,
        class: shipClass,
        prompt: job.prompt,
        creator: "Anashel", // TODO: swap for job.nickname when user accounts land
        modelUrl: modelCdnUrl,
        thumbnailUrl: job.thumbnailUrl,
        conceptUrl: job.conceptUrl ?? "",
        stats,
        lore,
        createdAt: job.createdAt,
      };

      const ts = String(job.createdAt).padStart(15, "0");
      await this.state.storage.put(`ship:${ts}:${job.id}`, shipMeta);

      // Persist to R2 as meta.json
      await this.persistMetaToR2(job.id, shipMeta);

      // Prune old ships if over limit
      const allShips = await this.state.storage.list({ prefix: "ship:" });
      if (allShips.size > MAX_CATALOG_SHIPS) {
        const sortedKeys = [...allShips.keys()].sort();
        const toDelete = sortedKeys.slice(0, sortedKeys.length - MAX_CATALOG_SHIPS);
        for (const k of toDelete) {
          await this.state.storage.delete(k);
        }
      }
    } catch (err) {
      console.error(`Job ${job.id} finalizeShip error:`, err);
      job.status = "failed";
      job.error = "3D model processing failed. Try again later.";
      await this.state.storage.put(storageKey, job);
    }
  }

  /* ─── Status Endpoint ─── */

  private async handleGetStatus(jobId: string): Promise<Response> {
    const job = await this.state.storage.get<ForgeJob>(`job:${jobId}`);
    if (!job) return errorResponse("Job not found", 404);

    const response: Record<string, unknown> = {
      jobId: job.id,
      status: job.status,
      prompt: job.prompt,
      shipName: job.shipName,
      blueprintUrl: job.blueprintUrl,
      conceptUrl: job.conceptUrl,
      primaryColor: job.primaryColor,
      secondaryColor: job.secondaryColor,
      progress: job.meshyProgress ?? 0,
      createdAt: job.createdAt,
    };

    if (job.status === "succeeded") {
      // Include full ship metadata
      const ts = String(job.createdAt).padStart(15, "0");
      const ship = await this.state.storage.get<CommunityShipMeta>(`ship:${ts}:${job.id}`);
      if (ship) {
        response.ship = ship;
      }
    }

    if (job.status === "failed") {
      response.error = job.error;
    }

    return json(response);
  }

  /* ─── Catalog Endpoint ─── */

  private async handleGetCatalog(url: URL): Promise<Response> {
    const limit = Math.min(50, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20);
    const cursor = url.searchParams.get("cursor") ?? undefined;

    const entries = await this.state.storage.list<CommunityShipMeta>({
      prefix: "ship:",
      reverse: true,
      limit,
      start: cursor,
    });

    const ships: CommunityShipMeta[] = [];
    let lastKey = "";
    for (const [key, value] of entries) {
      ships.push(value);
      lastKey = key;
    }

    return json({
      ships,
      cursor: ships.length === limit ? lastKey : null,
    });
  }

  /* ─── Asset Serving ─── */

  private async handleGetAsset(key: string): Promise<Response> {
    let object = await this.env.SHIP_MODELS.get(key);

    // Fallback: if a .png was requested but only .jpg exists (post-migration), serve the .jpg
    if (!object && key.endsWith(".png")) {
      object = await this.env.SHIP_MODELS.get(key.replace(/\.png$/, ".jpg"));
    }

    if (!object) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    };

    return new Response(object.body, { headers });
  }

  /* ─── Regenerate Lore (admin) ─── */

  private async handleRegenerateLore(shipId: string, request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as {
        prompt?: string;
        currentLore?: string;
        shipName?: string;
        shipClass?: string;
      };

      const userPrompt = (body.prompt ?? "").trim();
      if (!userPrompt) return errorResponse("Prompt required");

      const currentLore = body.currentLore ?? "";
      const shipName = body.shipName ?? "Unknown";
      const shipClass = body.shipClass ?? "CUSTOM";

      // Find ship in storage
      const { key: shipKey, meta: ship } = await this.findShipById(shipId);
      if (!shipKey || !ship) return errorResponse("Ship not found", 404);

      // Call Grok for lore generation
      const grokMessage = `Ship name: ${shipName}\nShip class: ${shipClass}\nCurrent lore:\n${currentLore}\n\nInstructions: ${userPrompt}`;

      let newLore: string;
      try {
        const grokRes = await fetch(`${GROK_API_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.env.GROK_API}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: GROK_MODEL,
            messages: [
              { role: "system", content: GROK_LORE_SYSTEM_PROMPT },
              { role: "user", content: grokMessage },
            ],
            max_tokens: 400,
            temperature: 0.8,
          }),
        });

        if (!grokRes.ok) {
          console.error("Grok lore API error:", grokRes.status);
          return errorResponse("Generation failed", 502);
        }

        const grokData = (await grokRes.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = grokData.choices?.[0]?.message?.content?.trim();
        if (!content) return errorResponse("Generation failed", 502);
        newLore = content;
      } catch (err) {
        console.error("Grok lore error:", err);
        return errorResponse("Generation failed", 502);
      }

      // Update ship metadata
      ship.lore = newLore;
      await this.state.storage.put(shipKey, ship);

      // Persist to R2 as meta.json
      await this.persistMetaToR2(shipId, ship);

      return json({ lore: newLore });
    } catch (err) {
      console.error("handleRegenerateLore error:", err);
      return errorResponse("Internal error", 500);
    }
  }

  /* ─── Regenerate Hero Image (admin, async) ─── */

  private async handleRegenerateHero(shipId: string, request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as {
        description?: string;
        screenshot?: string; // base64 PNG (no data URI prefix)
      };

      const description = (body.description ?? "").trim();
      const screenshot = (body.screenshot ?? "").trim();
      if (!description) return errorResponse("Description required");
      if (!screenshot) return errorResponse("Screenshot required");

      const { key: shipKey, meta: ship } = await this.findShipById(shipId);
      if (!shipKey || !ship) return errorResponse("Ship not found", 404);

      const heroJobId = crypto.randomUUID();

      // Store pending job — frontend will poll for completion
      await this.state.storage.put(`hero:${shipId}`, {
        jobId: heroJobId,
        status: "pending" as const,
        startedAt: Date.now(),
      });

      // Fire off the background work — the DO stays alive while the fetch is pending.
      // We intentionally do NOT await this: the HTTP response returns immediately.
      this.runHeroGeneration(shipId, shipKey, ship, description, screenshot, heroJobId);

      return json({ heroJobId, status: "pending" });
    } catch (err) {
      console.error("handleRegenerateHero error:", err);
      return errorResponse("Internal error", 500);
    }
  }

  /** Background hero generation — runs after the HTTP response has been sent. */
  private async runHeroGeneration(
    shipId: string,
    _shipKey: string,
    ship: CommunityShipMeta,
    description: string,
    screenshot: string,
    heroJobId: string,
  ): Promise<void> {
    const heroKey = `hero:${shipId}`;
    const r2Prefix = ship.source === "builtin" ? "ships" : "forge";

    try {
      // Step 1: Enhance description via Grok
      let enhancedPrompt: string;
      try {
        const grokRes = await fetch(`${GROK_API_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.env.GROK_API}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: GROK_MODEL,
            messages: [
              { role: "system", content: GROK_HERO_SYSTEM_PROMPT },
              { role: "user", content: `Ship name: ${ship.name}\nShip class: ${ship.class}\n\nScene description: ${description}` },
            ],
            max_tokens: 1500,
            temperature: 0.7,
          }),
        });

        if (grokRes.ok) {
          const grokData = (await grokRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          enhancedPrompt = grokData.choices?.[0]?.message?.content?.trim() || description;
        } else {
          console.warn("Grok hero API failed, using raw description:", grokRes.status);
          enhancedPrompt = description;
        }
      } catch (grokErr) {
        console.warn("Grok hero error, using raw description:", grokErr);
        enhancedPrompt = description;
      }

      // Step 2: Gemini with multimodal input (text + ship screenshot reference)
      const finalPrompt = enhancedPrompt + "\nEve Online style. No text, no logo.";
      const geminiRes = await fetch(
        `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${this.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: finalPrompt },
                { inlineData: { mimeType: "image/png", data: screenshot } },
              ],
            }],
            generationConfig: {
              responseModalities: ["IMAGE", "TEXT"],
              imageConfig: { aspectRatio: "16:9" },
            },
          }),
        },
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error("Gemini hero API error:", geminiRes.status, errText);
        await this.state.storage.put(heroKey, {
          jobId: heroJobId,
          status: "error" as const,
          error: "Generation failed",
        });
        return;
      }

      const geminiData = (await geminiRes.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              inlineData?: { mimeType: string; data: string };
              text?: string;
            }>;
          };
        }>;
      };

      let imageBase64: string | null = null;
      let imageMimeType = "image/png";
      for (const candidate of geminiData.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.inlineData?.data) {
            imageBase64 = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || "image/png";
            break;
          }
        }
        if (imageBase64) break;
      }

      if (!imageBase64) {
        await this.state.storage.put(heroKey, {
          jobId: heroJobId,
          status: "error" as const,
          error: "Gemini did not return an image. Try a different description.",
        });
        return;
      }

      // Step 3: Upload DRAFT to R2 (convert to JPEG for smaller file size)
      const hero = await toJpeg(this.env.IMAGES, imageBase64, imageMimeType);
      const draftR2Key = `${r2Prefix}/${shipId}/hero_draft.${hero.ext}`;
      await this.env.SHIP_MODELS.put(draftR2Key, hero.bytes, {
        httpMetadata: { contentType: hero.mimeType },
      });

      const heroUrl = `${CDN_BASE}/${draftR2Key}`;

      await this.state.storage.put(heroKey, {
        jobId: heroJobId,
        status: "ready" as const,
        heroUrl,
      });
    } catch (err) {
      console.error("runHeroGeneration error:", err);
      await this.state.storage.put(heroKey, {
        jobId: heroJobId,
        status: "error" as const,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  /* ─── Hero Status Polling (admin) ─── */

  private async handleHeroStatus(shipId: string): Promise<Response> {
    const heroJob = await this.state.storage.get<{
      jobId: string;
      status: "pending" | "ready" | "error";
      heroUrl?: string;
      error?: string;
    }>(`hero:${shipId}`);

    if (!heroJob) {
      return json({ status: "idle" });
    }

    return json(heroJob);
  }

  /* ─── Approve Hero Draft (admin) ─── */

  private async handleApproveHero(shipId: string): Promise<Response> {
    try {
      // Find ship first to determine R2 prefix
      const { key: shipKey, meta: ship } = await this.findShipById(shipId);
      if (!shipKey || !ship) return errorResponse("Ship not found", 404);

      const r2Prefix = ship.source === "builtin" ? "ships" : "forge";

      // Find the draft file in R2 (could be .png or .jpg)
      const listed = await this.env.SHIP_MODELS.list({ prefix: `${r2Prefix}/${shipId}/hero_draft.` });
      const draftObj = listed.objects[0];
      if (!draftObj) {
        return errorResponse("Not found", 404);
      }

      // Read draft content
      const draftData = await this.env.SHIP_MODELS.get(draftObj.key);
      if (!draftData) {
        return errorResponse("Internal error", 500);
      }

      // Determine extension from the draft key
      const ext = draftObj.key.endsWith(".jpg") ? "jpg" : "png";
      const contentType = ext === "jpg" ? "image/jpeg" : "image/png";

      // Copy to official hero key
      const heroR2Key = `${r2Prefix}/${shipId}/hero.${ext}`;
      const body = await draftData.arrayBuffer();
      await this.env.SHIP_MODELS.put(heroR2Key, body, {
        httpMetadata: { contentType },
      });

      // Clean up draft
      await this.env.SHIP_MODELS.delete(draftObj.key);

      const heroUrl = `${CDN_BASE}/${heroR2Key}`;

      ship.heroUrl = heroUrl;
      await this.state.storage.put(shipKey, ship);

      // Clean up hero job state
      await this.state.storage.delete(`hero:${shipId}`);

      // Persist to R2 as meta.json
      await this.persistMetaToR2(shipId, ship);

      return json({ heroUrl });
    } catch (err) {
      console.error("handleApproveHero error:", err);
      return errorResponse("Internal error", 500);
    }
  }

  /* ─── Seed Built-in Ships (admin) ─── */

  private async handleSeedBuiltins(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as { ships?: CommunityShipMeta[] };
      const ships = body.ships;
      if (!ships || !Array.isArray(ships) || ships.length === 0) {
        return errorResponse("Invalid request");
      }

      let seeded = 0;
      let skipped = 0;

      for (const shipData of ships) {
        if (!shipData.id || !shipData.name) {
          skipped++;
          continue;
        }

        // Check if this ship already exists in DO storage
        const { key: existingKey } = await this.findShipById(shipData.id);
        if (existingKey) {
          skipped++;
          continue;
        }

        // Build CDN URLs from ship ID and name
        const cdnPrefix = `${CDN_BASE}/ships/${shipData.id}`;
        const ship: CommunityShipMeta = {
          ...shipData,
          source: "builtin",
          modelUrl: `${cdnPrefix}/${shipData.name}.gltf`,
          texturePath: `${cdnPrefix}/${shipData.name}_Blue.png`,
          thumbnailUrl: "",
          conceptUrl: "",
          creator: shipData.creator || "EV 2090",
          prompt: "",
          createdAt: 0,
        };

        // Build extraTextures CDN URLs if the ship has them
        if (shipData.extraTextures) {
          const resolved: Record<string, string> = {};
          for (const [colorName] of Object.entries(shipData.extraTextures)) {
            // Determine extension from the original value or default to png
            const origVal = shipData.extraTextures[colorName];
            const ext = origVal.endsWith(".jpg") ? "jpg" : "png";
            resolved[colorName] = `${cdnPrefix}/${shipData.name}_${colorName}.${ext}`;
          }
          ship.extraTextures = resolved;
        }

        // Use timestamp 0 padded to 15 digits so built-in ships sort after
        // community ships in reverse-order catalog listing
        const storageKey = `ship:000000000000000:${shipData.id}`;
        await this.state.storage.put(storageKey, ship);

        // Persist meta.json to R2
        await this.persistMetaToR2(shipData.id, ship);

        seeded++;
      }

      return json({ seeded, skipped, total: ships.length });
    } catch (err) {
      console.error("handleSeedBuiltins error:", err);
      return errorResponse("Internal error", 500);
    }
  }

  /* ─── Retroactive PNG → JPEG Migration (admin) ─── */

  private async handleMigrateImages(request: Request): Promise<Response> {
    try {
      // Parse optional batch cursor from body
      let startCursor: string | undefined;
      try {
        const body = await request.json() as { cursor?: string };
        startCursor = body.cursor;
      } catch { /* empty body is fine */ }

      const BATCH_SIZE = 20; // Process up to 20 images per call (stay within DO wall-clock limits)
      const results: Array<{ key: string; status: string; savedBytes?: number }> = [];
      const imageExts = [".png"]; // Only convert PNGs
      const skipSuffixes = ["meta.json", ".glb", ".gltf"];

      // List R2 objects and find PNG images
      let cursor: string | undefined = startCursor;
      const pngKeys: string[] = [];

      do {
        const listed = await this.env.SHIP_MODELS.list({ cursor, limit: 500 });
        for (const obj of listed.objects) {
          const isImage = imageExts.some((ext) => obj.key.endsWith(ext));
          const isSkip = skipSuffixes.some((s) => obj.key.endsWith(s));
          if (!isImage || isSkip) continue;
          pngKeys.push(obj.key);
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);

      // Convert each PNG (up to BATCH_SIZE)
      const toProcess = pngKeys.slice(0, BATCH_SIZE);
      const remaining = pngKeys.length - toProcess.length;

      for (const pngKey of toProcess) {
        try {
          const obj = await this.env.SHIP_MODELS.get(pngKey);
          if (!obj) { results.push({ key: pngKey, status: "not_found" }); continue; }

          const originalSize = obj.size;
          const buffer = await obj.arrayBuffer();
          const converted = await toJpegFromBytes(this.env.IMAGES, buffer);

          if (converted.ext === "png") {
            // Conversion failed (fallback kept original) — skip
            results.push({ key: pngKey, status: "skipped_conversion_failed" });
            continue;
          }

          const jpgKey = pngKey.replace(/\.png$/, ".jpg");
          await this.env.SHIP_MODELS.put(jpgKey, converted.bytes, {
            httpMetadata: { contentType: "image/jpeg" },
          });

          // Delete original PNG
          await this.env.SHIP_MODELS.delete(pngKey);

          results.push({
            key: pngKey,
            status: "converted",
            savedBytes: originalSize - converted.bytes.byteLength,
          });
        } catch (err) {
          console.error(`[Forge] Image migration error for ${pngKey}:`, err);
          results.push({ key: pngKey, status: "error" });
        }
      }

      // Update ship metadata URLs (thumbnailUrl, conceptUrl, heroUrl)
      const allShips = await this.state.storage.list<CommunityShipMeta>({ prefix: "ship:" });
      let metaUpdated = 0;
      for (const [key, ship] of allShips) {
        let changed = false;
        const urlFields = ["thumbnailUrl", "conceptUrl", "heroUrl"] as const;
        for (const field of urlFields) {
          const val = ship[field];
          if (val && val.endsWith(".png")) {
            (ship as unknown as Record<string, unknown>)[field] = val.replace(/\.png$/, ".jpg");
            changed = true;
          }
        }
        if (changed) {
          await this.state.storage.put(key, ship);
          await this.persistMetaToR2(ship.id, ship);
          metaUpdated++;
        }
      }

      // Update in-flight job records
      const allJobs = await this.state.storage.list<ForgeJob>({ prefix: "job:" });
      let jobsUpdated = 0;
      for (const [key, job] of allJobs) {
        let changed = false;
        const urlFields = ["blueprintUrl", "conceptUrl", "modelUrl", "thumbnailUrl"] as const;
        for (const field of urlFields) {
          const val = job[field];
          if (val && val.endsWith(".png")) {
            (job as unknown as Record<string, unknown>)[field] = val.replace(/\.png$/, ".jpg");
            changed = true;
          }
        }
        if (changed) {
          await this.state.storage.put(key, job);
          jobsUpdated++;
        }
      }

      const converted = results.filter((r) => r.status === "converted").length;
      const totalSaved = results.reduce((sum, r) => sum + (r.savedBytes ?? 0), 0);

      return json({
        converted,
        errors: results.filter((r) => r.status.startsWith("error")).length,
        skipped: results.filter((r) => r.status.startsWith("skipped")).length,
        metaUpdated,
        jobsUpdated,
        remaining,
        totalSavedBytes: totalSaved,
        totalSavedMB: +(totalSaved / 1024 / 1024).toFixed(2),
        details: results,
      });
    } catch (err) {
      console.error("handleMigrateImages error:", err);
      return errorResponse("Internal error", 500);
    }
  }

  /* ─── R2 JSON Metadata Persistence ─── */

  private async persistMetaToR2(shipId: string, ship: CommunityShipMeta): Promise<void> {
    try {
      // Built-in ships use ships/ prefix, community ships use forge/ prefix
      const prefix = ship.source === "builtin" ? "ships" : "forge";
      const metaJson = JSON.stringify(ship, null, 2);
      await this.env.SHIP_MODELS.put(`${prefix}/${shipId}/meta.json`, metaJson, {
        httpMetadata: { contentType: "application/json" },
      });
    } catch (err) {
      console.error("persistMetaToR2 error:", err);
      // Non-critical — DO storage is the source of truth
    }
  }

  /* ─── Find ship by ID (shared helper) ─── */

  private async findShipById(shipId: string): Promise<{ key: string | null; meta: CommunityShipMeta | null }> {
    const allShips = await this.state.storage.list<CommunityShipMeta>({ prefix: "ship:" });
    for (const [key, value] of allShips) {
      if (value.id === shipId) {
        return { key, meta: value };
      }
    }
    return { key: null, meta: null };
  }

  /* ─── Delete Ship (admin) ─── */

  private async handleDeleteShip(shipId: string): Promise<Response> {
    try {
      const { key: shipKey, meta: ship } = await this.findShipById(shipId);
      if (!shipKey || !ship) {
        return errorResponse("Not found", 404);
      }

      // Delete from DO storage
      await this.state.storage.delete(shipKey);

      // Also delete the job record if it exists
      await this.state.storage.delete(`job:${shipId}`);

      // Delete R2 assets (non-critical — silently ignore errors)
      const prefix = ship.source === "builtin" ? "ships" : "forge";
      const r2Prefix = `${prefix}/${shipId}/`;
      try {
        const listed = await this.env.SHIP_MODELS.list({ prefix: r2Prefix });
        for (const obj of listed.objects) {
          await this.env.SHIP_MODELS.delete(obj.key);
        }
      } catch {
        // R2 cleanup is non-critical
      }

      return json({ deleted: shipId });
    } catch (err) {
      console.error("handleDeleteShip error:", err);
      return errorResponse("Internal error", 500);
    }
  }

  /* ─── Utility ─── */

  private randomShipName(): string {
    const prefixes = ["Void", "Nebula", "Star", "Shadow", "Iron", "Ghost", "Quantum", "Drift", "Nova", "Apex"];
    const suffixes = ["Fang", "Wing", "Blade", "Runner", "Hunter", "Dagger", "Storm", "Viper", "Hawk", "Claw"];
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    const s = suffixes[Math.floor(Math.random() * suffixes.length)];
    return `${p} ${s}`;
  }
}
