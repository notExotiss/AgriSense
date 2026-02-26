import { clamp, lerp, sampleTopographyPalette, type LayerMetric } from './topography'

export type MetricGridInput = {
  values: ArrayLike<number>
  validMask?: ArrayLike<number> | null
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

function quantile(sortedValues: number[], q: number) {
  if (!sortedValues.length) return Number.NaN
  if (sortedValues.length === 1) return sortedValues[0]
  const position = clamp(q, 0, 1) * (sortedValues.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sortedValues[lower]
  const weight = position - lower
  return lerp(sortedValues[lower], sortedValues[upper], weight)
}

function resolveDisplayRange(
  values: ArrayLike<number>,
  validMask: ArrayLike<number> | null | undefined,
  min: number,
  max: number
) {
  const sampleLimit = 8192
  const stride = Math.max(1, Math.floor(values.length / sampleLimit))
  const sample: number[] = []

  for (let i = 0; i < values.length; i += stride) {
    if (validMask && Number(validMask[i]) <= 0) continue
    const value = Number(values[i])
    if (!Number.isFinite(value)) continue
    sample.push(value)
  }

  if (sample.length < 64) {
    return { min, max, range: Math.max(1e-6, max - min) }
  }

  sample.sort((a, b) => a - b)
  const q10 = quantile(sample, 0.1)
  const q90 = quantile(sample, 0.9)
  if (!Number.isFinite(q10) || !Number.isFinite(q90) || q90 <= q10) {
    return { min, max, range: Math.max(1e-6, max - min) }
  }

  const baseRange = Math.max(1e-6, max - min)
  const blendedMin = lerp(min, q10, 0.42)
  const blendedMax = lerp(max, q90, 0.42)
  const minRange = baseRange * 0.22
  if (!Number.isFinite(blendedMin) || !Number.isFinite(blendedMax) || blendedMax - blendedMin < minRange) {
    return { min, max, range: baseRange }
  }

  return {
    min: blendedMin,
    max: blendedMax,
    range: Math.max(1e-6, blendedMax - blendedMin),
  }
}

function sampleBilinear(
  values: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  validMask?: ArrayLike<number> | null
) {
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

  const samples = [
    { idx: idx00, weight: (1 - tx) * (1 - ty) },
    { idx: idx10, weight: tx * (1 - ty) },
    { idx: idx01, weight: (1 - tx) * ty },
    { idx: idx11, weight: tx * ty },
  ]

  let weighted = 0
  let weightSum = 0

  for (const sample of samples) {
    const maskOk = !validMask || Number(validMask[sample.idx]) > 0
    if (!maskOk) continue
    const value = Number(values[sample.idx])
    if (!Number.isFinite(value)) continue
    weighted += value * sample.weight
    weightSum += sample.weight
  }

  if (weightSum <= 1e-9) return Number.NaN
  return weighted / weightSum
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

  const resolvedRange = resolveMetricRange(grid.values, grid.min, grid.max)
  const { min, max, range } = resolveDisplayRange(
    grid.values,
    grid.validMask,
    resolvedRange.min,
    resolvedRange.max
  )
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
      const raw = sampleBilinear(grid.values, grid.width, grid.height, sourceX, sourceY, grid.validMask)
      if (!Number.isFinite(raw)) {
        dst[idx] = 0
        dst[idx + 1] = 0
        dst[idx + 2] = 0
        dst[idx + 3] = 0
        continue
      }
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
