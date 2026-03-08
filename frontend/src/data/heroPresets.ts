import type { HeroShotConfig } from "@/types/game";

/**
 * Default hero shot preset for ALL planets.
 *
 * Authored on Nexara — camera position is relative to the planet center,
 * so it produces the same cinematic framing on any planet regardless of
 * size or position in the world.
 *
 * Values exported with COPY CONFIG from the Hero Shot panel.
 */
export const DEFAULT_PLANET_PRESET: HeroShotConfig = {
  zoom: 3.51,
  panX: 8.87,
  panY: 0.89,
  bloomStrength: 0.55,
  bloomRadius: 1.48,
  bloomThreshold: 0.36,
  vignetteIntensity: 0.46,
  vignetteSoftness: 0,
  letterbox: 0.72,
  brightness: 1.34,
  contrast: 0.98,
  exposure: 1.16,
};

/**
 * Per-planet overrides (optional).
 * If a planet has a custom preset here, it takes priority over the default.
 * Key: planet name (matches Planet.name in Engine).
 */
export const HERO_PRESETS: Record<string, HeroShotConfig> = {
  // All planets currently use DEFAULT_PLANET_PRESET.
  // Add per-planet overrides here if needed:
  // Nexara: { ...DEFAULT_PLANET_PRESET, zoom: 4.0 },
};

// ─── Ship Hero Preset ───

/**
 * Ship-specific hero preset — extends HeroShotConfig with
 * ship orientation fields (heading/tilt/roll/scale).
 */
export interface ShipHeroPreset extends HeroShotConfig {
  shipHeading: number;
  shipTilt: number;
  shipRoll: number;
  shipScale: number;
}

/**
 * Default hero shot preset for the player ship.
 * Applies camera + effects + ship orientation in a single animated transition.
 */
export const DEFAULT_SHIP_PRESET: ShipHeroPreset = {
  zoom: 1.45,
  panX: 12.99,
  panY: 2.32,
  bloomStrength: 0.75,
  bloomRadius: 0.76,
  bloomThreshold: 0.5,
  vignetteIntensity: 0.56,
  vignetteSoftness: 0.5,
  letterbox: 1,
  brightness: 1.34,
  contrast: 0.98,
  exposure: 1.16,
  shipHeading: 5.74,
  shipTilt: -1.05,
  shipRoll: 0.05,
  shipScale: 5,
};
