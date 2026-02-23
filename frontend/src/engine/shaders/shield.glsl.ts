/**
 * Fresnel energy shield with hit-point dissipation.
 * A slightly-larger clone of the ship rendered as a transparent energy shell.
 * The Fresnel effect makes edges glow bright and flat faces nearly invisible.
 * A "hit point" (where the scanner beam touches the shield) radiates energy
 * outward across the surface, with configurable oval shape and falloff.
 * Two opacity levels: subtle base glow + bright hit intensity.
 */

export const SHIELD_VERTEX = /* glsl */ `
uniform float u_scale;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  // Scale the model slightly larger to form the shield shell
  vec3 expanded = position * (1.0 + u_scale);
  vec4 worldPos = modelMatrix * vec4(expanded, 1.0);
  vWorldPos = worldPos.xyz;

  // Transform normal to world space (ignore translation, normalize after)
  vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

  // View direction: camera position → fragment (for Fresnel)
  vViewDir = normalize(cameraPosition - worldPos.xyz);

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const SHIELD_FRAGMENT = /* glsl */ `
uniform float u_opacity;       // overall opacity (animated in/out by scan fade)
uniform vec3  u_color;         // shield RGB color
uniform float u_fresnelPow;    // Fresnel exponent: higher = thinner edge (2-6 typical)

// Hit-point dissipation
uniform vec2  u_hitPoint;      // world XY where scanner beam hits the shield
uniform float u_dissipation;   // falloff rate from hit point (higher = tighter)
uniform float u_ovalX;         // horizontal stretch of dissipation (1.0 = circle)
uniform float u_ovalY;         // vertical stretch of dissipation (1.0 = circle)
uniform float u_baseOpacity;   // subtle shield glow always visible (0–0.5)
uniform float u_hitOpacity;    // max brightness at hit location (0–1)

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  // ── Fresnel: edges glow, flat faces nearly invisible ──
  float fresnel = 1.0 - abs(dot(vViewDir, vWorldNormal));
  fresnel = pow(fresnel, u_fresnelPow);

  // ── Hit-point dissipation: energy radiates from hit, fades with distance ──
  vec2 delta = (vWorldPos.xy - u_hitPoint) / vec2(u_ovalX, u_ovalY);
  float dist = length(delta);
  float hitFactor = exp(-dist * u_dissipation);

  // ── Combine: Fresnel edge glow × (base shield + hit intensity) ──
  float intensity = u_baseOpacity + hitFactor * u_hitOpacity;
  float alpha = fresnel * intensity * u_opacity;
  gl_FragColor = vec4(u_color * (0.6 + 0.4 * fresnel), alpha);
}
`;
