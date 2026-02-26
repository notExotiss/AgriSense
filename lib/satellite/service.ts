import { fromArrayBuffer } from 'geotiff'
import { PNG } from 'pngjs'
import type { CellFootprint, GeoJsonPolygon, GridCellSummary, RasterAlignment, SceneRef } from '../types/api'
import { buildAoiMask, clipPolygonToRect, deriveAlignment, normalizePolygon } from '../server/raster-geometry'
import { sampleTopographyPalette } from '../visual/topography'

export type IngestPolicy = 'balanced' | 'lowest-cloud' | 'most-recent'
export type IngestProvider = 'planetary-computer-preview' | 'sentinel-hub-cdse'

export type IngestRequest = {
  bbox: [number, number, number, number]
  geometry?: GeoJsonPolygon | null
  date?: string
  targetSize?: number
  policy?: IngestPolicy
}

type EncodedGrid = {
  encoded: string
  validMaskEncoded?: string
  normalizationMode?: 'fixedPhysicalRange' | 'sceneAdaptiveRange'
  width: number
  height: number
  min: number
  max: number
}

export type IngestResult = {
  provider: IngestProvider
  fallbackUsed: boolean
  imagery: {
    id: string
    date: string | null
    cloudCover: number | null
    platform: string | null
  }
  bbox: [number, number, number, number]
  alignment: RasterAlignment
  sceneRef: SceneRef
  dataResolutionMeters: number
  ndvi: {
    previewPng: string
    width: number
    height: number
    metricGrid?: EncodedGrid
    stats: {
      min: number
      max: number
      mean: number
      p10: number
      p90: number
    }
    validPixelRatio: number
    aoiMaskMeta: {
      applied: boolean
      coveredPixelRatio: number
    }
    grid3x3: GridCellSummary[]
    cellFootprints: CellFootprint[]
  }
  ndmi?: {
    metricGrid?: EncodedGrid
    stats: {
      min: number
      max: number
      mean: number
      p10: number
      p90: number
    }
  }
}

type ProviderFailure = {
  provider: string
  code: string
  message: string
}

type NormalizedIngestRequest = {
  bbox: [number, number, number, number]
  geometry: GeoJsonPolygon | null
  date: string
  targetSize: number
  policy: IngestPolicy
}

type DateRange = {
  fromDate: Date
  toDate: Date
  datetime: string
}

type StatsResult = {
  min: number
  max: number
  mean: number
  p10: number
  p90: number
  validPixelRatio: number
}

const PLANETARY_STAC_SEARCH_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
const PLANETARY_PREVIEW_URL = 'https://planetarycomputer.microsoft.com/api/data/v1/item/preview.tif'

const TOKEN_URL_CLASSIC = 'https://services.sentinel-hub.com/oauth/token'
const PROCESS_URL_CLASSIC = 'https://services.sentinel-hub.com/api/v1/process'
const TOKEN_URL_CDSE = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const PROCESS_URL_CDSE = 'https://sh.dataspace.copernicus.eu/api/v1/process'

const DEFAULT_SIZE = 512
const MIN_SIZE = 128
const MAX_SIZE = 1024
const DEFAULT_POLICY: IngestPolicy = 'balanced'
const DEFAULT_LOOKBACK_DAYS = 45
const FETCH_TIMEOUT_MS = 25000

const evalscriptReflectanceCube = `//VERSION=3
function setup(){
  return {
    input: [{ bands:["B04","B08","B8A","B11"], units: "REFLECTANCE" }],
    output: { bands: 4, sampleType: "FLOAT32" }
  }
}
function evaluatePixel(s){
  return [s.B04, s.B08, s.B8A, s.B11]
}`

class IngestPipelineError extends Error {
  failures: ProviderFailure[]

  constructor(message: string, failures: ProviderFailure[]) {
    super(message)
    this.name = 'IngestPipelineError'
    this.failures = failures
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, precision = 6) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function toDateRange(input?: string): DateRange {
  if (input && input.includes('/')) {
    const [from, to] = input.split('/')
    const fromDate = new Date(from)
    const toDate = new Date(to)
    if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
      return { fromDate, toDate, datetime: `${from}/${to}` }
    }
  }

  const toDate = new Date()
  const fromDate = new Date(toDate.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  return {
    fromDate,
    toDate,
    datetime: `${fromDate.toISOString().slice(0, 10)}/${toDate.toISOString().slice(0, 10)}`,
  }
}

function estimateAoiSpanMeters(bbox: [number, number, number, number]) {
  const lonSpan = Math.abs(bbox[2] - bbox[0])
  const latSpan = Math.abs(bbox[3] - bbox[1])
  const latMid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const metersPerDegLat = 111320
  const metersPerDegLon = Math.max(1, Math.cos(latMid) * 111320)
  const x = lonSpan * metersPerDegLon
  const y = latSpan * metersPerDegLat
  return Math.max(x, y)
}

function adaptiveTargetSize(bbox: [number, number, number, number], requested?: number) {
  if (Number.isFinite(requested)) {
    return clamp(Math.round(Number(requested)), MIN_SIZE, MAX_SIZE)
  }
  const spanMeters = estimateAoiSpanMeters(bbox)
  if (spanMeters <= 450) return 1024
  if (spanMeters <= 1800) return 768
  return DEFAULT_SIZE
}

function normalizeRequest(input: IngestRequest): NormalizedIngestRequest {
  const bbox = (Array.isArray(input?.bbox) ? input.bbox : []).map(Number) as [number, number, number, number]
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => Number.isNaN(n))) {
    throw new Error('bbox_required')
  }
  if (!(bbox[2] > bbox[0]) || !(bbox[3] > bbox[1])) {
    throw new Error('bbox_required')
  }

  const geometry = input?.geometry ? normalizePolygon(input.geometry) : null
  if (input?.geometry && !geometry) {
    throw new Error('invalid_geometry')
  }

  return {
    bbox,
    geometry,
    date: toDateRange(input?.date).datetime,
    targetSize: adaptiveTargetSize(bbox, input?.targetSize),
    policy: input?.policy || DEFAULT_POLICY,
  }
}

function scoreScene(item: any, policy: IngestPolicy, now: Date, rangeFrom: Date, rangeTo: Date) {
  const sceneDate = item?.properties?.datetime ? new Date(item.properties.datetime) : null
  const cloud = typeof item?.properties?.['eo:cloud_cover'] === 'number' ? item.properties['eo:cloud_cover'] : 100
  const daysOld = sceneDate ? (now.getTime() - sceneDate.getTime()) / (1000 * 60 * 60 * 24) : 365

  const recencyScore = clamp(1 - daysOld / 90, 0, 1)
  const cloudScore = clamp(1 - cloud / 100, 0, 1)

  if (policy === 'lowest-cloud') return cloudScore * 0.82 + recencyScore * 0.18
  if (policy === 'most-recent') return recencyScore * 0.86 + cloudScore * 0.14

  const inWindowBoost = sceneDate && sceneDate >= rangeFrom && sceneDate <= rangeTo ? 0.1 : 0
  return recencyScore * 0.58 + cloudScore * 0.42 + inWindowBoost
}

function pickBestScene(items: any[], policy: IngestPolicy, dateRange: DateRange) {
  const now = new Date()
  return [...items]
    .filter((item) => item?.id && item?.assets?.B04?.href && item?.assets?.B08?.href && item?.assets?.B8A?.href && item?.assets?.B11?.href)
    .map((item) => ({ item, score: scoreScene(item, policy, now, dateRange.fromDate, dateRange.toDate) }))
    .sort((a, b) => b.score - a.score)[0]?.item
}

function buildBandPreviewUrl(params: {
  itemId: string
  bbox: [number, number, number, number]
  band: 'B04' | 'B08' | 'B8A' | 'B11'
  width: number
  height: number
}) {
  const url = new URL(PLANETARY_PREVIEW_URL)
  url.searchParams.set('collection', 'sentinel-2-l2a')
  url.searchParams.set('item', params.itemId)
  url.searchParams.set('assets', params.band)
  url.searchParams.set('asset_bidx', `${params.band}|1`)
  url.searchParams.set('nodata', '0')
  url.searchParams.set('bbox', params.bbox.join(','))
  url.searchParams.set('width', String(params.width))
  url.searchParams.set('height', String(params.height))
  return url.toString()
}

async function decodeSingleBandTiff(buffer: Buffer) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  const tiff = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const width = Number(image.getWidth())
  const height = Number(image.getHeight())
  const rasters = (await image.readRasters({ interleave: true })) as Float32Array | Uint16Array | Int16Array | Float64Array
  const values = new Float32Array(width * height)
  for (let i = 0; i < values.length; i++) {
    const raw = Number((rasters as any)[i])
    if (!Number.isFinite(raw)) {
      values[i] = 0
      continue
    }
    const reflectance = raw > 2 ? raw / 10000 : raw
    values[i] = reflectance > 0 ? reflectance : 0
  }
  return { values, width, height }
}

async function decodeReflectanceCubeTiff(buffer: Buffer) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  const tiff = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const width = Number(image.getWidth())
  const height = Number(image.getHeight())
  const sampleCount = Number(image.getSamplesPerPixel() || 1)
  if (sampleCount < 4) throw new Error('reflectance_cube_missing_bands')
  const rasters = (await image.readRasters({ interleave: true })) as Float32Array | Float64Array
  const expected = width * height
  const b04 = new Float32Array(expected)
  const b08 = new Float32Array(expected)
  const b8a = new Float32Array(expected)
  const b11 = new Float32Array(expected)

  for (let i = 0; i < expected; i++) {
    const offset = i * sampleCount
    const v04 = Number((rasters as any)[offset])
    const v08 = Number((rasters as any)[offset + 1])
    const v8a = Number((rasters as any)[offset + 2])
    const v11 = Number((rasters as any)[offset + 3])

    const n04 = Number.isFinite(v04) ? (v04 > 2 ? v04 / 10000 : v04) : 0
    const n08 = Number.isFinite(v08) ? (v08 > 2 ? v08 / 10000 : v08) : 0
    const n8a = Number.isFinite(v8a) ? (v8a > 2 ? v8a / 10000 : v8a) : 0
    const n11 = Number.isFinite(v11) ? (v11 > 2 ? v11 / 10000 : v11) : 0

    b04[i] = n04 > 0 ? n04 : 0
    b08[i] = n08 > 0 ? n08 : 0
    b8a[i] = n8a > 0 ? n8a : 0
    b11[i] = n11 > 0 ? n11 : 0
  }

  return { b04, b08, b8a, b11, width, height }
}

function computeIndexGrid(numerator: Float32Array, denominator: Float32Array, minSignal = 0.005) {
  const length = Math.min(numerator.length, denominator.length)
  const values = new Float32Array(length)
  const validMask = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    const num = Number(numerator[i])
    const den = Number(denominator[i])
    const sum = num + den
    if (
      !Number.isFinite(num) ||
      !Number.isFinite(den) ||
      num <= 0 ||
      den <= 0 ||
      num > 1.5 ||
      den > 1.5 ||
      sum <= minSignal
    ) {
      values[i] = Number.NaN
      validMask[i] = 0
      continue
    }
    const value = clamp((num - den) / sum, -1, 1)
    values[i] = value
    validMask[i] = 1
  }
  return { values, validMask }
}

function quantile(sortedValues: number[], q: number) {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const index = (sortedValues.length - 1) * q
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sortedValues[lower]
  const fraction = index - lower
  return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction
}

function computeStats(values: Float32Array, validMask: Uint8Array, aoiMask: Uint8Array | null): StatsResult {
  const validValues: number[] = []
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let valid = 0
  let eligible = 0

  for (let i = 0; i < values.length; i++) {
    if (aoiMask && !aoiMask[i]) continue
    eligible += 1
    if (!validMask[i]) continue
    const value = Number(values[i])
    if (!Number.isFinite(value)) continue
    valid += 1
    validValues.push(value)
    min = Math.min(min, value)
    max = Math.max(max, value)
    sum += value
  }

  validValues.sort((a, b) => a - b)
  const mean = valid ? sum / valid : 0
  const p10 = valid ? quantile(validValues, 0.1) : 0
  const p90 = valid ? quantile(validValues, 0.9) : 0

  return {
    min: round(valid ? min : 0, 4),
    max: round(valid ? max : 0, 4),
    mean: round(mean, 4),
    p10: round(p10, 4),
    p90: round(p90, 4),
    validPixelRatio: round(valid / Math.max(1, eligible), 4),
  }
}

function classifyStress(mean: number, validPixelRatio: number): GridCellSummary['stressLevel'] {
  if (validPixelRatio < 0.1) return 'unknown'
  if (mean < 0.28) return 'high'
  if (mean < 0.42) return 'moderate'
  return 'low'
}

function computeGrid3x3(values: Float32Array, validMask: Uint8Array, width: number, height: number, aoiMask: Uint8Array | null) {
  const cells: GridCellSummary[] = []

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.floor((col / 3) * width)
      const x1 = Math.floor(((col + 1) / 3) * width)
      const y0 = Math.floor((row / 3) * height)
      const y1 = Math.floor(((row + 1) / 3) * height)

      let min = Number.POSITIVE_INFINITY
      let max = Number.NEGATIVE_INFINITY
      let sum = 0
      let valid = 0
      let eligible = 0

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = y * width + x
          if (aoiMask && !aoiMask[idx]) continue
          eligible += 1
          if (!validMask[idx]) continue
          const value = Number(values[idx])
          if (!Number.isFinite(value)) continue
          valid += 1
          min = Math.min(min, value)
          max = Math.max(max, value)
          sum += value
        }
      }

      const mean = valid ? sum / valid : 0
      const validPixelRatio = valid / Math.max(1, eligible)
      cells.push({
        cellId: `${row}-${col}`,
        row,
        col,
        mean: round(mean, 4),
        min: round(valid ? min : 0, 4),
        max: round(valid ? max : 0, 4),
        validPixelRatio: round(validPixelRatio, 4),
        stressLevel: classifyStress(mean, validPixelRatio),
      })
    }
  }

  return cells
}

function downsampleGrid(values: Float32Array, validMask: Uint8Array, width: number, height: number, targetSize: number) {
  const outputWidth = Math.max(1, Math.min(targetSize, width))
  const outputHeight = Math.max(1, Math.min(targetSize, height))
  if (outputWidth === width && outputHeight === height) {
    return {
      values,
      validMask,
      width,
      height,
    }
  }

  const nextValues = new Float32Array(outputWidth * outputHeight)
  const nextValid = new Uint8Array(outputWidth * outputHeight)
  for (let outY = 0; outY < outputHeight; outY++) {
    const y0 = Math.floor((outY / outputHeight) * height)
    const y1 = Math.min(height, Math.ceil(((outY + 1) / outputHeight) * height))
    for (let outX = 0; outX < outputWidth; outX++) {
      const x0 = Math.floor((outX / outputWidth) * width)
      const x1 = Math.min(width, Math.ceil(((outX + 1) / outputWidth) * width))
      let sum = 0
      let validCount = 0
      const totalCount = Math.max(1, (y1 - y0) * (x1 - x0))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = y * width + x
          if (!validMask[idx]) continue
          sum += values[idx]
          validCount += 1
        }
      }
      const outIdx = outY * outputWidth + outX
      const validFraction = validCount / totalCount
      if (validCount > 0 && validFraction >= 0.5) {
        nextValues[outIdx] = sum / validCount
        nextValid[outIdx] = 1
      } else {
        nextValues[outIdx] = Number.NaN
        nextValid[outIdx] = 0
      }
    }
  }

  return {
    values: nextValues,
    validMask: nextValid,
    width: outputWidth,
    height: outputHeight,
  }
}

function encodeFloat32Grid(values: Float32Array) {
  const buffer = Buffer.from(values.buffer, values.byteOffset, values.byteLength)
  return buffer.toString('base64')
}

function encodeMaskGrid(mask: Uint8Array) {
  return Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength).toString('base64')
}

function renderMetricPreviewPng(values: Float32Array, validMask: Uint8Array, width: number, height: number, min: number, max: number) {
  const png = new PNG({ width, height })
  const range = Math.max(1e-6, max - min)
  for (let i = 0; i < values.length; i++) {
    const idx = i * 4
    if (!validMask[i]) {
      png.data[idx] = 0
      png.data[idx + 1] = 0
      png.data[idx + 2] = 0
      png.data[idx + 3] = 0
      continue
    }
    const normalized = clamp((values[i] - min) / range, 0, 1)
    const [r, g, b] = sampleTopographyPalette('ndvi', normalized)
    png.data[idx] = r
    png.data[idx + 1] = g
    png.data[idx + 2] = b
    png.data[idx + 3] = 255
  }
  return PNG.sync.write(png).toString('base64')
}

function buildRectPolygon(minLon: number, minLat: number, maxLon: number, maxLat: number): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: [[
      [minLon, minLat],
      [maxLon, minLat],
      [maxLon, maxLat],
      [minLon, maxLat],
      [minLon, minLat],
    ]],
  }
}

function buildCellFootprints(
  bbox: [number, number, number, number],
  width: number,
  height: number,
  geometry: GeoJsonPolygon | null,
  aoiMask: Uint8Array | null
) {
  const footprints: CellFootprint[] = []
  const ring = geometry?.coordinates?.[0] as [number, number][] | undefined

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x0 = Math.floor((col / 3) * width)
      const x1 = Math.floor(((col + 1) / 3) * width)
      const y0 = Math.floor((row / 3) * height)
      const y1 = Math.floor(((row + 1) / 3) * height)

      const minLon = bbox[0] + ((bbox[2] - bbox[0]) * col) / 3
      const maxLon = bbox[0] + ((bbox[2] - bbox[0]) * (col + 1)) / 3
      const maxLat = bbox[3] - ((bbox[3] - bbox[1]) * row) / 3
      const minLat = bbox[3] - ((bbox[3] - bbox[1]) * (row + 1)) / 3

      const cellPixels = Math.max(1, (x1 - x0) * (y1 - y0))
      let covered = 0
      if (aoiMask) {
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = y * width + x
            if (aoiMask[idx]) covered += 1
          }
        }
      } else {
        covered = cellPixels
      }

      let polygon: GeoJsonPolygon | null
      if (ring && ring.length >= 4) {
        const clipped = clipPolygonToRect(ring, { minLon, minLat, maxLon, maxLat })
        polygon = clipped.length >= 4 ? { type: 'Polygon', coordinates: [clipped as [number, number][]] } : null
      } else {
        polygon = buildRectPolygon(minLon, minLat, maxLon, maxLat)
      }

      footprints.push({
        cellId: `${row}-${col}`,
        row,
        col,
        polygon,
        coverage: round(covered / cellPixels, 4),
      })
    }
  }

  return footprints
}

function providerFailure(provider: string, error: unknown): ProviderFailure {
  const message = error instanceof Error ? error.message : 'unknown_error'
  return {
    provider,
    code: message,
    message,
  }
}

async function fetchPlanetaryBand(input: NormalizedIngestRequest, sceneId: string, band: 'B04' | 'B08' | 'B8A' | 'B11') {
  const url = buildBandPreviewUrl({
    itemId: sceneId,
    bbox: input.bbox,
    band,
    width: input.targetSize,
    height: input.targetSize,
  })
  const response = await fetchWithTimeout(url, {}, FETCH_TIMEOUT_MS)
  if (!response.ok) throw new Error(`planetary_band_${band}_failed_${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  return decodeSingleBandTiff(buffer)
}

function finalizeIngestResult(params: {
  provider: IngestProvider
  fallbackUsed: boolean
  imagery: IngestResult['imagery']
  sceneRef: SceneRef
  bbox: [number, number, number, number]
  geometry: GeoJsonPolygon | null
  ndviValues: Float32Array
  ndviValidMask: Uint8Array
  ndmiValues: Float32Array
  ndmiValidMask: Uint8Array
  width: number
  height: number
}) {
  const outputSize = Math.min(params.width, params.height, 512)
  const downsampledNdvi = downsampleGrid(
    params.ndviValues,
    params.ndviValidMask,
    params.width,
    params.height,
    outputSize
  )
  const downsampledNdmi = downsampleGrid(
    params.ndmiValues,
    params.ndmiValidMask,
    params.width,
    params.height,
    outputSize
  )

  const aoi = buildAoiMask(params.bbox, downsampledNdvi.width, downsampledNdvi.height, params.geometry)
  const ndviStats = computeStats(downsampledNdvi.values, downsampledNdvi.validMask, aoi.mask)
  const ndmiStats = computeStats(downsampledNdmi.values, downsampledNdmi.validMask, aoi.mask)
  const previewPng = renderMetricPreviewPng(
    downsampledNdvi.values,
    downsampledNdvi.validMask,
    downsampledNdvi.width,
    downsampledNdvi.height,
    ndviStats.min,
    ndviStats.max
  )

  const grid3x3 = computeGrid3x3(
    downsampledNdvi.values,
    downsampledNdvi.validMask,
    downsampledNdvi.width,
    downsampledNdvi.height,
    aoi.mask
  )

  const cellFootprints = buildCellFootprints(
    params.bbox,
    downsampledNdvi.width,
    downsampledNdvi.height,
    params.geometry,
    aoi.mask
  )

  const alignment = deriveAlignment(params.bbox, downsampledNdvi.width, downsampledNdvi.height)

  return {
    provider: params.provider,
    fallbackUsed: params.fallbackUsed,
    imagery: params.imagery,
    bbox: params.bbox,
    alignment,
    sceneRef: params.sceneRef,
    dataResolutionMeters: round(alignment.pixelSizeMetersApprox, 3),
    ndvi: {
      previewPng,
      width: downsampledNdvi.width,
      height: downsampledNdvi.height,
      metricGrid: {
        encoded: encodeFloat32Grid(downsampledNdvi.values),
        validMaskEncoded: encodeMaskGrid(downsampledNdvi.validMask),
        normalizationMode: 'sceneAdaptiveRange',
        width: downsampledNdvi.width,
        height: downsampledNdvi.height,
        min: ndviStats.min,
        max: ndviStats.max,
      },
      stats: {
        min: ndviStats.min,
        max: ndviStats.max,
        mean: ndviStats.mean,
        p10: ndviStats.p10,
        p90: ndviStats.p90,
      },
      validPixelRatio: ndviStats.validPixelRatio,
      aoiMaskMeta: {
        applied: aoi.applied,
        coveredPixelRatio: round(aoi.coveredPixelRatio, 4),
      },
      grid3x3,
      cellFootprints,
    },
    ndmi: {
      metricGrid: {
        encoded: encodeFloat32Grid(downsampledNdmi.values),
        validMaskEncoded: encodeMaskGrid(downsampledNdmi.validMask),
        normalizationMode: 'sceneAdaptiveRange',
        width: downsampledNdmi.width,
        height: downsampledNdmi.height,
        min: ndmiStats.min,
        max: ndmiStats.max,
      },
      stats: {
        min: ndmiStats.min,
        max: ndmiStats.max,
        mean: ndmiStats.mean,
        p10: ndmiStats.p10,
        p90: ndmiStats.p90,
      },
    },
  } satisfies IngestResult
}

async function runPlanetaryComputerProvider(input: NormalizedIngestRequest): Promise<IngestResult> {
  const dateRange = toDateRange(input.date)
  const searchRes = await fetchWithTimeout(PLANETARY_STAC_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bbox: input.bbox,
      datetime: input.date,
      collections: ['sentinel-2-l2a'],
      limit: 24,
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    }),
  })

  if (!searchRes.ok) throw new Error(`stac_search_failed_${searchRes.status}`)

  const searchJson = await searchRes.json()
  const scene = pickBestScene(searchJson.features || [], input.policy, dateRange)
  if (!scene) throw new Error('no_imagery_found')

  const [b04, b08, b8a, b11] = await Promise.all([
    fetchPlanetaryBand(input, String(scene.id), 'B04'),
    fetchPlanetaryBand(input, String(scene.id), 'B08'),
    fetchPlanetaryBand(input, String(scene.id), 'B8A'),
    fetchPlanetaryBand(input, String(scene.id), 'B11'),
  ])

  if (b04.width !== b08.width || b04.height !== b08.height || b04.width !== b8a.width || b04.height !== b8a.height || b04.width !== b11.width || b04.height !== b11.height) {
    throw new Error('band_dimension_mismatch')
  }

  const ndvi = computeIndexGrid(b08.values, b04.values)
  const ndmi = computeIndexGrid(b8a.values, b11.values)

  return finalizeIngestResult({
    provider: 'planetary-computer-preview',
    fallbackUsed: false,
    imagery: {
      id: String(scene.id),
      date: scene?.properties?.datetime || null,
      cloudCover: typeof scene?.properties?.['eo:cloud_cover'] === 'number' ? scene.properties['eo:cloud_cover'] : null,
      platform: scene?.properties?.platform || null,
    },
    sceneRef: {
      provider: 'planetary-computer-preview',
      sceneId: String(scene.id),
      sceneDate: scene?.properties?.datetime || null,
    },
    bbox: input.bbox,
    geometry: input.geometry,
    ndviValues: ndvi.values,
    ndviValidMask: ndvi.validMask,
    ndmiValues: ndmi.values,
    ndmiValidMask: ndmi.validMask,
    width: b04.width,
    height: b04.height,
  })
}

async function getTokenClassic() {
  const id = process.env.SENTINEL_HUB_CLIENT_ID
  const secret = process.env.SENTINEL_HUB_CLIENT_SECRET
  if (!id || !secret) return null
  const response = await fetchWithTimeout(TOKEN_URL_CLASSIC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  })
  if (!response.ok) return null
  const json = await response.json()
  return json.access_token as string
}

async function getTokenCdse() {
  const id = process.env.SENTINEL_HUB_CLIENT_ID
  const secret = process.env.SENTINEL_HUB_CLIENT_SECRET
  if (!id || !secret) return null
  const response = await fetchWithTimeout(TOKEN_URL_CDSE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
    }),
  })
  if (!response.ok) return null
  const json = await response.json()
  return json.access_token as string
}

async function runSentinelHubProvider(input: NormalizedIngestRequest): Promise<IngestResult> {
  let token = await getTokenClassic()
  let processUrl = PROCESS_URL_CLASSIC
  let providerLabel = 'sentinel-hub-classic'

  if (!token) {
    token = await getTokenCdse()
    processUrl = PROCESS_URL_CDSE
    providerLabel = 'sentinel-hub-cdse'
  }

  if (!token) {
    throw new Error('sentinel_credentials_missing_or_invalid')
  }

  const [fromDate, toDate] = input.date.split('/')
  const fromIso = `${fromDate}T00:00:00Z`
  const toIso = `${toDate}T23:59:59Z`

  const response = await fetchWithTimeout(processUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        bounds: {
          bbox: input.bbox,
          properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
        },
        data: [
          {
            type: 'S2L2A',
            dataFilter: { timeRange: { from: fromIso, to: toIso }, mosaickingOrder: 'leastCC' },
          },
        ],
      },
      evalscript: evalscriptReflectanceCube,
      output: {
        responses: [{ identifier: 'default', format: { type: 'image/tiff' } }],
        width: input.targetSize,
        height: input.targetSize,
      },
    }),
  })

  if (!response.ok) throw new Error(`sentinel_cube_failed_${response.status}`)

  const buffer = Buffer.from(await response.arrayBuffer())
  const cube = await decodeReflectanceCubeTiff(buffer)
  const ndvi = computeIndexGrid(cube.b08, cube.b04)
  const ndmi = computeIndexGrid(cube.b8a, cube.b11)

  return finalizeIngestResult({
    provider: 'sentinel-hub-cdse',
    fallbackUsed: true,
    imagery: {
      id: `${providerLabel}:${fromDate}-${toDate}`,
      date: null,
      cloudCover: null,
      platform: 'Sentinel-2',
    },
    sceneRef: {
      provider: providerLabel,
      sceneId: `${fromDate}-${toDate}`,
      sceneDate: null,
    },
    bbox: input.bbox,
    geometry: input.geometry,
    ndviValues: ndvi.values,
    ndviValidMask: ndvi.validMask,
    ndmiValues: ndmi.values,
    ndmiValidMask: ndmi.validMask,
    width: cube.width,
    height: cube.height,
  })
}

export async function runIngestPipeline(input: IngestRequest) {
  const normalized = normalizeRequest(input)
  const failures: ProviderFailure[] = []
  const warnings: string[] = []

  try {
    const primary = await runPlanetaryComputerProvider(normalized)
    if (primary.ndvi.validPixelRatio < 0.45) {
      warnings.push('Low valid pixel ratio detected. Consider adjusting date range or AOI.')
    }
    return { result: primary, warnings }
  } catch (error) {
    failures.push(providerFailure('planetary-computer-preview', error))
    warnings.push('Primary satellite provider failed; attempting Sentinel Hub fallback.')
  }

  try {
    const fallback = await runSentinelHubProvider(normalized)
    if (fallback.ndvi.validPixelRatio < 0.45) {
      warnings.push('Low valid pixel ratio detected in fallback provider output.')
    }
    return { result: fallback, warnings }
  } catch (error) {
    failures.push(providerFailure('sentinel-hub-cdse', error))
    throw new IngestPipelineError('all_providers_failed', failures)
  }
}

export function toIngestErrorPayload(error: unknown) {
  if (error instanceof IngestPipelineError) {
    return {
      error: 'all_providers_failed',
      message: 'No satellite providers were able to process this request.',
      providers: error.failures,
    }
  }

  if (error instanceof Error && error.message === 'bbox_required') {
    return {
      error: 'bbox_required',
      message: 'Bounding box [minLon,minLat,maxLon,maxLat] is required.',
      providers: [],
    }
  }

  if (error instanceof Error && error.message === 'invalid_geometry') {
    return {
      error: 'invalid_geometry',
      message: 'AOI geometry must be a valid GeoJSON Polygon.',
      providers: [],
    }
  }

  return {
    error: 'ingest_failed',
    message: error instanceof Error ? error.message : 'Unknown ingest error',
    providers: [],
  }
}
