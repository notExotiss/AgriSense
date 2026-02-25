import type { GeoJsonPolygon, GridCellSummary, PlotItem } from '../types/api'

function decodeGeojsonText(value: unknown): GeoJsonPolygon | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    if (parsed?.type === 'Polygon' && Array.isArray(parsed?.coordinates)) return parsed as GeoJsonPolygon
  } catch {
    return null
  }
  return null
}

export function deriveBboxFromGeojson(geojson: GeoJsonPolygon | null | undefined): [number, number, number, number] | null {
  const ring = geojson?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return null

  let minLon = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLon = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue
    const lon = Number(point[0])
    const lat = Number(point[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    minLon = Math.min(minLon, lon)
    minLat = Math.min(minLat, lat)
    maxLon = Math.max(maxLon, lon)
    maxLat = Math.max(maxLat, lat)
  }

  if (!Number.isFinite(minLon)) return null
  return [minLon, minLat, maxLon, maxLat]
}

export function parsePlotShape(item: PlotItem | any) {
  const geojson = (item?.geojson as GeoJsonPolygon | null) || decodeGeojsonText(item?.geojsonText)
  const bbox = (Array.isArray(item?.bbox) && item.bbox.length === 4 ? item.bbox : deriveBboxFromGeojson(geojson)) as
    | [number, number, number, number]
    | null
  const grid3x3 = Array.isArray(item?.grid3x3) ? (item.grid3x3 as GridCellSummary[]) : []

  return {
    geojson: geojson || null,
    bbox,
    grid3x3,
  }
}
