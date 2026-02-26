import type { NextApiRequest, NextApiResponse } from 'next'
import { PNG } from 'pngjs'
import type { GeoJsonPolygon, ProviderDiagnostic } from '../../lib/types/api'
import { makeCacheKey, readMemoryCache, writeMemoryCache } from '../../lib/server/cache'
import { runIngestPipeline, type IngestResult } from '../../lib/satellite/service'
import { sampleTopographyPalette } from '../../lib/visual/topography'

const INGEST_CACHE_TTL_MS = 1000 * 60 * 8

type EtResponse = {
  success: boolean
  unavailable?: boolean
  message?: string
  source: string
  isSimulated: boolean
  cacheHit: boolean
  warnings: string[]
  providersTried: ProviderDiagnostic[]
  representation?: 'hybrid-estimate'
  baseline?: {
    provider: string
    variable: string
    value: number
    units: string
    timestamp: string
  }
  proxy?: {
    provider: string
    metric: string
    formula: string
    sceneRef: IngestResult['sceneRef']
    dataResolutionMeters: number
  }
  alignment?: IngestResult['alignment']
  data?: {
    evapotranspiration: string
    metricGrid: {
      encoded: string
      validMaskEncoded?: string
      normalizationMode?: 'fixedPhysicalRange' | 'sceneAdaptiveRange'
      width: number
      height: number
      min: number
      max: number
    }
    overlayPng: string
    stats: { min: number; max: number; mean: number }
    bbox: [number, number, number, number]
    source: string
    isSimulated: false
    units: 'mm/day'
    timestamp: string
  } | null
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, precision = 4) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function decodeFloat32Grid(encoded: string, width: number, height: number) {
  const bytes = Buffer.from(encoded, 'base64')
  const expected = width * height
  const floats = new Float32Array(bytes.buffer, bytes.byteOffset, Math.min(expected, Math.floor(bytes.byteLength / 4)))
  const values = new Float32Array(expected)
  for (let i = 0; i < expected; i++) {
    const value = Number(floats[i])
    values[i] = Number.isFinite(value) ? value : Number.NaN
  }
  return values
}

function encodeFloat32Grid(values: Float32Array) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('base64')
}

function decodeMaskGrid(encoded: string | undefined, width: number, height: number) {
  if (!encoded) return null
  const bytes = Buffer.from(encoded, 'base64')
  const expected = width * height
  const values = new Uint8Array(expected)
  for (let i = 0; i < expected; i++) {
    values[i] = i < bytes.length ? (bytes[i] > 0 ? 1 : 0) : 0
  }
  return values
}

function encodeMaskGrid(values: Uint8Array) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('base64')
}

function toPng(values: Float32Array, validMask: Uint8Array | null, width: number, height: number, min: number, max: number) {
  const png = new PNG({ width, height })
  const range = Math.max(1e-6, max - min)
  for (let i = 0; i < values.length; i++) {
    const idx = i * 4
    const value = Number(values[i])
    if ((validMask && !validMask[i]) || !Number.isFinite(value)) {
      png.data[idx] = 0
      png.data[idx + 1] = 0
      png.data[idx + 2] = 0
      png.data[idx + 3] = 0
      continue
    }
    const normalized = clamp((values[i] - min) / range, 0, 1)
    const [r, g, b] = sampleTopographyPalette('et', normalized)
    png.data[idx] = r
    png.data[idx + 1] = g
    png.data[idx + 2] = b
    png.data[idx + 3] = 255
  }
  return PNG.sync.write(png).toString('base64')
}

function parseBody(body: any) {
  const bbox = Array.isArray(body?.bbox) ? body.bbox.map(Number) : []
  if (bbox.length !== 4 || bbox.some((value: number) => Number.isNaN(value))) {
    throw new Error('bbox_required')
  }
  const geometry = body?.geometry && typeof body.geometry === 'object' ? (body.geometry as GeoJsonPolygon) : undefined
  const date = typeof body?.date === 'string' ? body.date : undefined
  const targetSize = Number.isFinite(Number(body?.targetSize)) ? Number(body.targetSize) : undefined
  return {
    bbox: bbox as [number, number, number, number],
    geometry,
    date,
    targetSize,
  }
}

async function fetchJson(url: string, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`http_${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function getOpenMeteoEt0(lat: number, lon: number) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lon))
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('past_days', '7')
  url.searchParams.set('forecast_days', '1')
  url.searchParams.set('daily', 'et0_fao_evapotranspiration')

  const json = await fetchJson(url.toString())
  const values = Array.isArray(json?.daily?.et0_fao_evapotranspiration)
    ? json.daily.et0_fao_evapotranspiration.filter((value: any) => Number.isFinite(Number(value))).map(Number)
    : []
  if (!values.length) throw new Error('et_baseline_unavailable')
  return clamp(Number(values[values.length - 1]), 0.05, 14)
}

async function getIngestSnapshot(input: {
  bbox: [number, number, number, number]
  geometry?: GeoJsonPolygon
  date?: string
  targetSize?: number
}) {
  const geometryKey = input.geometry ? JSON.stringify(input.geometry) : 'none'
  const cacheKey = makeCacheKey([
    'soil-et-ingest-v1',
    input.bbox[0],
    input.bbox[1],
    input.bbox[2],
    input.bbox[3],
    geometryKey,
    input.date || 'auto',
    input.targetSize || 0,
  ])

  const cached = readMemoryCache<{ result: IngestResult; warnings: string[] }>(cacheKey)
  if (cached?.result) return { ...cached, cacheHit: true }

  const ingest = await runIngestPipeline({
    bbox: input.bbox,
    geometry: input.geometry,
    date: input.date,
    targetSize: input.targetSize,
    policy: 'balanced',
  })
  writeMemoryCache(cacheKey, ingest, INGEST_CACHE_TTL_MS)
  return { ...ingest, cacheHit: false }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<EtResponse | { error: string; message: string }>) {
  if (req.method !== 'POST') return res.status(405).end()

  let parsed: ReturnType<typeof parseBody>
  try {
    parsed = parseBody(req.body || {})
  } catch {
    return res.status(400).json({ error: 'bbox_required', message: 'Bounding box [minLon,minLat,maxLon,maxLat] is required.' })
  }

  const centerLat = (parsed.bbox[1] + parsed.bbox[3]) / 2
  const centerLon = (parsed.bbox[0] + parsed.bbox[2]) / 2
  const providersTried: ProviderDiagnostic[] = []
  const warnings: string[] = []

  try {
    const baselinePromise = getOpenMeteoEt0(centerLat, centerLon)
    const ingestPromise = getIngestSnapshot(parsed)

    const [baselineEt0, ingest] = await Promise.all([baselinePromise, ingestPromise])

    providersTried.push({ provider: 'open-meteo-et0', ok: true })
    providersTried.push({ provider: ingest.result.provider, ok: true })

    const ndviGrid = ingest.result.ndvi?.metricGrid
    const ndmiGrid = ingest.result.ndmi?.metricGrid
    if (!ndviGrid?.encoded || !ndmiGrid?.encoded || !ndviGrid.width || !ndviGrid.height || !ndmiGrid.width || !ndmiGrid.height || ndviGrid.width !== ndmiGrid.width || ndviGrid.height !== ndmiGrid.height) {
      return res.status(200).json({
        success: true,
        unavailable: true,
        message: 'NDVI/NDMI proxy grids are unavailable for this AOI/date selection.',
        source: 'strict-real-only',
        isSimulated: false,
        cacheHit: ingest.cacheHit,
        warnings,
        providersTried,
        representation: 'hybrid-estimate',
        alignment: ingest.result.alignment,
        data: null,
      })
    }

    const ndviValues = decodeFloat32Grid(ndviGrid.encoded, ndviGrid.width, ndviGrid.height)
    const ndmiValues = decodeFloat32Grid(ndmiGrid.encoded, ndmiGrid.width, ndmiGrid.height)
    const ndviMask = decodeMaskGrid(ndviGrid.validMaskEncoded, ndviGrid.width, ndviGrid.height)
    const ndmiMask = decodeMaskGrid(ndmiGrid.validMaskEncoded, ndmiGrid.width, ndmiGrid.height)

    const ndviMin = Number(ingest.result.ndvi.stats.min)
    const ndviMax = Number(ingest.result.ndvi.stats.max)
    const ndmiMin = Number(ingest.result.ndmi.stats.min)
    const ndmiMax = Number(ingest.result.ndmi.stats.max)

    const ndviRange = Math.max(1e-6, ndviMax - ndviMin)
    const ndmiRange = Math.max(1e-6, ndmiMax - ndmiMin)

    const etcValues = new Float32Array(ndviValues.length)
    const etcMask = new Uint8Array(ndviValues.length)
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    let sum = 0
    let validCount = 0

    for (let i = 0; i < ndviValues.length; i++) {
      if ((ndviMask && !ndviMask[i]) || (ndmiMask && !ndmiMask[i])) {
        etcValues[i] = Number.NaN
        etcMask[i] = 0
        continue
      }
      const ndviValue = Number(ndviValues[i])
      const ndmiValue = Number(ndmiValues[i])
      if (!Number.isFinite(ndviValue) || !Number.isFinite(ndmiValue)) {
        etcValues[i] = Number.NaN
        etcMask[i] = 0
        continue
      }
      const ndviNorm = clamp((ndviValue - ndviMin) / ndviRange, 0, 1)
      const ndmiNorm = clamp((ndmiValue - ndmiMin) / ndmiRange, 0, 1)
      const kcProxy = clamp(0.18 + ndviNorm * 0.9 + (ndmiNorm - 0.5) * 0.24, 0.12, 1.28)
      const etc = clamp(baselineEt0 * kcProxy, 0.02, 16)
      etcValues[i] = etc
      etcMask[i] = 1
      min = Math.min(min, etc)
      max = Math.max(max, etc)
      sum += etc
      validCount += 1
    }

    if (!Number.isFinite(min) || !Number.isFinite(max) || validCount <= 0) {
      return res.status(200).json({
        success: true,
        unavailable: true,
        message: 'ET proxy grid had no valid pixels for this AOI/date selection.',
        source: 'strict-real-only',
        isSimulated: false,
        cacheHit: ingest.cacheHit,
        warnings,
        providersTried,
        representation: 'hybrid-estimate',
        alignment: ingest.result.alignment,
        data: null,
      })
    }

    const mean = sum / validCount
    const encoded = encodeFloat32Grid(etcValues)
    const encodedMask = encodeMaskGrid(etcMask)
    const overlayPng = toPng(etcValues, etcMask, ndviGrid.width, ndviGrid.height, min, max)

    if (Array.isArray(ingest.warnings) && ingest.warnings.length) warnings.push(...ingest.warnings)

    return res.status(200).json({
      success: true,
      source: 'Open-Meteo ET0 + Sentinel-2 NDVI/NDMI proxy',
      isSimulated: false,
      cacheHit: ingest.cacheHit,
      unavailable: false,
      warnings,
      providersTried,
      representation: 'hybrid-estimate',
      baseline: {
        provider: 'open-meteo',
        variable: 'et0_fao_evapotranspiration',
        value: round(baselineEt0),
        units: 'mm/day',
        timestamp: new Date().toISOString(),
      },
      proxy: {
        provider: ingest.result.provider,
        metric: 'kc_proxy',
        formula: 'ETc ~= ET0 * clamp(0.18 + 0.9*NDVI_norm + 0.24*(NDMI_norm-0.5), 0.12, 1.28)',
        sceneRef: ingest.result.sceneRef,
        dataResolutionMeters: ingest.result.dataResolutionMeters,
      },
      alignment: ingest.result.alignment,
      data: {
        evapotranspiration: encoded,
        metricGrid: {
          encoded,
          validMaskEncoded: encodedMask,
          normalizationMode: 'fixedPhysicalRange',
          width: ndviGrid.width,
          height: ndviGrid.height,
          min: round(min),
          max: round(max),
        },
        overlayPng,
        stats: {
          min: round(min),
          max: round(max),
          mean: round(mean),
        },
        bbox: ingest.result.bbox,
        source: 'Hybrid estimate (Open-Meteo ET0 baseline + NDVI/NDMI Kc proxy)',
        isSimulated: false,
        units: 'mm/day',
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error: any) {
    const message = String(error?.message || 'et_fetch_failed')
    if (message.startsWith('http_')) {
      providersTried.push({ provider: 'open-meteo-et0', ok: false, reason: message })
    }
    if (!providersTried.some((provider) => provider.provider === 'hybrid-et-proxy')) {
      providersTried.push({ provider: 'hybrid-et-proxy', ok: false, reason: message })
    }
    return res.status(200).json({
      success: true,
      unavailable: true,
      message: 'ET layer unavailable under strict real-only mode.',
      source: 'strict-real-only',
      isSimulated: false,
      cacheHit: false,
      warnings: [message],
      providersTried,
      representation: 'hybrid-estimate',
      data: null,
    })
  }
}
