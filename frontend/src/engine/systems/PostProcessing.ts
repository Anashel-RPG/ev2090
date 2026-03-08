import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { vignetteVertexShader, vignetteFragmentShader } from "../shaders/vignette.glsl";
import { colorCorrectionVertexShader, colorCorrectionFragmentShader } from "../shaders/colorCorrection.glsl";

/**
 * Post-processing pipeline for cinematic effects.
 * Wraps Three.js EffectComposer with bloom and vignette passes.
 *
 * When `enabled` is false, Engine.loop() uses direct renderer.render()
 * with zero performance cost. This system only activates during hero shots
 * and immersive screen states.
 *
 * Supports selective lighting via two-pass rendering: when an FPV edge light
 * is active, planets are rendered without it (pass 1), then ships are rendered
 * with it on top (pass 2). This keeps planets in shadow while backlighting ships.
 * Three.js layers do NOT provide per-object light filtering (layers on a light
 * only control camera visibility, not which objects the light affects), so this
 * two-pass approach is the correct solution.
 *
 * Pattern: constructor(renderer, scene, camera) + render() + dispose()
 */
export class PostProcessing {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private vignettePass: ShaderPass;
  private colorCorrectionPass: ShaderPass;

  // ─── Two-pass FPV edge light isolation ───
  // When set, the render pass splits into two draws so the fpvLight only
  // illuminates ship meshes, not planet meshes.
  // Ship meshes use a callback because NPC ships spawn/despawn dynamically.
  private fpvLight: THREE.DirectionalLight | null = null;
  private fpvGetShipMeshes: (() => THREE.Object3D[]) | null = null;
  private fpvPlanetMeshes: THREE.Object3D[] = [];

  enabled = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);

    // Base scene render
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // Bloom — cinematic glow
    const size = renderer.getSize(new THREE.Vector2());
    this.bloomPass = new UnrealBloomPass(
      size,
      0.8,  // strength
      0.4,  // radius
      0.6,  // threshold
    );
    this.composer.addPass(this.bloomPass);

    // Vignette — darken edges
    const vignetteShader = {
      uniforms: {
        tDiffuse: { value: null },
        u_intensity: { value: 0.4 },
        u_softness: { value: 0.5 },
      },
      vertexShader: vignetteVertexShader,
      fragmentShader: vignetteFragmentShader,
    };
    this.vignettePass = new ShaderPass(vignetteShader);
    this.composer.addPass(this.vignettePass);

    // Color correction — final pass for brightness/contrast/exposure tuning
    const colorCorrectionShader = {
      uniforms: {
        tDiffuse: { value: null },
        u_brightness: { value: 1.34 },
        u_contrast: { value: 0.98 },
        u_exposure: { value: 1.16 },
      },
      vertexShader: colorCorrectionVertexShader,
      fragmentShader: colorCorrectionFragmentShader,
    };
    this.colorCorrectionPass = new ShaderPass(colorCorrectionShader);
    this.composer.addPass(this.colorCorrectionPass);
  }

  /** Switch the camera used by the render pass */
  setCamera(camera: THREE.Camera) {
    this.renderPass.camera = camera;
  }

  // ─── Bloom tuning ───

  setBloomStrength(v: number) {
    this.bloomPass.strength = v;
    // Pass stays always enabled — toggling enabled causes a visible contrast
    // flicker from the pipeline switch, even at near-zero values.
  }

  getBloomStrength(): number {
    return this.bloomPass.strength;
  }

  setBloomRadius(v: number) {
    this.bloomPass.radius = v;
  }

  getBloomRadius(): number {
    return this.bloomPass.radius;
  }

  setBloomThreshold(v: number) {
    this.bloomPass.threshold = v;
  }

  getBloomThreshold(): number {
    return this.bloomPass.threshold;
  }

  // ─── Vignette tuning ───

  setVignetteIntensity(v: number) {
    this.vignettePass.uniforms["u_intensity"]!.value = v;
    // Pass stays always enabled — toggling enabled causes a visible contrast
    // flicker from the pipeline switch, even at near-zero values.
  }

  getVignetteIntensity(): number {
    return this.vignettePass.uniforms["u_intensity"]!.value as number;
  }

  setVignetteSoftness(v: number) {
    this.vignettePass.uniforms["u_softness"]!.value = v;
  }

  getVignetteSoftness(): number {
    return this.vignettePass.uniforms["u_softness"]!.value as number;
  }

  // ─── Color correction tuning ───

  setBrightness(v: number) {
    this.colorCorrectionPass.uniforms["u_brightness"]!.value = v;
  }

  getBrightness(): number {
    return this.colorCorrectionPass.uniforms["u_brightness"]!.value as number;
  }

  setContrast(v: number) {
    this.colorCorrectionPass.uniforms["u_contrast"]!.value = v;
  }

  getContrast(): number {
    return this.colorCorrectionPass.uniforms["u_contrast"]!.value as number;
  }

  setExposure(v: number) {
    this.colorCorrectionPass.uniforms["u_exposure"]!.value = v;
  }

  getExposure(): number {
    return this.colorCorrectionPass.uniforms["u_exposure"]!.value as number;
  }

  // ─── FPV two-pass rendering ───

  /**
   * Register the FPV edge light and the meshes it should/shouldn't affect.
   * When the light is active (intensity > 0), render() automatically splits
   * into two passes so the light only illuminates ships, not planets.
   *
   * @param fpvLight       The directional light to isolate
   * @param getShipMeshes  Callback returning meshes that SHOULD receive the light
   *                       (player + NPC ships). Called each frame because NPC ships
   *                       spawn/despawn dynamically.
   * @param planetMeshes   Meshes that should NOT receive the light (planets).
   *                       Static — planets don't change after init.
   */
  setFpvLightExclusions(
    fpvLight: THREE.DirectionalLight,
    getShipMeshes: () => THREE.Object3D[],
    planetMeshes: THREE.Object3D[],
  ) {
    this.fpvLight = fpvLight;
    this.fpvGetShipMeshes = getShipMeshes;
    this.fpvPlanetMeshes = planetMeshes;
  }

  /** Called from Engine.loop() when enabled */
  render() {
    // When the FPV edge light is active, split the scene render into two passes
    // so the light only illuminates ships. When inactive (intensity 0), single-pass.
    if (this.fpvLight && this.fpvLight.intensity > 0 && this.fpvGetShipMeshes) {
      this._renderTwoPass();
    } else {
      this.composer.render();
    }
  }

  /**
   * Two-pass scene render for FPV edge light isolation.
   *
   * Pass 1: Render everything EXCEPT ships, with fpvLight hidden.
   *         Planets + background get correct lighting (no edge light).
   *         Depth buffer captures planet geometry for correct occlusion.
   *
   * Pass 2: Render ONLY ships with fpvLight visible, planets hidden.
   *         Ships get all lights including the edge light.
   *         autoClear=false composites ships on top of pass 1.
   *         Planet depth from pass 1 correctly occludes ships behind planets.
   *
   * After both passes, the EffectComposer's writeBuffer holds the correctly
   * composited scene. We disable the RenderPass so bloom/vignette/color
   * correction run on this pre-rendered result.
   */
  private _renderTwoPass() {
    const renderer = this.composer.renderer;
    const target = this.renderPass.renderToScreen ? null : this.composer.writeBuffer;
    const scene = this.renderPass.scene;
    const camera = this.renderPass.camera;
    const shipMeshes = this.fpvGetShipMeshes!();

    // ── Pass 1: scene without ships, without fpvLight ──
    this.fpvLight!.visible = false;
    const shipWasVisible = shipMeshes.map((m) => m.visible);
    shipMeshes.forEach((m) => (m.visible = false));

    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);

    // ── Pass 2: ships only, with fpvLight, planets hidden ──
    this.fpvLight!.visible = true;
    shipMeshes.forEach((m, i) => (m.visible = shipWasVisible[i] ?? true));
    const planetWasVisible = this.fpvPlanetMeshes.map((m) => m.visible);
    this.fpvPlanetMeshes.forEach((m) => (m.visible = false));

    const savedAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = savedAutoClear;

    // ── Restore visibility ──
    this.fpvPlanetMeshes.forEach((m, i) => (m.visible = planetWasVisible[i] ?? true));

    // Swap buffers (simulate what RenderPass + needsSwap would have done)
    // so the bloom pass reads from the correct buffer.
    const tmp = this.composer.readBuffer;
    this.composer.readBuffer = this.composer.writeBuffer;
    this.composer.writeBuffer = tmp;

    // Run remaining passes (bloom, vignette, color correction) on the
    // pre-rendered scene. Disable RenderPass to skip the redundant draw.
    this.renderPass.enabled = false;
    this.composer.render();
    this.renderPass.enabled = true;
  }

  /** Resize internal render targets when viewport changes */
  resize(width: number, height: number) {
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  }

  dispose() {
    this.composer.dispose();
  }
}
