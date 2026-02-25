import type { NextApiRequest, NextApiResponse } from 'next'
import { PNG } from 'pngjs'
import { fromArrayBuffer } from 'geotiff'
import type { ProviderDiagnostic } from '../../../lib/types/api'
import { fetchWithTimeout } from '../../../lib/server/provider-runtime'

type TerrainResponse = {
  success: boolean
  degraded?: boolean
  reason?: string
  meshMeta?: {
    smoothed: boolean
    resolution: number
  }
  data: {
    demGrid: number[]
    width: number
    height: number
    bbox: [number, number, number, number]
    source: string
    isSimulated: boolean
    texturePng?: string | null
  }
  warnings: string[]
  providersTried: ProviderDiagnostic[]
}

type TerrainError = {
  error: string
  message: string
  reason?: string
  providersTried?: ProviderDiagnostic[]
}

const PLANETARY_STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
const PLANETARY_SIGN = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign'
const TERRARIUM_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'

type TerrainQuality = 'high' | 'balanced' | 'light'

function normalizeBody(body: any) {
  const bbox = Array.isArray(body?.bbox) ? body.bbox.map(Number) : []
  if (bbox.length !== 4 || bbox.some((n: number) => Number.isNaN(n))) throw new Error('bbox_required')
  const quality: TerrainQuality =
    body?.quality === 'light' || body?.quality === 'balanced' || body?.quality === 'high'
      ? body.quality
      : 'high'
  const defaultResolution = quality === 'high' ? 128 : quality === 'balanced' ? 96 : 64
  const resolution = [64, 96, 128].includes(Number(body?.resolution)) ? Number(body?.resolution) : defaultResolution
  const layer = body?.layer === 'soil' || body?.layer === 'et' ? body.layer : 'ndvi'
  return {
    bbox: bbox as [number, number, number, number],
    resolution,
    layer,
    quality,
  }
}

function toFixedGrid(values: number[], precision = 2) {
  return values.map((value) => Number(value.toFixed(precision)))
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

async function fetchPlanetaryDem(
  bbox: [number, number, number, number],
  resolution: number
) {
  const stacResponse = await fetchWithTimeout(
    PLANETARY_STAC,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['cop-dem-glo-30'],
        bbox,
        limit: 8,
      }),
    },
    14000
  )
  if (!stacResponse.ok) throw new Error(`planetary_stac_failed_${stacResponse.status}`)
  const stacJson = await stacResponse.json()
  const feature = Array.isArray(stacJson?.features) ? stacJson.features[0] : null
  if (!feature) throw new Error('planetary_dem_not_found')

  const rawAsset = pickDemAsset(feature)
  if (!rawAsset) throw new Error('planetary_dem_asset_missing')
  const signed = await signPlanetaryUrl(String(rawAsset))

  const demResponse = await fetchWithTimeout(signed, {}, 18000)
  if (!demResponse.ok) throw new Error(`planetary_dem_fetch_failed_${demResponse.status}`)

  const arrayBuffer = await demResponse.arrayBuffer()
  const tiff = await fromArrayBuffer(arrayBuffer)
  const image = await tiff.getImage()
  const raster: any = await image.readRasters({
    bbox,
    width: resolution,
    height: resolution,
    resampleMethod: 'bilinear',
    interleave: true,
  })

  const values = Array.from(raster as ArrayLike<number>)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))

  if (!values.length) throw new Error('planetary_dem_empty')
  return toFixedGrid(values)
}

function lonLatToTileFraction(lon: number, lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180
  const n = Math.pow(2, zoom)
  const x = ((lon + 180) / 360) * n
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  return { x, y }
}

function chooseZoom(bbox: [number, number, number, number]) {
  const lonSpan = Math.abs(bbox[2] - bbox[0])
  const latSpan = Math.abs(bbox[3] - bbox[1])
  const span = Math.max(lonSpan, latSpan)
  if (span > 1.2) return 9
  if (span > 0.45) return 10
  if (span > 0.15) return 11
  if (span > 0.05) return 12
  return 13
}

function decodeTerrarium(r: number, g: number, b: number) {
  return r * 256 + g + b / 256 - 32768
}

async function fetchTerrariumDem(
  bbox: [number, number, number, number],
  resolution: number
) {
  const zoom = chooseZoom(bbox)
  const cache = new Map<string, PNG>()
  const result: number[] = new Array(resolution * resolution).fill(0)

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
        if (!response.ok) throw new Error(`terrarium_tile_failed_${response.status}`)
        const buffer = Buffer.from(await response.arrayBuffer())
        tile = PNG.sync.read(buffer)
        cache.set(key, tile)
      }

      const px = Math.max(0, Math.min(255, Math.floor((tileFraction.x - tileX) * 256)))
      const py = Math.max(0, Math.min(255, Math.floor((tileFraction.y - tileY) * 256)))
      const idx = (py * tile.width + px) * 4
      const elevation = decodeTerrarium(tile.data[idx], tile.data[idx + 1], tile.data[idx + 2])
      result[row * resolution + col] = Number.isFinite(elevation) ? elevation : 0
    }
  }

  return toFixedGrid(result)
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TerrainResponse | TerrainError>
) {
  try {
    if (req.method !== 'POST') return res.status(405).end()

    let normalized: ReturnType<typeof normalizeBody>
    try {
      normalized = normalizeBody(req.body || {})
    } catch (error: any) {
      return res.status(400).json({
        error: 'bbox_required',
        message: error?.message === 'bbox_required' ? 'Bounding box [minLon,minLat,maxLon,maxLat] is required.' : 'Invalid request body.',
      })
    }

    const providersTried: ProviderDiagnostic[] = []
    const warnings: string[] = []

    try {
      const started = Date.now()
      const demGrid = await fetchPlanetaryDem(normalized.bbox, normalized.resolution)
      providersTried.push({ provider: 'planetary-computer-dem', ok: true, durationMs: Date.now() - started })
      return res.status(200).json({
        success: true,
        meshMeta: {
          smoothed: false,
          resolution: normalized.resolution,
        },
        data: {
          demGrid,
          width: normalized.resolution,
          height: normalized.resolution,
          bbox: normalized.bbox,
          source: 'planetary-computer-dem',
          isSimulated: false,
          texturePng: null,
        },
        warnings,
        providersTried,
      })
    } catch (error: any) {
      providersTried.push({
        provider: 'planetary-computer-dem',
        ok: false,
        reason: String(error?.message || 'planetary_failed'),
      })
      warnings.push('Primary DEM provider unavailable; attempting fallback terrain tiles.')
    }

    try {
      const started = Date.now()
      const demGrid = await fetchTerrariumDem(normalized.bbox, normalized.resolution)
      providersTried.push({ provider: 'terrarium-tiles', ok: true, durationMs: Date.now() - started })
      return res.status(200).json({
        success: true,
        meshMeta: {
          smoothed: false,
          resolution: normalized.resolution,
        },
        data: {
          demGrid,
          width: normalized.resolution,
          height: normalized.resolution,
          bbox: normalized.bbox,
          source: 'terrarium-tiles',
          isSimulated: false,
          texturePng: null,
        },
        warnings,
        providersTried,
      })
    } catch (error: any) {
      providersTried.push({
        provider: 'terrarium-tiles',
        ok: false,
        reason: String(error?.message || 'terrarium_failed'),
      })
      warnings.push('Terrain providers failed for this AOI. 3D view is unavailable in this run.')
      return res.status(200).json({
        success: true,
        degraded: true,
        reason: 'terrain_unavailable',
        meshMeta: {
          smoothed: false,
          resolution: normalized.resolution,
        },
        data: {
          demGrid: [],
          width: 0,
          height: 0,
          bbox: normalized.bbox,
          source: 'terrain-unavailable',
          isSimulated: false,
          texturePng: null,
        },
        warnings,
        providersTried,
      })
    }
  } catch (error: any) {
    return res.status(200).json({
      success: true,
      degraded: true,
      reason: 'terrain_unavailable',
      meshMeta: {
        smoothed: false,
        resolution: 0,
      },
      data: {
        demGrid: [],
        width: 0,
        height: 0,
        bbox: [-180, -90, 180, 90],
        source: 'terrain-unavailable',
        isSimulated: false,
        texturePng: null,
      },
      warnings: [String(error?.message || 'Unexpected terrain failure.')],
      providersTried: [],
    })
  }
}
