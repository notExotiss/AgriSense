import { PNG } from 'pngjs'
import { fromArrayBuffer } from 'geotiff'
import type { GridCellSummary } from '../types/api'

export type IngestPolicy = 'balanced' | 'lowest-cloud' | 'most-recent'
export type IngestProvider = 'planetary-computer-preview' | 'sentinel-hub-cdse'

export type IngestRequest = {
  bbox: [number, number, number, number]
  date?: string
  targetSize?: 256 | 512 | 1024
  policy?: IngestPolicy
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
  ndvi: {
    previewPng: string
    width: number
    height: number
    metricGrid?: {
      encoded: string
      width: number
      height: number
      min: number
      max: number
    }
    stats: {
      min: number
      max: number
      mean: number
      p10: number
      p90: number
    }
    validPixelRatio: number
    grid3x3: GridCellSummary[]
  }
}

type ProviderFailure = {
  provider: string
  code: string
  message: string
}

const PLANETARY_STAC_SEARCH_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
const PLANETARY_PREVIEW_URL = 'https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png'

const TOKEN_URL_CLASSIC = 'https://services.sentinel-hub.com/oauth/token'
const PROCESS_URL_CLASSIC = 'https://services.sentinel-hub.com/api/v1/process'
const TOKEN_URL_CDSE = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const PROCESS_URL_CDSE = 'https://sh.dataspace.copernicus.eu/api/v1/process'

const DEFAULT_SIZE = 512
const DEFAULT_POLICY: IngestPolicy = 'balanced'
const DEFAULT_LOOKBACK_DAYS = 45
const FETCH_TIMEOUT_MS = 25000

const evalscriptNDVI = `//VERSION=3
function setup(){
  return {
    input: [{ bands:["B04","B08"], units: "REFLECTANCE" }],
    output: { bands: 1, sampleType: "FLOAT32" }
  }
}
function evaluatePixel(s){
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04)
  if (!isFinite(ndvi)) ndvi = 0
  return [ndvi]
}`

const evalscriptColorPNG = `//VERSION=3
function setup(){
  return { input:[{ bands:["B04","B08"], units: "REFLECTANCE" }], output: { bands: 3 } }
}
function evaluatePixel(s){
  let v = (s.B08 - s.B04) / (s.B08 + s.B04)
  if (!isFinite(v)) v = 0
  let r,g,b
  if (v < 0){ r=128; g=0; b=38 }
  else if (v < 0.2){ r=255; g=255; b=178 }
  else if (v < 0.4){ r=127; g=201; b=127 }
  else { r=27; g=120; b=55 }
  return [r/255, g/255, b/255]
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

function toDateRange(input?: string) {
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

function normalizeRequest(input: IngestRequest): Required<IngestRequest> {
  const bbox = (input.bbox || []).map(Number) as [number, number, number, number]
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((n) => Number.isNaN(n))) {
    throw new Error('bbox_required')
  }

  const targetSize = input.targetSize && [256, 512, 1024].includes(input.targetSize) ? input.targetSize : DEFAULT_SIZE
  const policy = input.policy || DEFAULT_POLICY
  const { datetime } = toDateRange(input.date)

  return {
    bbox,
    date: datetime,
    policy,
    targetSize,
  }
}

function scoreScene(
  item: any,
  policy: IngestPolicy,
  now: Date,
  rangeFrom: Date,
  rangeTo: Date
) {
  const sceneDate = item?.properties?.datetime ? new Date(item.properties.datetime) : null
  const cloud = typeof item?.properties?.['eo:cloud_cover'] === 'number' ? item.properties['eo:cloud_cover'] : 100
  const daysOld = sceneDate ? (now.getTime() - sceneDate.getTime()) / (1000 * 60 * 60 * 24) : 365

  const recencyScore = clamp(1 - daysOld / 90, 0, 1)
  const cloudScore = clamp(1 - cloud / 100, 0, 1)

  if (policy === 'lowest-cloud') return cloudScore * 0.8 + recencyScore * 0.2
  if (policy === 'most-recent') return recencyScore * 0.85 + cloudScore * 0.15

  const inWindowBoost = sceneDate && sceneDate >= rangeFrom && sceneDate <= rangeTo ? 0.1 : 0
  return recencyScore * 0.6 + cloudScore * 0.4 + inWindowBoost
}

function pickBestScene(items: any[], policy: IngestPolicy, dateRange: { fromDate: Date; toDate: Date }) {
  const now = new Date()
  return [...items]
    .filter((item) => item?.id && item?.assets?.B04?.href && item?.assets?.B08?.href)
    .map((item) => ({
      item,
      score: scoreScene(item, policy, now, dateRange.fromDate, dateRange.toDate),
    }))
    .sort((a, b) => b.score - a.score)[0]?.item
}

function buildBandPreviewUrl(params: {
  itemId: string
  bbox: [number, number, number, number]
  band: 'B04' | 'B08'
  width: number
  height: number
}) {
  const url = new URL(PLANETARY_PREVIEW_URL)
  url.searchParams.set('collection', 'sentinel-2-l2a')
  url.searchParams.set('item', params.itemId)
  url.searchParams.set('assets', params.band)
  url.searchParams.set('asset_bidx', `${params.band}|1`)
  url.searchParams.set('nodata', '0')
  url.searchParams.set('format', 'png')
  url.searchParams.set('rescale', '0,3000')
  url.searchParams.set('bbox', params.bbox.join(','))
  url.searchParams.set('width', String(params.width))
  url.searchParams.set('height', String(params.height))
  return url.toString()
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

function computeNdviFromPngBuffers(redBuffer: Buffer, nirBuffer: Buffer) {
  const red = PNG.sync.read(redBuffer)
  const nir = PNG.sync.read(nirBuffer)

  if (red.width !== nir.width || red.height !== nir.height) {
    throw new Error('band_dimension_mismatch')
  }

  const width = red.width
  const height = red.height
  const pixelCount = width * height
  const ndviValues = new Float32Array(pixelCount)
  const validMask = new Uint8Array(pixelCount)

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let validCount = 0
  const validValues: number[] = []

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4
    const r = red.data[idx]
    const n = nir.data[idx]
    const den = n + r
    let ndvi = 0
    if (den > 0) {
      ndvi = clamp((n - r) / den, -1, 1)
      validMask[i] = 1
      validCount += 1
      validValues.push(ndvi)
      min = Math.min(min, ndvi)
      max = Math.max(max, ndvi)
      sum += ndvi
    }
    ndviValues[i] = ndvi
  }

  validValues.sort((a, b) => a - b)
  const mean = validCount ? sum / validCount : 0
  const p10 = validCount ? quantile(validValues, 0.1) : 0
  const p90 = validCount ? quantile(validValues, 0.9) : 0

  return {
    ndviValues,
    width,
    height,
    stats: {
      min: round(validCount ? min : 0),
      max: round(validCount ? max : 0),
      mean: round(mean),
      p10: round(p10),
      p90: round(p90),
    },
    validPixelRatio: round(validCount / Math.max(1, pixelCount), 4),
    validMask,
  }
}

function classifyStress(mean: number, validPixelRatio: number): GridCellSummary['stressLevel'] {
  if (validPixelRatio < 0.1) return 'unknown'
  if (mean < 0.28) return 'high'
  if (mean < 0.42) return 'moderate'
  return 'low'
}

function computeGrid3x3(
  ndviValues: Float32Array,
  width: number,
  height: number,
  validMask?: Uint8Array
) {
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
      let count = 0
      let valid = 0
      const total = Math.max(1, (x1 - x0) * (y1 - y0))

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = y * width + x
          const value = Number(ndviValues[idx])
          if (!Number.isFinite(value)) continue
          count += 1
          min = Math.min(min, value)
          max = Math.max(max, value)
          sum += value
          if (validMask?.[idx]) valid += 1
        }
      }

      const mean = count ? sum / count : 0
      const validPixelRatio = validMask ? valid / total : count / total
      cells.push({
        cellId: `${row}-${col}`,
        row,
        col,
        mean: round(mean, 4),
        min: round(count ? min : 0, 4),
        max: round(count ? max : 0, 4),
        validPixelRatio: round(validPixelRatio, 4),
        stressLevel: classifyStress(mean, validPixelRatio),
      })
    }
  }
  return cells
}

function downsampleNdviGrid(
  ndviValues: Float32Array,
  width: number,
  height: number,
  targetSize = 128
) {
  const outputWidth = Math.max(1, Math.min(targetSize, width))
  const outputHeight = Math.max(1, Math.min(targetSize, height))
  const values = new Float32Array(outputWidth * outputHeight)

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (let outY = 0; outY < outputHeight; outY++) {
    const y0 = Math.floor((outY / outputHeight) * height)
    const y1 = Math.min(height, Math.ceil(((outY + 1) / outputHeight) * height))

    for (let outX = 0; outX < outputWidth; outX++) {
      const x0 = Math.floor((outX / outputWidth) * width)
      const x1 = Math.min(width, Math.ceil(((outX + 1) / outputWidth) * width))

      let sum = 0
      let count = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = y * width + x
          const value = ndviValues[idx]
          if (!Number.isFinite(value)) continue
          sum += value
          count += 1
        }
      }

      const sampled = count ? sum / count : 0
      const outputIndex = outY * outputWidth + outX
      values[outputIndex] = sampled
      min = Math.min(min, sampled)
      max = Math.max(max, sampled)
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 0
  }

  return {
    values,
    width: outputWidth,
    height: outputHeight,
    min,
    max,
  }
}

function encodeFloat32Grid(values: Float32Array) {
  const buffer = Buffer.from(values.buffer, values.byteOffset, values.byteLength)
  return buffer.toString('base64')
}

function ndviToColor(ndvi: number): [number, number, number] {
  const value = clamp(ndvi, -1, 1)
  if (value < -0.1) return [42, 69, 135]
  if (value < 0) return [121, 164, 207]
  if (value < 0.2) return [231, 204, 126]
  if (value < 0.4) return [170, 196, 106]
  if (value < 0.6) return [90, 161, 83]
  if (value < 0.8) return [46, 120, 64]
  return [22, 86, 53]
}

function renderNdviPngBase64(ndviValues: Float32Array, width: number, height: number) {
  const png = new PNG({ width, height })
  for (let i = 0; i < ndviValues.length; i++) {
    const [r, g, b] = ndviToColor(ndviValues[i])
    const idx = i * 4
    png.data[idx] = r
    png.data[idx + 1] = g
    png.data[idx + 2] = b
    png.data[idx + 3] = 255
  }
  return PNG.sync.write(png).toString('base64')
}

async function runPlanetaryComputerProvider(input: Required<IngestRequest>): Promise<IngestResult> {
  const dateRange = toDateRange(input.date)

  const searchRes = await fetchWithTimeout(PLANETARY_STAC_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bbox: input.bbox,
      datetime: input.date,
      collections: ['sentinel-2-l2a'],
      limit: 16,
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    }),
  })

  if (!searchRes.ok) {
    throw new Error(`stac_search_failed_${searchRes.status}`)
  }

  const searchJson = await searchRes.json()
  const scene = pickBestScene(searchJson.features || [], input.policy, dateRange)
  if (!scene) throw new Error('no_imagery_found')

  const bandB04Url = buildBandPreviewUrl({
    itemId: scene.id,
    bbox: input.bbox,
    band: 'B04',
    width: input.targetSize,
    height: input.targetSize,
  })
  const bandB08Url = buildBandPreviewUrl({
    itemId: scene.id,
    bbox: input.bbox,
    band: 'B08',
    width: input.targetSize,
    height: input.targetSize,
  })

  const [b04Res, b08Res] = await Promise.all([
    fetchWithTimeout(bandB04Url, {}, FETCH_TIMEOUT_MS),
    fetchWithTimeout(bandB08Url, {}, FETCH_TIMEOUT_MS),
  ])

  if (!b04Res.ok || !b08Res.ok) {
    throw new Error(`band_fetch_failed_${b04Res.status}_${b08Res.status}`)
  }

  const [redBuffer, nirBuffer] = await Promise.all([
    b04Res.arrayBuffer().then((buf) => Buffer.from(buf)),
    b08Res.arrayBuffer().then((buf) => Buffer.from(buf)),
  ])

  const ndvi = computeNdviFromPngBuffers(redBuffer, nirBuffer)
  const previewPng = renderNdviPngBase64(ndvi.ndviValues, ndvi.width, ndvi.height)
  const grid3x3 = computeGrid3x3(ndvi.ndviValues, ndvi.width, ndvi.height, ndvi.validMask)
  const metricGrid = downsampleNdviGrid(ndvi.ndviValues, ndvi.width, ndvi.height, 128)

  return {
    provider: 'planetary-computer-preview',
    fallbackUsed: false,
    imagery: {
      id: String(scene.id),
      date: scene?.properties?.datetime || null,
      cloudCover: typeof scene?.properties?.['eo:cloud_cover'] === 'number' ? scene.properties['eo:cloud_cover'] : null,
      platform: scene?.properties?.platform || null,
    },
    bbox: input.bbox,
    ndvi: {
      previewPng,
      width: ndvi.width,
      height: ndvi.height,
      metricGrid: {
        encoded: encodeFloat32Grid(metricGrid.values),
        width: metricGrid.width,
        height: metricGrid.height,
        min: round(metricGrid.min, 4),
        max: round(metricGrid.max, 4),
      },
      stats: ndvi.stats,
      validPixelRatio: ndvi.validPixelRatio,
      grid3x3,
    },
  }
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

async function runSentinelHubProvider(input: Required<IngestRequest>): Promise<IngestResult> {
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

  const baseInput = {
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
  }

  const tiffResponse = await fetchWithTimeout(processUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: baseInput,
      evalscript: evalscriptNDVI,
      output: {
        responses: [{ identifier: 'default', format: { type: 'image/tiff' } }],
        width: input.targetSize,
        height: input.targetSize,
      },
    }),
  })

  if (!tiffResponse.ok) {
    throw new Error(`sentinel_tiff_process_failed_${tiffResponse.status}`)
  }

  const tiffArrayBuffer = await tiffResponse.arrayBuffer()
  const tiff = await fromArrayBuffer(tiffArrayBuffer)
  const image = await tiff.getImage()
  const raster: any = await image.readRasters({ interleave: true })
  const rawValues = raster as Float32Array
  const ndviValues = new Float32Array(rawValues.length)
  const validMask = new Uint8Array(rawValues.length)

  const valid: number[] = []
  for (let i = 0; i < rawValues.length; i++) {
    const raw = Number(rawValues[i])
    if (!Number.isFinite(raw)) {
      ndviValues[i] = 0
      continue
    }
    const value = clamp(raw, -1, 1)
    ndviValues[i] = value
    validMask[i] = 1
    valid.push(value)
  }

  valid.sort((a, b) => a - b)
  const min = valid.length ? valid[0] : 0
  const max = valid.length ? valid[valid.length - 1] : 0
  const mean = valid.length ? valid.reduce((acc, value) => acc + value, 0) / valid.length : 0
  const p10 = valid.length ? quantile(valid, 0.1) : 0
  const p90 = valid.length ? quantile(valid, 0.9) : 0

  const pngResponse = await fetchWithTimeout(processUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: baseInput,
      evalscript: evalscriptColorPNG,
      output: {
        responses: [{ identifier: 'default', format: { type: 'image/png' } }],
        width: input.targetSize,
        height: input.targetSize,
      },
    }),
  })

  if (!pngResponse.ok) {
    throw new Error(`sentinel_png_process_failed_${pngResponse.status}`)
  }

  const pngBuffer = Buffer.from(await pngResponse.arrayBuffer())
  const grid3x3 = computeGrid3x3(ndviValues, input.targetSize, input.targetSize, validMask)
  const metricGrid = downsampleNdviGrid(ndviValues, input.targetSize, input.targetSize, 128)

  return {
    provider: 'sentinel-hub-cdse',
    fallbackUsed: true,
    imagery: {
      id: `${providerLabel}:${fromDate}-${toDate}`,
      date: null,
      cloudCover: null,
      platform: 'Sentinel-2',
    },
    bbox: input.bbox,
    ndvi: {
      previewPng: pngBuffer.toString('base64'),
      width: input.targetSize,
      height: input.targetSize,
      metricGrid: {
        encoded: encodeFloat32Grid(metricGrid.values),
        width: metricGrid.width,
        height: metricGrid.height,
        min: round(metricGrid.min, 4),
        max: round(metricGrid.max, 4),
      },
      stats: {
        min: round(min),
        max: round(max),
        mean: round(mean),
        p10: round(p10),
        p90: round(p90),
      },
      validPixelRatio: round(valid.length / Math.max(1, ndviValues.length), 4),
      grid3x3,
    },
  }
}

function providerFailure(provider: string, error: unknown): ProviderFailure {
  const message = error instanceof Error ? error.message : 'unknown_error'
  return {
    provider,
    code: message,
    message,
  }
}

export async function runIngestPipeline(input: IngestRequest) {
  const normalized = normalizeRequest(input)
  const failures: ProviderFailure[] = []
  const warnings: string[] = []

  try {
    const primary = await runPlanetaryComputerProvider(normalized)
    if (primary.ndvi.validPixelRatio < 0.5) {
      warnings.push('Low valid pixel ratio detected. Consider adjusting date range or bbox.')
    }
    return { result: primary, warnings }
  } catch (error) {
    failures.push(providerFailure('planetary-computer-preview', error))
    warnings.push('Primary free satellite provider failed; attempting fallback provider.')
  }

  try {
    const fallback = await runSentinelHubProvider(normalized)
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

  return {
    error: 'ingest_failed',
    message: error instanceof Error ? error.message : 'Unknown ingest error',
    providers: [],
  }
}
