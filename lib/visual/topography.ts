export type LayerMetric = 'ndvi' | 'soil' | 'et'

export type ColorStop = {
  stop: number
  color: [number, number, number]
}

export const TOPO_PALETTES: Record<LayerMetric, ColorStop[]> = {
  ndvi: [
    { stop: 0.0, color: [93, 123, 223] },
    { stop: 0.16, color: [110, 177, 236] },
    { stop: 0.32, color: [106, 219, 226] },
    { stop: 0.5, color: [129, 216, 156] },
    { stop: 0.68, color: [232, 220, 124] },
    { stop: 0.84, color: [242, 176, 114] },
    { stop: 1.0, color: [226, 126, 134] },
  ],
  soil: [
    { stop: 0.0, color: [106, 128, 214] },
    { stop: 0.2, color: [122, 182, 232] },
    { stop: 0.4, color: [121, 219, 196] },
    { stop: 0.58, color: [152, 214, 149] },
    { stop: 0.76, color: [236, 204, 126] },
    { stop: 1.0, color: [214, 139, 102] },
  ],
  et: [
    { stop: 0.0, color: [98, 120, 218] },
    { stop: 0.2, color: [109, 165, 232] },
    { stop: 0.4, color: [114, 217, 223] },
    { stop: 0.6, color: [146, 214, 149] },
    { stop: 0.78, color: [241, 197, 116] },
    { stop: 1.0, color: [226, 126, 110] },
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
