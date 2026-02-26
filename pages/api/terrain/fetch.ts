import type { NextApiRequest, NextApiResponse } from 'next'
import type {
  GeoJsonPolygon,
  ProviderDiagnostic,
  TerrainFetchResponse,
  TerrainPrecisionClass,
  TerrainQuality,
  TerrainVerticalScaleMode,
} from '../../../lib/types/api'
import { buildAoiMask, normalizePolygon } from '../../../lib/server/raster-geometry'
import { fetchTerrainFromProviders, type TerrainProviderResult } from '../../../lib/terrain/providers'
import { normalizeDemGrid } from '../../../lib/terrain/normalize'

type TerrainError = {
  error: string
  message: string
  reason?: string
  providersTried?: ProviderDiagnostic[]
}

type ParsedBody = {
  bbox: [number, number, number, number]
  geometry: GeoJsonPolygon | null
  resolution: number
  quality: TerrainQuality
  verticalScaleMode: TerrainVerticalScaleMode
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, precision = 3) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function parseBody(body: any): ParsedBody {
  const bbox = Array.isArray(body?.bbox) ? body.bbox.map(Number) : []
  if (bbox.length !== 4 || bbox.some((n: number) => Number.isNaN(n))) throw new Error('bbox_required')
  if (!(bbox[2] > bbox[0]) || !(bbox[3] > bbox[1])) throw new Error('bbox_required')

  const quality: TerrainQuality =
    body?.quality === 'light' || body?.quality === 'balanced' || body?.quality === 'high'
      ? body.quality
      : 'balanced'
  const defaultResolution = quality === 'high' ? 224 : quality === 'balanced' ? 176 : 128
  const requested = Number(body?.resolution)
  const resolution = Number.isFinite(requested) ? clamp(Math.round(requested), 64, 320) : defaultResolution

  const verticalScaleMode: TerrainVerticalScaleMode =
    body?.verticalScaleMode === 'reliefAssist' ? 'reliefAssist' : 'true'

  const geometry = body?.geometry ? normalizePolygon(body.geometry) : null
  if (body?.geometry && !geometry) throw new Error('invalid_geometry')

  return {
    bbox: bbox as [number, number, number, number],
    geometry,
    resolution,
    quality,
    verticalScaleMode,
  }
}

function approxPixelSizeMeters(bbox: [number, number, number, number], width: number, height: number) {
  const lonStep = Math.abs(bbox[2] - bbox[0]) / Math.max(1, width)
  const latStep = Math.abs(bbox[3] - bbox[1]) / Math.max(1, height)
  const latMid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const metersPerDegLat = 111320
  const metersPerDegLon = Math.max(1, Math.cos(latMid) * 111320)
  return (lonStep * metersPerDegLon + latStep * metersPerDegLat) / 2
}

function spanMeters(bbox: [number, number, number, number]) {
  const lonSpan = Math.abs(bbox[2] - bbox[0])
  const latSpan = Math.abs(bbox[3] - bbox[1])
  const latMid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const metersPerDegLat = 111320
  const metersPerDegLon = Math.max(1, Math.cos(latMid) * 111320)
  return Math.max(lonSpan * metersPerDegLon, latSpan * metersPerDegLat)
}

function computePrecisionClass(
  effectiveResolutionMeters: number,
  bbox: [number, number, number, number]
): TerrainPrecisionClass {
  let precision: TerrainPrecisionClass =
    effectiveResolutionMeters <= 12 ? 'high' : effectiveResolutionMeters <= 35 ? 'medium' : 'low'

  const footprintMeters = spanMeters(bbox)
  if (footprintMeters < 250 && effectiveResolutionMeters > 10) {
    precision = precision === 'high' ? 'medium' : 'low'
  }
  return precision
}

function computeCoverage(bbox: [number, number, number, number], width: number, height: number, geometry: GeoJsonPolygon | null) {
  const mask = buildAoiMask(bbox, width, height, geometry)
  return round(mask.coveredPixelRatio, 4)
}

function toSuccessResponse(params: {
  parsed: ParsedBody
  provider: TerrainProviderResult
  providersTried: ProviderDiagnostic[]
}): TerrainFetchResponse {
  const normalized = normalizeDemGrid({
    demGrid: params.provider.demGrid,
    width: params.provider.width,
    height: params.provider.height,
  })
  const pixelSizeMeters = round(
    approxPixelSizeMeters(params.provider.bbox, params.provider.width, params.provider.height),
    2
  )
  const effectiveResolutionMeters = round(params.provider.effectiveResolutionMeters || pixelSizeMeters, 2)
  const precisionClass = computePrecisionClass(effectiveResolutionMeters, params.provider.bbox)
  const coverage = computeCoverage(
    params.provider.bbox,
    params.provider.width,
    params.provider.height,
    params.parsed.geometry
  )

  const warnings = [...params.provider.warnings]
  if (normalized.voidFillRatio > 0.08) {
    warnings.push(
      `DEM had missing pixels; filled ${(normalized.voidFillRatio * 100).toFixed(1)}% voids for continuity.`
    )
  }
  if (precisionClass === 'low') {
    warnings.push(
      `Terrain resolution is coarse for small-plot certainty (~${effectiveResolutionMeters.toFixed(1)}m/pixel).`
    )
  }

  return {
    success: true,
    source: params.provider.demSource,
    demSource: params.provider.demSource,
    demDataset: params.provider.demDataset,
    modelType: params.provider.modelType,
    verticalDatum: params.provider.verticalDatum,
    sourceResolutionMeters: round(params.provider.sourceResolutionMeters, 2),
    effectiveResolutionMeters,
    precisionClass,
    voidFillRatio: normalized.voidFillRatio,
    zStats: normalized.zStats,
    providerResolutionMeters: round(params.provider.sourceResolutionMeters, 2),
    pixelSizeMeters,
    coverage,
    meshMeta: {
      smoothed: false,
      resolution: params.parsed.resolution,
    },
    warnings,
    providersTried: params.providersTried,
    data: {
      demGrid: normalized.demGrid,
      width: params.provider.width,
      height: params.provider.height,
      bbox: params.provider.bbox,
      source: params.provider.demSource,
      isSimulated: false,
      texturePng: null,
      providerResolutionMeters: round(params.provider.sourceResolutionMeters, 2),
      pixelSizeMeters,
      coverage,
      demSource: params.provider.demSource,
      demDataset: params.provider.demDataset,
      modelType: params.provider.modelType,
      verticalDatum: params.provider.verticalDatum,
      sourceResolutionMeters: round(params.provider.sourceResolutionMeters, 2),
      effectiveResolutionMeters,
      precisionClass,
      voidFillRatio: normalized.voidFillRatio,
      zStats: normalized.zStats,
    },
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<TerrainFetchResponse | TerrainError>) {
  if (req.method !== 'POST') return res.status(405).end()

  let parsed: ParsedBody
  try {
    parsed = parseBody(req.body || {})
  } catch (error: any) {
    return res.status(400).json({
      error: error?.message === 'invalid_geometry' ? 'invalid_geometry' : 'bbox_required',
      message:
        error?.message === 'invalid_geometry'
          ? 'AOI geometry must be a valid GeoJSON Polygon.'
          : 'Bounding box [minLon,minLat,maxLon,maxLat] is required.',
    })
  }

  try {
    const openTopoApiKey = process.env.OPENTOPO_API_KEY || process.env.OPEN_TOPOGRAPHY_API_KEY || ''
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_CLOUD_MAPS_API_KEY || ''
    const chain = await fetchTerrainFromProviders({
      bbox: parsed.bbox,
      resolution: parsed.resolution,
      openTopoApiKey,
      googleMapsApiKey,
    })
    const payload = toSuccessResponse({
      parsed,
      provider: chain.result,
      providersTried: chain.providersTried,
    })
    return res.status(200).json(payload)
  } catch (error: any) {
    const providersTried = Array.isArray(error?.providersTried) ? error.providersTried : []
    return res.status(200).json({
      success: true,
      degraded: true,
      reason: 'terrain_unavailable',
      source: 'terrain-unavailable',
      demSource: 'terrain-unavailable',
      demDataset: 'none',
      modelType: 'DTM',
      verticalDatum: 'n/a',
      sourceResolutionMeters: 0,
      effectiveResolutionMeters: 0,
      precisionClass: 'low',
      voidFillRatio: 0,
      zStats: { zMin: 0, zMax: 0, zP05: 0, zP95: 0 },
      providerResolutionMeters: 0,
      pixelSizeMeters: 0,
      coverage: 0,
      meshMeta: {
        smoothed: false,
        resolution: parsed.resolution,
      },
      warnings: [String(error?.message || 'All terrain providers failed for this AOI.')],
      providersTried,
      data: {
        demGrid: [],
        width: 0,
        height: 0,
        bbox: parsed.bbox,
        source: 'terrain-unavailable',
        isSimulated: false,
        texturePng: null,
        providerResolutionMeters: 0,
        pixelSizeMeters: 0,
        coverage: 0,
        demSource: 'terrain-unavailable',
        demDataset: 'none',
        modelType: 'DTM',
        verticalDatum: 'n/a',
        sourceResolutionMeters: 0,
        effectiveResolutionMeters: 0,
        precisionClass: 'low',
        voidFillRatio: 0,
        zStats: { zMin: 0, zMax: 0, zP05: 0, zP95: 0 },
      },
    })
  }
}
