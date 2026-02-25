import { PNG } from 'pngjs'
import type { MLFeatureVector, MLInput, ZoneCluster } from './types'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function distance(a: number[], b: number[]) {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

function seededRandom(seedInput: string) {
  let seed = 0
  for (let i = 0; i < seedInput.length; i++) seed = (seed << 5) - seed + seedInput.charCodeAt(i)
  return () => {
    seed ^= seed << 13
    seed ^= seed >> 17
    seed ^= seed << 5
    return Math.abs(seed % 1000000) / 1000000
  }
}

function runKMeans(points: number[][], k = 3, iterations = 14): ZoneCluster[] {
  if (!points.length) return []
  const centroidCount = Math.min(k, points.length)
  const centroids = points.slice(0, centroidCount).map((point) => [...point])
  const assignments = new Array(points.length).fill(0)

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < points.length; i++) {
      let bestIdx = 0
      let bestDistance = Number.POSITIVE_INFINITY
      for (let c = 0; c < centroids.length; c++) {
        const d = distance(points[i], centroids[c])
        if (d < bestDistance) {
          bestDistance = d
          bestIdx = c
        }
      }
      assignments[i] = bestIdx
    }

    for (let c = 0; c < centroids.length; c++) {
      const members = points.filter((_, idx) => assignments[idx] === c)
      if (!members.length) continue
      const dims = centroids[c].length
      const next = new Array(dims).fill(0)
      for (const member of members) {
        for (let dim = 0; dim < dims; dim++) next[dim] += member[dim]
      }
      for (let dim = 0; dim < dims; dim++) next[dim] /= members.length
      centroids[c] = next
    }
  }

  return centroids.map((centroid, idx) => ({
    id: idx,
    count: assignments.filter((assigned) => assigned === idx).length,
    centroid: centroid.map((value) => Number(value.toFixed(4))),
  }))
}

function extractRasterPointsFromPng(base64Png: string, features: MLFeatureVector) {
  const buffer = Buffer.from(base64Png, 'base64')
  const image = PNG.sync.read(buffer)
  const strideX = Math.max(1, Math.floor(image.width / 24))
  const strideY = Math.max(1, Math.floor(image.height / 24))
  const points: number[][] = []

  for (let y = 0; y < image.height; y += strideY) {
    for (let x = 0; x < image.width; x += strideX) {
      const idx = (y * image.width + x) * 4
      const r = image.data[idx]
      const g = image.data[idx + 1]
      const b = image.data[idx + 2]
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      points.push([
        clamp(luminance, 0, 1),
        x / Math.max(1, image.width - 1),
        y / Math.max(1, image.height - 1),
        clamp(features.soilMoistureMean, 0, 1),
        clamp(features.etMean / 10, 0, 1),
      ])
    }
  }

  return points
}

function buildSyntheticPoints(features: MLFeatureVector) {
  const random = seededRandom(`${features.ndviMean}:${features.ndviSpread}:${features.soilMoistureMean}:${features.etMean}`)
  const points: number[][] = []
  for (let i = 0; i < 180; i++) {
    const x = random()
    const y = random()
    const canopy = clamp(features.ndviMean + (random() - 0.5) * features.ndviSpread, -0.1, 0.95)
    const moisture = clamp(features.soilMoistureMean + (random() - 0.5) * 0.1, 0, 1)
    const et = clamp(features.etMean / 10 + (random() - 0.5) * 0.15, 0, 1)
    points.push([canopy, x, y, moisture, et])
  }
  return points
}

export function computeZoneClusters(input: MLInput, features: MLFeatureVector) {
  const preview =
    input?.ndviData?.previewPng ||
    input?.context?.ndvi?.previewPng ||
    input?.context?.ndviPreviewPng ||
    ''

  let points: number[][] = []
  if (preview) {
    try {
      points = extractRasterPointsFromPng(preview, features)
    } catch {
      points = []
    }
  }
  if (!points.length) points = buildSyntheticPoints(features)

  return runKMeans(points, 3, 12)
}

