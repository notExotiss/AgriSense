type Coordinate = [number, number]
type Polygon = {
  type: 'Polygon'
  coordinates: Coordinate[][]
}

export type SerializedGeometry = {
  geojsonText: string
  bbox: [number, number, number, number]
  centroid: [number, number]
  ringsFlat: number[]
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function asCoordinate(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const lon = Number(value[0])
  const lat = Number(value[1])
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) return null
  return [lon, lat]
}

function normalizeRing(value: unknown): Coordinate[] {
  if (!Array.isArray(value)) return []
  return value
    .map(asCoordinate)
    .filter((point): point is Coordinate => Array.isArray(point) && point.length === 2)
}

function validateClosedRing(ring: Coordinate[]) {
  if (ring.length < 4) return false
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first[0] === last[0] && first[1] === last[1]
}

function ringBBox(ring: Coordinate[]) {
  let minLon = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLon = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon)
    minLat = Math.min(minLat, lat)
    maxLon = Math.max(maxLon, lon)
    maxLat = Math.max(maxLat, lat)
  }
  return [minLon, minLat, maxLon, maxLat] as [number, number, number, number]
}

function ringCentroid(ring: Coordinate[]) {
  const deduped = ring.slice(0, -1)
  const total = Math.max(1, deduped.length)
  const sum = deduped.reduce(
    (acc, point) => {
      acc.lon += point[0]
      acc.lat += point[1]
      return acc
    },
    { lon: 0, lat: 0 }
  )
  return [sum.lon / total, sum.lat / total] as [number, number]
}

function flattenRing(ring: Coordinate[]) {
  const flat: number[] = []
  for (const [lon, lat] of ring) {
    flat.push(Number(lon.toFixed(7)), Number(lat.toFixed(7)))
    if (flat.length >= 1024) break
  }
  return flat
}

export function serializePolygonGeometry(value: unknown): SerializedGeometry {
  let polygon: Polygon | null = null

  if (typeof value === 'string') {
    try {
      polygon = JSON.parse(value) as Polygon
    } catch {
      throw new Error('invalid_geometry')
    }
  } else if (value && typeof value === 'object') {
    polygon = value as Polygon
  }

  if (!polygon || polygon.type !== 'Polygon' || !Array.isArray(polygon.coordinates) || !polygon.coordinates.length) {
    throw new Error('invalid_geometry')
  }

  const exterior = normalizeRing(polygon.coordinates[0])
  if (!validateClosedRing(exterior)) throw new Error('invalid_geometry')

  const bbox = ringBBox(exterior)
  const centroid = ringCentroid(exterior)
  if (bbox.some((n) => !isFiniteNumber(n)) || centroid.some((n) => !isFiniteNumber(n))) {
    throw new Error('invalid_geometry')
  }

  const normalized: Polygon = {
    type: 'Polygon',
    coordinates: [exterior],
  }

  return {
    geojsonText: JSON.stringify(normalized),
    bbox,
    centroid,
    ringsFlat: flattenRing(exterior),
  }
}

export function decodePolygonGeometry(value: unknown): Polygon | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed?.type === 'Polygon' && Array.isArray(parsed?.coordinates)) return parsed as Polygon
      return null
    } catch {
      return null
    }
  }
  if (typeof value === 'object' && (value as any)?.type === 'Polygon' && Array.isArray((value as any)?.coordinates)) {
    return value as Polygon
  }
  return null
}

export function deriveBboxFromPolygon(value: unknown): [number, number, number, number] | null {
  const polygon = decodePolygonGeometry(value)
  const ring = normalizeRing(polygon?.coordinates?.[0] || [])
  if (!validateClosedRing(ring)) return null
  return ringBBox(ring)
}
