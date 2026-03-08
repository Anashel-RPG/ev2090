// ---------------------------------------------------------------------------
// ModelCache.ts
// Singleton cache for GLTF models and textures.
// Prevents re-parsing GLTFs and re-compiling shaders on every ship spawn,
// which causes frame freezes / stuttering.
//
// CDN URLs (https://) are routed through AssetCache (IndexedDB) for
// persistent caching across browser sessions. Local paths (/) go direct.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { AssetCache } from "./AssetCache";

/** Check if a path is a remote CDN URL (vs local dev path) */
function isCdnUrl(path: string): boolean {
  return path.startsWith("https://");
}

class ModelCacheService {
  /** Parsed GLTF scene originals (never added to a live scene directly) */
  private gltfCache = new Map<string, THREE.Group>();
  /** In-flight GLTF load promises (de-duplication) */
  private gltfPromises = new Map<string, Promise<THREE.Group>>();
  /** Cached textures by path */
  private textureCache = new Map<string, THREE.Texture>();
  /** In-flight texture load promises */
  private texturePromises = new Map<string, Promise<THREE.Texture>>();

  /** Single shared loader instances — avoids re-creating internals */
  private gltfLoader: GLTFLoader;
  private texLoader = new THREE.TextureLoader();

  constructor() {
    this.gltfLoader = new GLTFLoader();

    // Draco decoder for compressed GLB files (e.g. bridge.glb)
    const dracoLoader = new DRACOLoader();
    // Use the Draco decoder from three.js examples (bundled by Vite)
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    dracoLoader.setDecoderConfig({ type: "js" });
    this.gltfLoader.setDRACOLoader(dracoLoader);
  }

  // ──────────────── Model loading ────────────────

  /**
   * Pre-load a list of model paths. Returns a promise that resolves
   * when all models are parsed and ready for instant cloning.
   */
  preloadModels(paths: string[]): Promise<void> {
    return Promise.all(paths.map((p) => this.loadModel(p))).then(() => {});
  }

  /**
   * Preload assets with progress reporting. Loads in batches to
   * avoid overwhelming the browser with concurrent downloads.
   */
  async preloadWithProgress(
    paths: string[],
    onProgress: (loaded: number, total: number) => void,
  ): Promise<void> {
    const total = paths.length;
    let loaded = 0;
    onProgress(0, total);

    const BATCH_SIZE = 3;
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      const batch = paths.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (path) => {
          try {
            await this.loadModel(path);
          } catch (err) {
            console.warn("preloadWithProgress: failed to load", path, err);
          }
          loaded++;
          onProgress(loaded, total);
        }),
      );
    }
  }

  /**
   * Load a model (or return cached original).
   * CDN URLs are fetched through IndexedDB cache first.
   * The returned Group is the cached original — do NOT add it to a scene.
   */
  private loadModel(path: string): Promise<THREE.Group> {
    const cached = this.gltfCache.get(path);
    if (cached) return Promise.resolve(cached);

    let pending = this.gltfPromises.get(path);
    if (pending) return pending;

    pending = this.loadModelFromSource(path);
    this.gltfPromises.set(path, pending);
    return pending;
  }

  private async loadModelFromSource(path: string): Promise<THREE.Group> {
    let loadUrl = path;

    // For CDN URLs, route through IndexedDB cache
    if (isCdnUrl(path)) {
      try {
        loadUrl = await AssetCache.fetchCached(path);
      } catch (err) {
        console.warn("AssetCache fetch failed, loading direct:", path, err);
        loadUrl = path;
      }
    }

    return new Promise<THREE.Group>((resolve, reject) => {
      this.gltfLoader.load(
        loadUrl,
        (gltf) => {
          this.gltfCache.set(path, gltf.scene);
          this.gltfPromises.delete(path);
          // Revoke blob URL if we used one
          if (loadUrl !== path) AssetCache.revokeBlobUrl(loadUrl);
          resolve(gltf.scene);
        },
        undefined,
        (err) => {
          this.gltfPromises.delete(path);
          if (loadUrl !== path) AssetCache.revokeBlobUrl(loadUrl);
          reject(err);
        },
      );
    });
  }

  /**
   * Get a clone of a cached model, with independent materials so each
   * instance can have its own texture. Returns null if not yet loaded.
   */
  getClone(modelPath: string): THREE.Group | null {
    const original = this.gltfCache.get(modelPath);
    if (!original) return null;

    const clone = original.clone();
    // Clone materials so texture swaps are per-instance
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m: THREE.Material) =>
            m.clone(),
          );
        } else {
          child.material = child.material.clone();
        }
      }
    });
    return clone;
  }

  /**
   * Get a clone, loading the model first if needed.
   * Fires callback with the clone when ready.
   */
  getCloneAsync(
    modelPath: string,
    callback: (clone: THREE.Group) => void,
    errorCallback?: (err: unknown) => void,
  ): void {
    // Try instant clone first
    const immediate = this.getClone(modelPath);
    if (immediate) {
      callback(immediate);
      return;
    }
    // Otherwise load then clone
    this.loadModel(modelPath).then(
      () => {
        const clone = this.getClone(modelPath);
        if (clone) callback(clone);
      },
      (err) => errorCallback?.(err),
    );
  }

  // ──────────────── Texture loading ────────────────

  /**
   * Get a cached texture, or null if not yet loaded.
   */
  getTexture(path: string): THREE.Texture | null {
    return this.textureCache.get(path) ?? null;
  }

  /**
   * Load a texture (or return cached). GLTF-compatible settings applied.
   * CDN URLs are fetched through IndexedDB cache first.
   */
  loadTexture(path: string): Promise<THREE.Texture> {
    const cached = this.textureCache.get(path);
    if (cached) return Promise.resolve(cached);

    let pending = this.texturePromises.get(path);
    if (pending) return pending;

    pending = this.loadTextureFromSource(path);
    this.texturePromises.set(path, pending);
    return pending;
  }

  private async loadTextureFromSource(path: string): Promise<THREE.Texture> {
    let loadUrl = path;

    // For CDN URLs, route through IndexedDB cache
    if (isCdnUrl(path)) {
      try {
        loadUrl = await AssetCache.fetchCached(path);
      } catch (err) {
        console.warn("AssetCache texture fetch failed, loading direct:", path, err);
        loadUrl = path;
      }
    }

    return new Promise<THREE.Texture>((resolve, reject) => {
      this.texLoader.load(
        loadUrl,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = false; // GLTF convention
          this.textureCache.set(path, tex);
          this.texturePromises.delete(path);
          if (loadUrl !== path) AssetCache.revokeBlobUrl(loadUrl);
          resolve(tex);
        },
        undefined,
        (err) => {
          this.texturePromises.delete(path);
          if (loadUrl !== path) AssetCache.revokeBlobUrl(loadUrl);
          reject(err);
        },
      );
    });
  }

  /**
   * Load a texture and apply it to a model's materials with given PBR settings.
   */
  applyTexture(
    model: THREE.Group,
    texturePath: string,
    opts: {
      metalness?: number;
      roughness?: number;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    } = {},
  ): void {
    this.loadTexture(texturePath).then((texture) => {
      model.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          mat.map = texture;
          if (opts.metalness !== undefined) mat.metalness = opts.metalness;
          if (opts.roughness !== undefined) mat.roughness = opts.roughness;
          if (opts.emissive) mat.emissive = opts.emissive;
          if (opts.emissiveIntensity !== undefined)
            mat.emissiveIntensity = opts.emissiveIntensity;
          mat.needsUpdate = true;
        }
      });
    });
  }
}

/** Global singleton — import and use directly */
export const ModelCache = new ModelCacheService();
