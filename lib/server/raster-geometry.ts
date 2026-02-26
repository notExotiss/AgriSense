import type { BBox, GeoJsonPolygon } from '../types/api'

type LonLat = [number, number]

const EARTH_RADIUS_M = 6378137

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function toFiniteNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizePolygon(
  value: unknown
): GeoJsonPolygon | null {
  if (!value || typeof value !== 'object') return null
  const polygon = value as GeoJsonPolygon
  if (polygon.type !== 'Polygon' || !Array.isArray(polygon.coordinates) || !polygon.coordinates.length) return null

  const exterior = polygon.coordinates[0]
  if (!Array.isArray(exterior) || exterior.length < 4) return null

  const cleaned: LonLat[] = []
  for (const point of exterior) {
    if (!Array.isArray(point) || point.length < 2) continue
    const lon = toFiniteNumber(point[0])
    const lat = toFiniteNumber(point[1])
    if (lon == null || lat == null) continue
    cleaned.push([lon, lat])
  }
  if (cleaned.length < 4) return null

  const first = cleaned[0]
  const last = cleaned[cleaned.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) cleaned.push([first[0], first[1]])
  if (cleaned.length < 4) return null

  return {
    type: 'Polygon',
    coordinates: [cleaned],
  }
}

export function pointInPolygon(point: LonLat, ring: LonLat[]) {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / Math.max(1e-12, yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function clipLeft(points: LonLat[], xMin: number) {
  const result: LonLat[] = []
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const previous = points[(i + points.length - 1) % points.length]
    const currentInside = current[0] >= xMin
    const previousInside = previous[0] >= xMin
    if (currentInside) {
      if (!previousInside) {
        const t = (xMin - previous[0]) / Math.max(1e-12, current[0] - previous[0])
        result.push([xMin, previous[1] + t * (current[1] - previous[1])])
      }
      result.push(current)
    } else if (previousInside) {
      const t = (xMin - previous[0]) / Math.max(1e-12, current[0] - previous[0])
      result.push([xMin, previous[1] + t * (current[1] - previous[1])])
    }
  }
  return result
}

function clipRight(points: LonLat[], xMax: number) {
  const result: LonLat[] = []
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const previous = points[(i + points.length - 1) % points.length]
    const currentInside = current[0] <= xMax
    const previousInside = previous[0] <= xMax
    if (currentInside) {
      if (!previousInside) {
        const t = (xMax - previous[0]) / Math.max(1e-12, current[0] - previous[0])
        result.push([xMax, previous[1] + t * (current[1] - previous[1])])
      }
      result.push(current)
    } else if (previousInside) {
      const t = (xMax - previous[0]) / Math.max(1e-12, current[0] - previous[0])
      result.push([xMax, previous[1] + t * (current[1] - previous[1])])
    }
  }
  return result
}

function clipBottom(points: LonLat[], yMin: number) {
  const result: LonLat[] = []
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const previous = points[(i + points.length - 1) % points.length]
    const currentInside = current[1] >= yMin
    const previousInside = previous[1] >= yMin
    if (currentInside) {
      if (!previousInside) {
        const t = (yMin - previous[1]) / Math.max(1e-12, current[1] - previous[1])
        result.push([previous[0] + t * (current[0] - previous[0]), yMin])
      }
      result.push(current)
    } else if (previousInside) {
      const t = (yMin - previous[1]) / Math.max(1e-12, current[1] - previous[1])
      result.push([previous[0] + t * (current[0] - previous[0]), yMin])
    }
  }
  return result
}

function clipTop(points: LonLat[], yMax: number) {
  const result: LonLat[] = []
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const previous = points[(i + points.length - 1) % points.length]
    const currentInside = current[1] <= yMax
    const previousInside = previous[1] <= yMax
    if (currentInside) {
      if (!previousInside) {
        const t = (yMax - previous[1]) / Math.max(1e-12, current[1] - previous[1])
        result.push([previous[0] + t * (current[0] - previous[0]), yMax])
      }
      result.push(current)
    } else if (previousInside) {
      const t = (yMax - previous[1]) / Math.max(1e-12, current[1] - previous[1])
      result.push([previous[0] + t * (current[0] - previous[0]), yMax])
    }
  }
  return result
}

function closeRing(points: LonLat[]) {
  if (!points.length) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...points, [first[0], first[1]]]
  }
  return points
}

export function clipPolygonToRect(
  ring: LonLat[],
  rect: { minLon: number; minLat: number; maxLon: number; maxLat: number }
) {
  if (!ring.length) return []
  let points = ring.slice()
  if (points.length > 1) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first[0] === last[0] && first[1] === last[1]) points = points.slice(0, -1)
  }
  if (!points.length) return []
  points = clipLeft(points, rect.minLon)
  points = clipRight(points, rect.maxLon)
  points = clipBottom(points, rect.minLat)
  points = clipTop(points, rect.maxLat)
  if (points.length < 3) return []
  return closeRing(points)
}

export function pixelCenterLonLat(bbox: BBox, width: number, height: number, x: number, y: number): LonLat {
  const pixelWidth = (bbox[2] - bbox[0]) / Math.max(1, width)
  const pixelHeight = (bbox[3] - bbox[1]) / Math.max(1, height)
  const lon = bbox[0] + (x + 0.5) * pixelWidth
  const lat = bbox[3] - (y + 0.5) * pixelHeight
  return [lon, lat]
}

export function buildAoiMask(
  bbox: BBox,
  width: number,
  height: number,
  geometry?: GeoJsonPolygon | null
) {
  const total = Math.max(1, width * height)
  if (!geometry?.coordinates?.[0]?.length) {
    return {
      mask: null as Uint8Array | null,
      applied: false,
      coveredPixelRatio: 1,
    }
  }

  const ring = geometry.coordinates[0] as LonLat[]
  const mask = new Uint8Array(total)
  let inside = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const point = pixelCenterLonLat(bbox, width, height, x, y)
      if (pointInPolygon(point, ring)) {
        mask[idx] = 1
        inside += 1
      }
    }
  }

  return {
    mask,
    applied: true,
    coveredPixelRatio: inside / total,
  }
}

export function approxPixelSizeMeters(bbox: BBox, width: number, height: number) {
  const lonStep = Math.abs(bbox[2] - bbox[0]) / Math.max(1, width)
  const latStep = Math.abs(bbox[3] - bbox[1]) / Math.max(1, height)
  const latMid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const metersPerDegLat = (Math.PI * EARTH_RADIUS_M) / 180
  const metersPerDegLon = metersPerDegLat * Math.cos(latMid)
  const xMeters = lonStep * metersPerDegLon
  const yMeters = latStep * metersPerDegLat
  return Math.max(0.1, (xMeters + yMeters) / 2)
}

export function deriveAlignment(bbox: BBox, width: number, height: number) {
  return {
    bbox,
    crs: 'EPSG:4326' as const,
    width,
    height,
    pixelSizeLon: Math.abs(bbox[2] - bbox[0]) / Math.max(1, width),
    pixelSizeLat: Math.abs(bbox[3] - bbox[1]) / Math.max(1, height),
    pixelSizeMetersApprox: approxPixelSizeMeters(bbox, width, height),
  }
}

export function lonLatToUv(bbox: BBox, lon: number, lat: number) {
  const u = (lon - bbox[0]) / Math.max(1e-12, bbox[2] - bbox[0])
  const v = (bbox[3] - lat) / Math.max(1e-12, bbox[3] - bbox[1])
  return {
    u: clamp(u, 0, 1),
    v: clamp(v, 0, 1),
  }
}

