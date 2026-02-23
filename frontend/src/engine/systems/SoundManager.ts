// ---------------------------------------------------------------------------
// SoundManager.ts
// Lightweight audio manager using HTMLAudioElement.
// Avoids Web Audio API / AudioContext entirely — no CORS issues, no browser
// permission prompts, no autoplay policy warnings.
// ---------------------------------------------------------------------------

class SoundManagerService {
  /** Pool of Audio elements for one-shot playback */
  private pools = new Map<string, HTMLAudioElement[]>();
  /** Active loop element */
  private loops = new Map<string, HTMLAudioElement>();
  /** Cooldown tracking for one-shots */
  private lastPlayTime = new Map<string, number>();
  /** URLs that failed to load — don't keep retrying */
  private failed = new Set<string>();

  /**
   * Pre-load a sound file into the browser cache.
   * Uses a hidden Audio element to trigger download.
   */
  preload(url: string) {
    if (this.failed.has(url)) return;
    try {
      const audio = new Audio();
      audio.preload = "auto";
      // Do NOT set crossOrigin — it forces a CORS request which many CDNs block.
      // Simple audio playback works fine without it.
      audio.src = url;
      audio.onerror = () => {
        // Don't mark as failed on preload — might work via direct playback
      };
      audio.load();
      if (!this.pools.has(url)) {
        this.pools.set(url, [audio]);
      }
    } catch {
      // Silently ignore preload failures
    }
  }

  /** Get or create an Audio element from the pool */
  private getFromPool(url: string): HTMLAudioElement | null {
    if (this.failed.has(url)) return null;

    const pool = this.pools.get(url);
    if (pool) {
      const idle = pool.find((a) => a.paused || a.ended);
      if (idle) {
        idle.currentTime = 0;
        return idle;
      }
    }

    try {
      const audio = new Audio(url);
      audio.onerror = () => {
        this.failed.add(url);
      };
      if (!this.pools.has(url)) {
        this.pools.set(url, []);
      }
      this.pools.get(url)!.push(audio);
      return audio;
    } catch {
      this.failed.add(url);
      return null;
    }
  }

  /**
   * Play a one-shot sound (e.g. scanner ping).
   * @param cooldownMs  Minimum ms between plays of the same sound.
   */
  playOnce(url: string, volume = 0.5, cooldownMs = 400) {
    if (this.failed.has(url)) return;

    const now = performance.now();
    const last = this.lastPlayTime.get(url) ?? 0;
    if (now - last < cooldownMs) return;
    this.lastPlayTime.set(url, now);

    const audio = this.getFromPool(url);
    if (!audio) return;

    audio.volume = volume;
    audio.loop = false;
    audio.play().catch(() => {
      // Autoplay blocked — will work after first user interaction
    });
  }

  /**
   * Start a looping sound (e.g. thruster).
   * If already looping, adjusts volume.
   */
  startLoop(url: string, volume = 0.3) {
    if (this.failed.has(url)) return;

    const existing = this.loops.get(url);
    if (existing) {
      existing.volume = volume;
      return;
    }

    const audio = this.getFromPool(url);
    if (!audio) return;

    audio.volume = volume;
    audio.loop = true;
    audio.play().catch(() => {
      // Autoplay blocked
    });

    this.loops.set(url, audio);
  }

  /** Stop a looping sound. */
  stopLoop(url: string) {
    const loop = this.loops.get(url);
    if (!loop) return;

    loop.pause();
    loop.currentTime = 0;
    this.loops.delete(url);
  }

  /** Check if a loop is currently playing */
  isLooping(url: string): boolean {
    return this.loops.has(url);
  }

  /** Clean up all audio resources */
  dispose() {
    for (const [, audio] of this.loops) {
      audio.pause();
      audio.src = "";
    }
    this.loops.clear();
    for (const [, pool] of this.pools) {
      for (const audio of pool) {
        audio.pause();
        audio.src = "";
      }
    }
    this.pools.clear();
  }
}

/** Global singleton */
export const SoundManager = new SoundManagerService();
