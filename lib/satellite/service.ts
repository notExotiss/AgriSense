import { PNG } from 'pngjs'
import { fromArrayBuffer } from 'geotiff'

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
    stats: {
      min: number
      max: number
      mean: number
      p10: number
      p90: number
    }
    validPixelRatio: number
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
  }
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
      stats: ndvi.stats,
      validPixelRatio: ndvi.validPixelRatio,
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
  const ndviValues = raster as Float32Array

  const valid: number[] = []
  for (let i = 0; i < ndviValues.length; i++) {
    const value = clamp(Number(ndviValues[i]), -1, 1)
    if (Number.isFinite(value)) valid.push(value)
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
      stats: {
        min: round(min),
        max: round(max),
        mean: round(mean),
        p10: round(p10),
        p90: round(p90),
      },
      validPixelRatio: round(valid.length / Math.max(1, ndviValues.length), 4),
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
