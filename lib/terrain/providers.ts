import { PNG } from 'pngjs'
import { fromArrayBuffer } from 'geotiff'
import type { ProviderDiagnostic, TerrainModelType } from '../types/api'
import { fetchWithTimeout, markProviderFailure, markProviderSuccess, shouldSkipProvider } from '../server/provider-runtime'

const PLANETARY_STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
const PLANETARY_SIGN = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign'
const TERRARIUM_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const USGS_3DEP_EXPORT = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
const TOKEN_URL_CLASSIC = 'https://services.sentinel-hub.com/oauth/token'
const PROCESS_URL_CLASSIC = 'https://services.sentinel-hub.com/api/v1/process'
const TOKEN_URL_CDSE = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
const PROCESS_URL_CDSE = 'https://sh.dataspace.copernicus.eu/api/v1/process'

const OPENTOPO_USGS = 'https://portal.opentopography.org/API/usgsdem'
const OPENTOPO_GLOBAL = 'https://portal.opentopography.org/API/globaldem'
const GOOGLE_ELEVATION_API = 'https://maps.googleapis.com/maps/api/elevation/json'

type BBox = [number, number, number, number]

export type TerrainProviderInput = {
  bbox: BBox
  resolution: number
  timeoutMs?: number
  openTopoApiKey?: string | null
  googleMapsApiKey?: string | null
}

export type TerrainProviderResult = {
  demGrid: number[]
  width: number
  height: number
  bbox: BBox
  demSource: string
  demDataset: string
  modelType: TerrainModelType
  verticalDatum: string
  sourceResolutionMeters: number
  effectiveResolutionMeters: number
  warnings: string[]
}

export type TerrainProviderChainOutput = {
  result: TerrainProviderResult
  providersTried: ProviderDiagnostic[]
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function approxPixelSizeMeters(bbox: BBox, width: number, height: number) {
  const lonStep = Math.abs(bbox[2] - bbox[0]) / Math.max(1, width)
  const latStep = Math.abs(bbox[3] - bbox[1]) / Math.max(1, height)
  const latMid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const metersPerDegLat = 111320
  const metersPerDegLon = Math.max(1, Math.cos(latMid) * 111320)
  return (lonStep * metersPerDegLon + latStep * metersPerDegLat) / 2
}

function isUsBbox(bbox: BBox) {
  const centerLon = (bbox[0] + bbox[2]) / 2
  const centerLat = (bbox[1] + bbox[3]) / 2
  return centerLon >= -172 && centerLon <= -60 && centerLat >= 16 && centerLat <= 72
}

function spanMeters(bbox: BBox) {
  const lonSpan = Math.abs(bbox[2] - bbox[0])
  const latSpan = Math.abs(bbox[3] - bbox[1])
  const latMid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const metersPerDegLat = 111320
  const metersPerDegLon = Math.max(1, Math.cos(latMid) * 111320)
  return Math.max(lonSpan * metersPerDegLon, latSpan * metersPerDegLat)
}

function chooseGoogleSampleResolution(bbox: BBox, requestedResolution: number) {
  const span = spanMeters(bbox)
  const preferred = span <= 5000 ? 96 : span <= 15000 ? 80 : 64
  return clamp(Math.min(requestedResolution, preferred), 48, 96)
}

function isPlausibleElevation(value: number) {
  return Number.isFinite(value) && value > -650 && value < 9500
}

function rounded(value: number, precision = 2) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function bilinearSample(values: number[], width: number, height: number, x: number, y: number) {
  const sx = clamp(x, 0, width - 1)
  const sy = clamp(y, 0, height - 1)
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = sx - x0
  const ty = sy - y0

  const idx00 = y0 * width + x0
  const idx10 = y0 * width + x1
  const idx01 = y1 * width + x0
  const idx11 = y1 * width + x1

  const samples = [
    { value: values[idx00], w: (1 - tx) * (1 - ty) },
    { value: values[idx10], w: tx * (1 - ty) },
    { value: values[idx01], w: (1 - tx) * ty },
    { value: values[idx11], w: tx * ty },
  ]

  let weighted = 0
  let weight = 0
  for (const sample of samples) {
    if (!isPlausibleElevation(sample.value)) continue
    weighted += sample.value * sample.w
    weight += sample.w
  }
  if (weight <= 1e-9) return Number.NaN
  return weighted / weight
}

function resampleGrid(values: number[], srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number) {
  if (srcWidth === dstWidth && srcHeight === dstHeight) return values.slice()
  const out = new Array(dstWidth * dstHeight).fill(Number.NaN)
  for (let y = 0; y < dstHeight; y++) {
    const sy = (y / Math.max(1, dstHeight - 1)) * (srcHeight - 1)
    for (let x = 0; x < dstWidth; x++) {
      const sx = (x / Math.max(1, dstWidth - 1)) * (srcWidth - 1)
      out[y * dstWidth + x] = bilinearSample(values, srcWidth, srcHeight, sx, sy)
    }
  }
  return out
}

async function decodeSingleBandTiff(buffer: Buffer, targetWidth?: number, targetHeight?: number) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  const tiff = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const width = Number(image.getWidth())
  const height = Number(image.getHeight())
  const nodataRaw = image.getGDALNoData()
  const nodata = Number.isFinite(Number(nodataRaw)) ? Number(nodataRaw) : null
  const raster: any = await image.readRasters({ interleave: true })

  const rawValues = new Array(width * height)
  for (let i = 0; i < rawValues.length; i++) {
    const value = Number(raster[i])
    const noData = nodata != null && Math.abs(value - nodata) < 1e-6
    rawValues[i] = !Number.isFinite(value) || noData ? Number.NaN : value
  }

  const outWidth = targetWidth && targetWidth > 1 ? targetWidth : width
  const outHeight = targetHeight && targetHeight > 1 ? targetHeight : height
  const resampled = resampleGrid(rawValues, width, height, outWidth, outHeight).map((value) =>
    Number.isFinite(value) ? rounded(value, 2) : Number.NaN
  )

  return {
    values: resampled,
    width: outWidth,
    height: outHeight,
  }
}

function parseProviderError(response: Response, provider: string, fallbackStatus?: number) {
  if (!response.ok) {
    return new Error(`${provider}_failed_${response.status}`)
  }
  if (fallbackStatus) return new Error(`${provider}_failed_${fallbackStatus}`)
  return new Error(`${provider}_failed`)
}

async function signPlanetaryUrl(url: string) {
  const response = await fetchWithTimeout(`${PLANETARY_SIGN}?href=${encodeURIComponent(url)}`, {}, 10000)
  if (!response.ok) return url
  const payload = await response.json().catch(() => ({}))
  return (payload?.href as string) || (payload?.signedHref as string) || url
}

function pickDemAsset(feature: any) {
  const assets = feature?.assets || {}
  const firstAsset = (Object.values(assets) as any[])[0]
  return assets?.data?.href || assets?.dem?.href || assets?.elevation?.href || firstAsset?.href || null
}

async function fetchOpenTopographyUSGS(
  bbox: BBox,
  resolution: number,
  apiKey: string,
  datasetName: 'USGS10m' | 'USGS30m'
): Promise<TerrainProviderResult> {
  const url = new URL(OPENTOPO_USGS)
  url.searchParams.set('datasetName', datasetName)
  url.searchParams.set('south', String(bbox[1]))
  url.searchParams.set('north', String(bbox[3]))
  url.searchParams.set('west', String(bbox[0]))
  url.searchParams.set('east', String(bbox[2]))
  url.searchParams.set('outputFormat', 'GTiff')
  url.searchParams.set('API_Key', apiKey)

  const response = await fetchWithTimeout(url.toString(), {}, 30000)
  if (!response.ok) throw parseProviderError(response, `opentopography_${datasetName.toLowerCase()}`)
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('json')) {
    const payload = await response.json().catch(() => ({}))
    const message = payload?.error || payload?.message || `opentopography_${datasetName.toLowerCase()}_json_error`
    throw new Error(String(message))
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const decoded = await decodeSingleBandTiff(buffer, resolution, resolution)

  return {
    demGrid: decoded.values,
    width: decoded.width,
    height: decoded.height,
    bbox,
    demSource: 'opentopography',
    demDataset: datasetName,
    modelType: 'DTM',
    verticalDatum: datasetName === 'USGS10m' || datasetName === 'USGS30m' ? 'NAVD88 (source-native)' : 'source-native',
    sourceResolutionMeters: datasetName === 'USGS10m' ? 10 : 30,
    effectiveResolutionMeters: approxPixelSizeMeters(bbox, decoded.width, decoded.height),
    warnings: [],
  }
}

async function fetchOpenTopographyGlobalCOP30(
  bbox: BBox,
  resolution: number,
  apiKey: string
): Promise<TerrainProviderResult> {
  const url = new URL(OPENTOPO_GLOBAL)
  url.searchParams.set('demtype', 'COP30')
  url.searchParams.set('south', String(bbox[1]))
  url.searchParams.set('north', String(bbox[3]))
  url.searchParams.set('west', String(bbox[0]))
  url.searchParams.set('east', String(bbox[2]))
  url.searchParams.set('outputFormat', 'GTiff')
  url.searchParams.set('API_Key', apiKey)

  const response = await fetchWithTimeout(url.toString(), {}, 30000)
  if (!response.ok) throw parseProviderError(response, 'opentopography_cop30')
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('json')) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(String(payload?.error || payload?.message || 'opentopography_cop30_json_error'))
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const decoded = await decodeSingleBandTiff(buffer, resolution, resolution)

  return {
    demGrid: decoded.values,
    width: decoded.width,
    height: decoded.height,
    bbox,
    demSource: 'opentopography',
    demDataset: 'COP30',
    modelType: 'DTM',
    verticalDatum: 'EGM2008 (source-native)',
    sourceResolutionMeters: 30,
    effectiveResolutionMeters: approxPixelSizeMeters(bbox, decoded.width, decoded.height),
    warnings: [],
  }
}

async function fetchGoogleElevationDem(
  bbox: BBox,
  resolution: number,
  apiKey: string
): Promise<TerrainProviderResult> {
  const sampleResolution = chooseGoogleSampleResolution(bbox, resolution)
  const totalSamples = sampleResolution * sampleResolution
  const points = new Array<{ lat: number; lon: number }>(totalSamples)

  for (let row = 0; row < sampleResolution; row++) {
    const yT = row / Math.max(1, sampleResolution - 1)
    const lat = bbox[3] - (bbox[3] - bbox[1]) * yT
    for (let col = 0; col < sampleResolution; col++) {
      const xT = col / Math.max(1, sampleResolution - 1)
      const lon = bbox[0] + (bbox[2] - bbox[0]) * xT
      points[row * sampleResolution + col] = { lat, lon }
    }
  }

  const chunkSize = 128
  const elevations = new Array<number>(totalSamples).fill(Number.NaN)
  let resolutionSum = 0
  let resolutionCount = 0

  for (let offset = 0; offset < points.length; offset += chunkSize) {
    const chunk = points.slice(offset, offset + chunkSize)
    const url = new URL(GOOGLE_ELEVATION_API)
    url.searchParams.set(
      'locations',
      chunk.map((point) => `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`).join('|')
    )
    url.searchParams.set('key', apiKey)

    const response = await fetchWithTimeout(url.toString(), {}, 18000)
    if (!response.ok) throw parseProviderError(response, 'google_elevation')
    const payload = await response.json().catch(() => ({}))
    const status = String(payload?.status || '').toUpperCase()
    if (status !== 'OK') {
      const message =
        status === 'OVER_QUERY_LIMIT'
          ? 'google_elevation_over_query_limit'
          : status === 'REQUEST_DENIED'
            ? 'google_elevation_request_denied'
            : status === 'INVALID_REQUEST'
              ? 'google_elevation_invalid_request'
              : `google_elevation_status_${status || 'UNKNOWN'}`
      throw new Error(message)
    }

    const results = Array.isArray(payload?.results) ? payload.results : []
    for (let i = 0; i < chunk.length; i++) {
      const result = results[i]
      const elevation = Number(result?.elevation)
      elevations[offset + i] = Number.isFinite(elevation) ? rounded(elevation, 2) : Number.NaN
      const sourceResolution = Number(result?.resolution)
      if (Number.isFinite(sourceResolution) && sourceResolution > 0) {
        resolutionSum += sourceResolution
        resolutionCount += 1
      }
    }
  }

  const hasData = elevations.some((value) => Number.isFinite(value))
  if (!hasData) throw new Error('google_elevation_no_data')

  const resampled = resampleGrid(
    elevations,
    sampleResolution,
    sampleResolution,
    resolution,
    resolution
  ).map((value) => (Number.isFinite(value) ? rounded(value, 2) : Number.NaN))

  const sourceResolutionMeters =
    resolutionCount > 0
      ? resolutionSum / resolutionCount
      : approxPixelSizeMeters(bbox, sampleResolution, sampleResolution)

  return {
    demGrid: resampled,
    width: resolution,
    height: resolution,
    bbox,
    demSource: 'google-elevation',
    demDataset: `elevation-api-${sampleResolution}x${sampleResolution}`,
    modelType: 'DTM',
    verticalDatum: 'EGM96 (source-native)',
    sourceResolutionMeters,
    effectiveResolutionMeters: approxPixelSizeMeters(bbox, resolution, resolution),
    warnings: [
      'Google Elevation API samples a raster source with variable native resolution by location.',
    ],
  }
}

async function fetchUsgs3depDirect(bbox: BBox, resolution: number): Promise<TerrainProviderResult> {
  const url = new URL(USGS_3DEP_EXPORT)
  url.searchParams.set('bbox', bbox.join(','))
  url.searchParams.set('bboxSR', '4326')
  url.searchParams.set('imageSR', '4326')
  url.searchParams.set('size', `${resolution},${resolution}`)
  url.searchParams.set('format', 'tiff')
  url.searchParams.set('pixelType', 'F32')
  url.searchParams.set('interpolation', 'RSP_BilinearInterpolation')
  url.searchParams.set('f', 'image')

  const response = await fetchWithTimeout(url.toString(), {}, 18000)
  if (!response.ok) throw parseProviderError(response, 'usgs_3dep_direct')
  const buffer = Buffer.from(await response.arrayBuffer())
  const decoded = await decodeSingleBandTiff(buffer, resolution, resolution)
  return {
    demGrid: decoded.values,
    width: decoded.width,
    height: decoded.height,
    bbox,
    demSource: 'usgs-3dep',
    demDataset: '3DEP-ImageServer',
    modelType: 'DTM',
    verticalDatum: 'NAVD88 (source-native)',
    sourceResolutionMeters: 10,
    effectiveResolutionMeters: approxPixelSizeMeters(bbox, decoded.width, decoded.height),
    warnings: [],
  }
}

async function fetchPlanetaryCopDem(bbox: BBox, resolution: number): Promise<TerrainProviderResult> {
  const stacResponse = await fetchWithTimeout(
    PLANETARY_STAC,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['cop-dem-glo-30'],
        bbox,
        limit: 6,
      }),
    },
    14000
  )
  if (!stacResponse.ok) throw parseProviderError(stacResponse, 'planetary_copdem_stac')
  const stacJson = await stacResponse.json()
  const feature = Array.isArray(stacJson?.features) ? stacJson.features[0] : null
  if (!feature) throw new Error('planetary_copdem_not_found')

  const rawAsset = pickDemAsset(feature)
  if (!rawAsset) throw new Error('planetary_copdem_asset_missing')
  const signed = await signPlanetaryUrl(String(rawAsset))
  const demResponse = await fetchWithTimeout(signed, {}, 18000)
  if (!demResponse.ok) throw parseProviderError(demResponse, 'planetary_copdem_fetch')
  const buffer = Buffer.from(await demResponse.arrayBuffer())
  const decoded = await decodeSingleBandTiff(buffer, resolution, resolution)
  return {
    demGrid: decoded.values,
    width: decoded.width,
    height: decoded.height,
    bbox,
    demSource: 'planetary-computer',
    demDataset: 'cop-dem-glo-30',
    modelType: 'DTM',
    verticalDatum: 'EGM2008 (source-native)',
    sourceResolutionMeters: 30,
    effectiveResolutionMeters: approxPixelSizeMeters(bbox, decoded.width, decoded.height),
    warnings: [],
  }
}

async function getSentinelTokenClassic() {
  const id = process.env.SENTINEL_HUB_CLIENT_ID
  const secret = process.env.SENTINEL_HUB_CLIENT_SECRET
  if (!id || !secret) return null
  const response = await fetchWithTimeout(
    TOKEN_URL_CLASSIC,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: id,
        client_secret: secret,
      }),
    },
    12000
  )
  if (!response.ok) return null
  const json = await response.json().catch(() => ({}))
  return typeof json?.access_token === 'string' ? json.access_token : null
}

async function getSentinelTokenCdse() {
  const id = process.env.SENTINEL_HUB_CLIENT_ID
  const secret = process.env.SENTINEL_HUB_CLIENT_SECRET
  if (!id || !secret) return null
  const response = await fetchWithTimeout(
    TOKEN_URL_CDSE,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: id,
        client_secret: secret,
      }),
    },
    12000
  )
  if (!response.ok) return null
  const json = await response.json().catch(() => ({}))
  return typeof json?.access_token === 'string' ? json.access_token : null
}

async function fetchSentinelHubCopDem(bbox: BBox, resolution: number): Promise<TerrainProviderResult> {
  let token = await getSentinelTokenClassic()
  let processUrl = PROCESS_URL_CLASSIC
  if (!token) {
    token = await getSentinelTokenCdse()
    processUrl = PROCESS_URL_CDSE
  }
  if (!token) throw new Error('sentinel_dem_credentials_missing')

  const evalscript = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["DEM"] }],
    output: { bands: 1, sampleType: "FLOAT32" }
  };
}
function evaluatePixel(sample) {
  return [sample.DEM];
}`

  const response = await fetchWithTimeout(
    processUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          bounds: {
            bbox,
            properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
          },
          data: [
            {
              type: 'dem',
              dataFilter: { demInstance: 'COPERNICUS_30' },
            },
          ],
        },
        output: {
          responses: [{ identifier: 'default', format: { type: 'image/tiff' } }],
          width: resolution,
          height: resolution,
        },
        evalscript,
      }),
    },
    22000
  )
  if (!response.ok) throw parseProviderError(response, 'sentinel_hub_copdem')

  const buffer = Buffer.from(await response.arrayBuffer())
  const decoded = await decodeSingleBandTiff(buffer, resolution, resolution)
  return {
    demGrid: decoded.values,
    width: decoded.width,
    height: decoded.height,
    bbox,
    demSource: 'sentinel-hub',
    demDataset: 'copernicus-dem-30',
    modelType: 'DTM',
    verticalDatum: 'EGM2008 (source-native)',
    sourceResolutionMeters: 30,
    effectiveResolutionMeters: approxPixelSizeMeters(bbox, decoded.width, decoded.height),
    warnings: [],
  }
}

function lonLatToTileFraction(lon: number, lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180
  const n = Math.pow(2, zoom)
  const x = ((lon + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

function chooseTerrariumZoom(bbox: BBox) {
  const lonSpan = Math.abs(bbox[2] - bbox[0])
  const latSpan = Math.abs(bbox[3] - bbox[1])
  const span = Math.max(lonSpan, latSpan)
  if (span > 1.2) return 9
  if (span > 0.45) return 10
  if (span > 0.15) return 11
  if (span > 0.05) return 12
  if (span > 0.015) return 13
  if (span > 0.005) return 14
  return 15
}

function decodeTerrarium(r: number, g: number, b: number) {
  return r * 256 + g + b / 256 - 32768
}

async function fetchTerrariumDem(bbox: BBox, resolution: number): Promise<TerrainProviderResult> {
  const zoom = chooseTerrariumZoom(bbox)
  const cache = new Map<string, PNG>()
  const result = new Array<number>(resolution * resolution).fill(Number.NaN)

  for (let row = 0; row < resolution; row++) {
    const yT = row / Math.max(1, resolution - 1)
    const lat = bbox[3] - (bbox[3] - bbox[1]) * yT
    for (let col = 0; col < resolution; col++) {
      const xT = col / Math.max(1, resolution - 1)
      const lon = bbox[0] + (bbox[2] - bbox[0]) * xT
      const tileFraction = lonLatToTileFraction(lon, lat, zoom)
      const tileX = Math.floor(tileFraction.x)
      const tileY = Math.floor(tileFraction.y)
      const key = `${zoom}/${tileX}/${tileY}`

      let tile = cache.get(key)
      if (!tile) {
        const url = `${TERRARIUM_BASE}/${zoom}/${tileX}/${tileY}.png`
        const response = await fetchWithTimeout(url, {}, 10000)
        if (!response.ok) throw parseProviderError(response, 'terrarium_tiles')
        const buffer = Buffer.from(await response.arrayBuffer())
        tile = PNG.sync.read(buffer)
        cache.set(key, tile)
      }

      const px = Math.max(0, Math.min(255, Math.floor((tileFraction.x - tileX) * 256)))
      const py = Math.max(0, Math.min(255, Math.floor((tileFraction.y - tileY) * 256)))
      const idx = (py * tile.width + px) * 4
      const elevation = decodeTerrarium(tile.data[idx], tile.data[idx + 1], tile.data[idx + 2])
      result[row * resolution + col] = Number.isFinite(elevation) ? rounded(elevation, 2) : Number.NaN
    }
  }

  const latMid = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const sourceResolutionMeters = (156543.03392 * Math.cos(latMid)) / Math.pow(2, zoom)
  return {
    demGrid: result,
    width: resolution,
    height: resolution,
    bbox,
    demSource: 'terrarium',
    demDataset: `terrarium-z${zoom}`,
    modelType: 'DSM',
    verticalDatum: 'approx (source-native)',
    sourceResolutionMeters,
    effectiveResolutionMeters: approxPixelSizeMeters(bbox, resolution, resolution),
    warnings: ['Terrarium fallback in use. Resolution may be coarse for plot-level terrain decisions.'],
  }
}

async function tryProvider(
  providerName: string,
  providersTried: ProviderDiagnostic[],
  run: () => Promise<TerrainProviderResult>
) {
  if (shouldSkipProvider(providerName)) {
    providersTried.push({ provider: providerName, ok: false, reason: 'cooldown' })
    throw new Error(`${providerName}_cooldown`)
  }
  const started = Date.now()
  try {
    const result = await run()
    providersTried.push({
      provider: providerName,
      ok: true,
      durationMs: Date.now() - started,
    })
    markProviderSuccess(providerName)
    return result
  } catch (error: any) {
    providersTried.push({
      provider: providerName,
      ok: false,
      reason: String(error?.message || `${providerName}_failed`),
      durationMs: Date.now() - started,
    })
    markProviderFailure(providerName, { threshold: 2, cooldownMs: 90000 })
    throw error
  }
}

export async function fetchTerrainFromProviders(input: TerrainProviderInput): Promise<TerrainProviderChainOutput> {
  const providersTried: ProviderDiagnostic[] = []
  const openTopoKey = (input.openTopoApiKey || '').trim()
  const googleKey = (input.googleMapsApiKey || '').trim()
  const isUs = isUsBbox(input.bbox)

  if (openTopoKey && isUs) {
    try {
      const usgs10m = await tryProvider('opentopography-usgs10m', providersTried, () =>
        fetchOpenTopographyUSGS(input.bbox, input.resolution, openTopoKey, 'USGS10m')
      )
      return { result: usgs10m, providersTried }
    } catch {}
    try {
      const usgs30m = await tryProvider('opentopography-usgs30m', providersTried, () =>
        fetchOpenTopographyUSGS(input.bbox, input.resolution, openTopoKey, 'USGS30m')
      )
      return { result: usgs30m, providersTried }
    } catch {}
  } else if (!openTopoKey) {
    providersTried.push({ provider: 'opentopography-usgs10m', ok: false, reason: 'missing_OPENTOPO_API_KEY' })
  }

  if (isUs) {
    try {
      const usgsDirect = await tryProvider('usgs-3dep-direct', providersTried, () =>
        fetchUsgs3depDirect(input.bbox, input.resolution)
      )
      return { result: usgsDirect, providersTried }
    } catch {}
  }

  if (openTopoKey) {
    try {
      const globalCop = await tryProvider('opentopography-cop30', providersTried, () =>
        fetchOpenTopographyGlobalCOP30(input.bbox, input.resolution, openTopoKey)
      )
      return { result: globalCop, providersTried }
    } catch {}
  } else {
    providersTried.push({ provider: 'opentopography-cop30', ok: false, reason: 'missing_OPENTOPO_API_KEY' })
  }

  if (googleKey) {
    try {
      const google = await tryProvider('google-elevation', providersTried, () =>
        fetchGoogleElevationDem(input.bbox, input.resolution, googleKey)
      )
      return { result: google, providersTried }
    } catch {}
  } else {
    providersTried.push({ provider: 'google-elevation', ok: false, reason: 'missing_GOOGLE_MAPS_API_KEY' })
  }

  try {
    const sentinel = await tryProvider('sentinel-hub-copdem', providersTried, () =>
      fetchSentinelHubCopDem(input.bbox, input.resolution)
    )
    return { result: sentinel, providersTried }
  } catch {}

  try {
    const planetary = await tryProvider('planetary-copdem', providersTried, () =>
      fetchPlanetaryCopDem(input.bbox, input.resolution)
    )
    return { result: planetary, providersTried }
  } catch {}

  try {
    const terrarium = await tryProvider('terrarium-tiles', providersTried, () =>
      fetchTerrariumDem(input.bbox, input.resolution)
    )
    return { result: terrarium, providersTried }
  } catch (error: any) {
    const wrapped = new Error(String(error?.message || 'all_terrain_providers_failed'))
    ;(wrapped as any).providersTried = providersTried
    throw wrapped
  }
}
