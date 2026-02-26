import { clamp, lerp } from '../visual/topography'
import type { BBox } from '../types/api'

export type BuiltHeightGrid = {
  planeWidth: number
  planeHeight: number
  scaledHeight: Float32Array
  elevationScale: number
  reliefMeters: number
  exaggeration: number
  clippedMin: number
  clippedMax: number
  metersPerUnit: number
}

function quantile(values: number[], q: number) {
  if (!values.length) return 0
  if (values.length === 1) return values[0]
  const index = (values.length - 1) * clamp(q, 0, 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return values[lower]
  return lerp(values[lower], values[upper], index - lower)
}

function spanMetersFromBbox(bbox: BBox) {
  const lonSpan = Math.abs(bbox[2] - bbox[0])
  const latSpan = Math.abs(bbox[3] - bbox[1])
  const latMid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const metersPerDegLat = 111320
  const metersPerDegLon = Math.max(1, Math.cos(latMid) * 111320)
  const xMeters = lonSpan * metersPerDegLon
  const yMeters = latSpan * metersPerDegLat
  return {
    xMeters: Math.max(1, xMeters),
    yMeters: Math.max(1, yMeters),
  }
}

function computePlaneDimensions(bbox: BBox, maxSize = 120) {
  const span = spanMetersFromBbox(bbox)
  const ratio = span.xMeters / Math.max(1, span.yMeters)
  if (ratio >= 1) {
    return {
      planeWidth: maxSize,
      planeHeight: clamp(maxSize / ratio, maxSize * 0.42, maxSize),
      span,
    }
  }
  return {
    planeWidth: clamp(maxSize * ratio, maxSize * 0.42, maxSize),
    planeHeight: maxSize,
    span,
  }
}

export function buildScaledHeightGrid(input: {
  demGrid: number[]
  width: number
  height: number
  bbox: BBox
}): BuiltHeightGrid {
  const finite = input.demGrid.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!finite.length) throw new Error('dem_no_finite_values')

  const q005 = quantile(finite, 0.005)
  const q995 = quantile(finite, 0.995)
  const clippedMin = Math.min(q005, q995)
  const clippedMax = Math.max(q005, q995)
  const reliefMeters = Math.max(0.25, clippedMax - clippedMin)

  const { planeWidth, planeHeight, span } = computePlaneDimensions(input.bbox, 120)
  const metersPerUnit = Math.max(1e-6, Math.max(span.xMeters / planeWidth, span.yMeters / planeHeight))

  // Keep terrain physically plausible, but ensure relief is visibly 3D at broad AOI extents.
  const minPlane = Math.min(planeWidth, planeHeight)
  const nativeReliefUnits = Math.max(0.05, reliefMeters / metersPerUnit)
  let exaggeration = 1.12

  if (nativeReliefUnits >= minPlane * 0.18) {
    exaggeration = 1
  } else if (nativeReliefUnits >= minPlane * 0.12) {
    exaggeration = 1.08
  } else {
    const targetReliefUnits = clamp(minPlane * 0.22, 14, 36)
    const maxExaggeration =
      reliefMeters >= 1200 ? 14 :
      reliefMeters >= 400 ? 12 :
      reliefMeters >= 120 ? 10 : 8
    exaggeration = clamp(targetReliefUnits / nativeReliefUnits, 1.15, maxExaggeration)
  }

  if (nativeReliefUnits < 0.35) {
    exaggeration = Math.max(exaggeration, 6.5)
  } else if (nativeReliefUnits < 0.7) {
    exaggeration = Math.max(exaggeration, 4.2)
  }

  const scaledHeight = new Float32Array(input.width * input.height)
  let maxScaled = 0
  for (let i = 0; i < scaledHeight.length; i++) {
    const value = Number(input.demGrid[i])
    const finiteValue = Number.isFinite(value) ? value : clippedMin
    const clipped = clamp(finiteValue, clippedMin, clippedMax)
    const metersAboveBase = clipped - clippedMin
    const units = (metersAboveBase / metersPerUnit) * exaggeration
    scaledHeight[i] = units
    if (units > maxScaled) maxScaled = units
  }

  return {
    planeWidth,
    planeHeight,
    scaledHeight,
    elevationScale: Math.max(1.25, maxScaled),
    reliefMeters,
    exaggeration,
    clippedMin,
    clippedMax,
    metersPerUnit,
  }
}
