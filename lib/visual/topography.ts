export type LayerMetric = 'ndvi' | 'soil' | 'et'

export type ColorStop = {
  stop: number
  color: [number, number, number]
}

export const TOPO_PALETTES: Record<LayerMetric, ColorStop[]> = {
  ndvi: [
    { stop: 0.0, color: [53, 74, 193] },
    { stop: 0.15, color: [69, 138, 223] },
    { stop: 0.32, color: [71, 192, 220] },
    { stop: 0.48, color: [95, 205, 116] },
    { stop: 0.64, color: [220, 211, 88] },
    { stop: 0.8, color: [239, 163, 68] },
    { stop: 1.0, color: [214, 83, 90] },
  ],
  soil: [
    { stop: 0.0, color: [65, 83, 191] },
    { stop: 0.2, color: [80, 145, 220] },
    { stop: 0.4, color: [86, 196, 181] },
    { stop: 0.58, color: [122, 203, 117] },
    { stop: 0.76, color: [231, 195, 86] },
    { stop: 1.0, color: [191, 96, 60] },
  ],
  et: [
    { stop: 0.0, color: [55, 70, 189] },
    { stop: 0.2, color: [64, 124, 221] },
    { stop: 0.4, color: [78, 196, 215] },
    { stop: 0.6, color: [108, 205, 112] },
    { stop: 0.78, color: [239, 190, 82] },
    { stop: 1.0, color: [209, 84, 72] },
  ],
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t
}

export function sampleTopographyPalette(metric: LayerMetric, value: number): [number, number, number] {
  const palette = TOPO_PALETTES[metric]
  const normalized = clamp(value, 0, 1)
  for (let i = 0; i < palette.length - 1; i++) {
    const current = palette[i]
    const next = palette[i + 1]
    if (normalized <= next.stop) {
      const local = (normalized - current.stop) / Math.max(1e-6, next.stop - current.stop)
      return [
        Math.round(lerp(current.color[0], next.color[0], local)),
        Math.round(lerp(current.color[1], next.color[1], local)),
        Math.round(lerp(current.color[2], next.color[2], local)),
      ]
    }
  }
  return palette[palette.length - 1].color
}

export function legendGradientCss(metric: LayerMetric) {
  return `linear-gradient(90deg, ${TOPO_PALETTES[metric]
    .map((stop) => `rgb(${stop.color[0]}, ${stop.color[1]}, ${stop.color[2]}) ${Math.round(stop.stop * 100)}%`)
    .join(', ')})`
}

