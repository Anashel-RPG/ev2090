/**
 * Screen-space color correction shader.
 * Adjusts brightness, contrast, and exposure of the final rendered image.
 * Used to compensate for the EffectComposer pipeline's subtle contrast shift
 * and to give artists global color control.
 */

export const colorCorrectionVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const colorCorrectionFragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float u_brightness;  // multiplicative, 1.0 = no change
uniform float u_contrast;    // around midpoint 0.5, 1.0 = no change
uniform float u_exposure;    // gamma-style power curve, 1.0 = no change

varying vec2 vUv;

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Brightness — simple multiply
  color.rgb *= u_brightness;

  // Contrast — expand/compress around midpoint
  color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;

  // Exposure — gamma curve (higher = brighter midtones)
  color.rgb = pow(max(color.rgb, vec3(0.0)), vec3(1.0 / u_exposure));

  gl_FragColor = color;
}
`;
