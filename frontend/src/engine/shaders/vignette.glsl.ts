/**
 * Screen-space vignette shader.
 * Darkens edges of the screen for cinematic framing.
 */

export const vignetteVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const vignetteFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float u_intensity;  // 0-1, how dark the edges get
uniform float u_softness;   // 0-1, how gradual the falloff is

varying vec2 vUv;

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Distance from center (0,0 at center, ~0.7 at corners)
  vec2 center = vUv - 0.5;
  float dist = length(center);

  // Vignette falloff — smooth transition from center to edges
  float radius = 0.5 - u_intensity * 0.3;
  float soft = max(0.01, u_softness * 0.5 + 0.2);
  float vignette = smoothstep(radius, radius + soft, dist);

  color.rgb *= 1.0 - vignette * u_intensity;
  gl_FragColor = color;
}
`;
