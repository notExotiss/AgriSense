import { clamp, lerp, sampleTopographyPalette, type LayerMetric } from './topography'

export type MetricGridInput = {
  values: ArrayLike<number>
  width: number
  height: number
  min?: number
  max?: number
}

type RenderMetricCanvasOptions = {
  metric: LayerMetric
  grid: MetricGridInput
  outputWidth?: number
  outputHeight?: number
  contours?: boolean
}

export function resolveMetricRange(values: ArrayLike<number>, hintedMin?: number, hintedMax?: number) {
  let computedMin = Number.POSITIVE_INFINITY
  let computedMax = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i])
    if (!Number.isFinite(value)) continue
    if (value < computedMin) computedMin = value
    if (value > computedMax) computedMax = value
  }

  const hintedValid =
    Number.isFinite(hintedMin) &&
    Number.isFinite(hintedMax) &&
    Number(hintedMax) > Number(hintedMin)

  let min = hintedValid ? Number(hintedMin) : computedMin
  let max = hintedValid ? Number(hintedMax) : computedMax
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    min = 0
    max = 1
  }
  return {
    min,
    max,
    range: Math.max(1e-6, max - min),
  }
}

function sampleBilinear(values: ArrayLike<number>, width: number, height: number, x: number, y: number) {
  const sx = clamp(x, 0, width - 1)
  const sy = clamp(y, 0, height - 1)
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = sx - x0
  const ty = sy - y0

  const idx00 = y0 * width + x0
  const idx10 = y0 * width + x1
  const idx01 = y1 * width + x0
  const idx11 = y1 * width + x1

  const top = lerp(Number(values[idx00] || 0), Number(values[idx10] || 0), tx)
  const bottom = lerp(Number(values[idx01] || 0), Number(values[idx11] || 0), tx)
  return lerp(top, bottom, ty)
}

export function renderMetricCanvas({
  metric,
  grid,
  outputWidth = grid.width,
  outputHeight = grid.height,
  contours = false,
}: RenderMetricCanvasOptions) {
  if (typeof document === 'undefined') {
    throw new Error('metric_canvas_requires_dom')
  }
  if (!grid || !grid.width || !grid.height || !grid.values || grid.values.length < grid.width * grid.height) {
    throw new Error('metric_grid_missing')
  }

  const { min, max, range } = resolveMetricRange(grid.values, grid.min, grid.max)
  const width = Math.max(1, Math.floor(outputWidth))
  const height = Math.max(1, Math.floor(outputHeight))
  const contourLevels = 16

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('metric_canvas_context_failed')

  const image = ctx.createImageData(width, height)
  const dst = image.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const idx = i * 4
      const sourceX = (x / Math.max(1, width - 1)) * (grid.width - 1)
      const sourceY = (y / Math.max(1, height - 1)) * (grid.height - 1)
      const raw = sampleBilinear(grid.values, grid.width, grid.height, sourceX, sourceY)
      const normalized = clamp((raw - min) / range, 0, 1)

      const [rBase, gBase, bBase] = sampleTopographyPalette(metric, normalized)
      let r = rBase
      let g = gBase
      let b = bBase

      if (contours) {
        const level = normalized * contourLevels
        const distToLevel = Math.abs(level - Math.round(level))
        if (distToLevel < 0.014) {
          const contourAlpha = distToLevel < 0.006 ? 0.22 : 0.12
          r = Math.round(lerp(r, 26, contourAlpha))
          g = Math.round(lerp(g, 40, contourAlpha))
          b = Math.round(lerp(b, 64, contourAlpha))
        }
      }

      dst[idx] = r
      dst[idx + 1] = g
      dst[idx + 2] = b
      dst[idx + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  return {
    canvas,
    range: { min, max },
  }
}

export function canvasToBase64Png(canvas: HTMLCanvasElement) {
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}

