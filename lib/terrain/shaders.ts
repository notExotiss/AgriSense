import * as THREE from 'three'
import { clamp } from '../visual/topography'
import type { TerrainQuality } from '../types/api'

export function createContourShaderMaterial(options: {
  maxHeight: number
  reliefUnits: number
  isDarkTheme: boolean
  quality: TerrainQuality
}) {
  const qualityBase = options.quality === 'high' ? 0.032 : options.quality === 'balanced' ? 0.03 : 0.028
  const densityBase = options.quality === 'high' ? 18 : options.quality === 'balanced' ? 16 : 14

  return new THREE.ShaderMaterial({
    uniforms: {
      uMaxHeight: { value: options.maxHeight },
      uDensity: { value: clamp(densityBase + options.reliefUnits * 1.2, 12, 34) },
      uThickness: { value: qualityBase },
      uOpacity: { value: options.isDarkTheme ? 0.32 : 0.27 },
      uLineColor: { value: new THREE.Color(options.isDarkTheme ? 0x1f3349 : 0x4f677f) },
    },
    vertexShader: `
      varying float vHeight;
      uniform float uMaxHeight;
      void main() {
        vHeight = max(0.0, position.z / max(uMaxHeight, 0.001));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vHeight;
      uniform float uDensity;
      uniform float uThickness;
      uniform float uOpacity;
      uniform vec3 uLineColor;
      void main() {
        float f = fract(vHeight * uDensity);
        float d = min(f, 1.0 - f);
        float aa = fwidth(vHeight * uDensity) * 0.9;
        float line = 1.0 - smoothstep(uThickness, uThickness + aa, d);
        gl_FragColor = vec4(uLineColor, line * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
  })
}

