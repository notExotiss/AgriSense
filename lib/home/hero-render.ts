import { PNG } from 'pngjs'
import { TOPO_PALETTES, clamp, sampleTopographyPalette } from '../visual/topography'

export type HeroLegendStop = {
  value: number
  color: [number, number, number]
}

export type HeroLegend = {
  metric: 'ndvi'
  min: number
  max: number
  unit: 'NDVI'
  stops: HeroLegendStop[]
}

export type HeroMapRenderInput = {
  values: number[]
  width: number
  height: number
  min: number
  max: number
}

export type HeroMapRenderResult = {
  outlinePng: string
  topoPng: string
  legend: HeroLegend
}

function round(value: number, precision = 4) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function smoothGrid(
  rawValues: number[],
  width: number,
  height: number,
  passes = 3
) {
  const size = width * height
  const base = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    const value = Number(rawValues[i])
    base[i] = Number.isFinite(value) ? value : 0
  }

  if (passes <= 0 || width < 3 || height < 3) return base

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < base.length; i++) {
    const value = base[i]
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 1
  }
  const preserveDelta = Math.max(0.02, (max - min) * 0.12)
  let current = base

  for (let pass = 0; pass < passes; pass++) {
    const horizontal = new Float32Array(size)
    const vertical = new Float32Array(size)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const left = current[y * width + Math.max(0, x - 1)]
        const center = current[idx]
        const right = current[y * width + Math.min(width - 1, x + 1)]
        horizontal[idx] = left * 0.22 + center * 0.56 + right * 0.22
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x
        const up = horizontal[Math.max(0, y - 1) * width + x]
        const center = horizontal[idx]
        const down = horizontal[Math.min(height - 1, y + 1) * width + x]
        const blurred = up * 0.22 + center * 0.56 + down * 0.22
        const original = base[idx]
        vertical[idx] = clamp(blurred, original - preserveDelta, original + preserveDelta)
      }
    }

    current = vertical
  }

  return current
}

function normalizeValues(values: ArrayLike<number>, min: number, max: number) {
  const range = Math.max(1e-6, max - min)
  const normalized = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    normalized[i] = clamp((values[i] - min) / range, 0, 1)
  }
  return normalized
}

function observeRange(values: ArrayLike<number>, fallbackMin: number, fallbackMax: number) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i])
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) {
    return {
      min: Number.isFinite(fallbackMin) ? fallbackMin : 0,
      max: Number.isFinite(fallbackMax) && fallbackMax > fallbackMin ? fallbackMax : 1,
    }
  }
  return { min, max }
}

function valueAt(values: ArrayLike<number>, width: number, height: number, x: number, y: number) {
  const sx = Math.max(0, Math.min(width - 1, x))
  const sy = Math.max(0, Math.min(height - 1, y))
  return values[sy * width + sx]
}

function writePngBase64(
  width: number,
  height: number,
  paint: (idx: number, x: number, y: number) => [number, number, number, number]
) {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const out = idx * 4
      const [r, g, b, a] = paint(idx, x, y)
      png.data[out] = r
      png.data[out + 1] = g
      png.data[out + 2] = b
      png.data[out + 3] = a
    }
  }
  return PNG.sync.write(png).toString('base64')
}

export function buildHeroTextures(input: HeroMapRenderInput): HeroMapRenderResult {
  const width = Math.max(8, Number(input.width))
  const height = Math.max(8, Number(input.height))
  const smoothed = smoothGrid(input.values, width, height, 3)
  const observedRange = observeRange(smoothed, input.min, input.max)
  const normalized = normalizeValues(smoothed, observedRange.min, observedRange.max)
  const contourLevels = 20

  const outlinePng = writePngBase64(width, height, (idx, x, y) => {
    const value = normalized[idx]
    const right = valueAt(normalized, width, height, x + 1, y)
    const left = valueAt(normalized, width, height, x - 1, y)
    const up = valueAt(normalized, width, height, x, y - 1)
    const down = valueAt(normalized, width, height, x, y + 1)
    const slopeX = right - left
    const slopeY = down - up
    const shade = clamp(0.84 - slopeX * 0.34 - slopeY * 0.32, 0.36, 1.14)
    const contourDistance = Math.abs(value * contourLevels - Math.round(value * contourLevels))
    const contour = contourDistance < 0.036

    const gray = Math.round(clamp(145 * shade + 36, 0, 255))
    if (contour) {
      const contourStrength = contourDistance < 0.015 ? 0.56 : 0.34
      const blue = Math.round(102 * contourStrength)
      return [
        Math.round(gray * (1 - contourStrength * 0.36)),
        Math.round(gray * (1 - contourStrength * 0.24)),
        Math.round(gray * (1 - contourStrength * 0.1) + blue),
        255,
      ]
    }

    return [gray, gray, gray, 255]
  })

  const topoPng = writePngBase64(width, height, (idx, x, y) => {
    const value = normalized[idx]
    const right = valueAt(normalized, width, height, x + 1, y)
    const left = valueAt(normalized, width, height, x - 1, y)
    const up = valueAt(normalized, width, height, x, y - 1)
    const down = valueAt(normalized, width, height, x, y + 1)
    const slopeX = right - left
    const slopeY = down - up
    const slopeMagnitude = Math.sqrt(slopeX * slopeX + slopeY * slopeY)
    const relief = clamp(1 - slopeMagnitude * 0.18, 0.9, 1.1)
    const [rBase, gBase, bBase] = sampleTopographyPalette('ndvi', value)

    let r = Math.round(clamp(rBase * relief, 0, 255))
    let g = Math.round(clamp(gBase * relief, 0, 255))
    let b = Math.round(clamp(bBase * relief, 0, 255))

    const contourDistance = Math.abs(value * contourLevels - Math.round(value * contourLevels))
    const contour = contourDistance < 0.024
    if (contour) {
      const alpha = contourDistance < 0.01 ? 0.56 : 0.36
      r = Math.round((1 - alpha) * r + alpha * 10)
      g = Math.round((1 - alpha) * g + alpha * 20)
      b = Math.round((1 - alpha) * b + alpha * 44)
    }

    return [r, g, b, 255]
  })

  const stops = TOPO_PALETTES.ndvi.map((stop) => ({
    value: round(observedRange.min + (observedRange.max - observedRange.min) * stop.stop, 4),
    color: stop.color,
  }))

  return {
    outlinePng,
    topoPng,
    legend: {
      metric: 'ndvi',
      min: round(observedRange.min, 4),
      max: round(observedRange.max, 4),
      unit: 'NDVI',
      stops,
    },
  }
}
