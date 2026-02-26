import { clamp } from '../visual/topography'
import type { TerrainZStats } from '../types/api'

export type DemNormalizationInput = {
  demGrid: number[]
  width: number
  height: number
  plausibleMinMeters?: number
  plausibleMaxMeters?: number
}

export type DemNormalizationOutput = {
  demGrid: number[]
  validRatio: number
  voidFillRatio: number
  clampApplied: boolean
  zStats: TerrainZStats
}

function quantile(sortedValues: number[], q: number) {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const index = (sortedValues.length - 1) * clamp(q, 0, 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sortedValues[lower]
  const t = index - lower
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * t
}

function isPlausibleElevation(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max
}

function rounded(value: number, precision = 3) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

export function normalizeDemGrid(input: DemNormalizationInput): DemNormalizationOutput {
  const plausibleMin = Number.isFinite(input.plausibleMinMeters) ? Number(input.plausibleMinMeters) : -650
  const plausibleMax = Number.isFinite(input.plausibleMaxMeters) ? Number(input.plausibleMaxMeters) : 9500
  const total = Math.max(1, input.width * input.height)
  const grid = input.demGrid.slice(0, total)
  while (grid.length < total) grid.push(Number.NaN)

  const finite = grid.filter((value) => isPlausibleElevation(Number(value), plausibleMin, plausibleMax))
  if (!finite.length) throw new Error('dem_no_valid_pixels')
  finite.sort((a, b) => a - b)

  const q002 = quantile(finite, 0.002)
  const q998 = quantile(finite, 0.998)
  const median = quantile(finite, 0.5)
  const q05Base = quantile(finite, 0.05)
  const q95Base = quantile(finite, 0.95)

  let clampApplied = false
  let invalidCount = 0
  for (let i = 0; i < total; i++) {
    const value = Number(grid[i])
    if (!isPlausibleElevation(value, plausibleMin, plausibleMax)) {
      grid[i] = Number.NaN
      invalidCount += 1
      continue
    }
    const clipped = clamp(value, q002, q998)
    if (Math.abs(clipped - value) > 1e-9) clampApplied = true
    grid[i] = clipped
  }

  const beforeFillInvalid = invalidCount
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    for (let y = 0; y < input.height; y++) {
      for (let x = 0; x < input.width; x++) {
        const idx = y * input.width + x
        if (Number.isFinite(grid[idx])) continue
        let sum = 0
        let count = 0
        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
          [x - 1, y - 1],
          [x + 1, y - 1],
          [x - 1, y + 1],
          [x + 1, y + 1],
        ]
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= input.width || ny >= input.height) continue
          const sample = Number(grid[ny * input.width + nx])
          if (!Number.isFinite(sample)) continue
          sum += sample
          count += 1
        }
        if (count > 0) {
          grid[idx] = sum / count
          changed = true
          invalidCount -= 1
        }
      }
    }
    if (!changed) break
  }

  for (let i = 0; i < total; i++) {
    if (Number.isFinite(grid[i])) continue
    grid[i] = median
    invalidCount -= 1
  }

  const finalSorted = grid.slice().sort((a, b) => a - b)
  const zMin = finalSorted[0]
  const zMax = finalSorted[finalSorted.length - 1]
  const zP05 = quantile(finalSorted, 0.05)
  const zP95 = quantile(finalSorted, 0.95)

  return {
    demGrid: grid.map((value) => rounded(value, 2)),
    validRatio: rounded((total - beforeFillInvalid) / total, 4),
    voidFillRatio: rounded(beforeFillInvalid / total, 4),
    clampApplied,
    zStats: {
      zMin: rounded(zMin, 2),
      zMax: rounded(zMax, 2),
      zP05: rounded(Number.isFinite(zP05) ? zP05 : q05Base, 2),
      zP95: rounded(Number.isFinite(zP95) ? zP95 : q95Base, 2),
    },
  }
}
