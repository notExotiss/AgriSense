import type { NextApiRequest, NextApiResponse } from 'next'
import { PNG } from 'pngjs'
import { getAdminDb } from '../../lib/firebaseAdmin'
import type { ProviderDiagnostic, TimeseriesPoint, TimeseriesResponse, ApiErrorResponse } from '../../lib/types/api'
import { FEATURE_FLAGS } from '../../lib/config/features'
import { fetchWithTimeout, markProviderFailure, markProviderSuccess, shouldSkipProvider } from '../../lib/server/provider-runtime'
import { makeCacheKey, readMemoryCache, writeMemoryCache } from '../../lib/server/cache'

const STAC_URL = 'https://planetarycomputer.microsoft.com/api/stac/v1/search'
const PREVIEW_URL = 'https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png'
const PROVIDER_NAME = 'planetary-computer-timeseries'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

type Interval = 'daily' | 'weekly' | 'monthly'
type Scene = {
  id: string
  date: string
  cloudCover: number | null
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function seededRandom(seedInput: string) {
  let seed = 0
  for (let i = 0; i < seedInput.length; i++) seed = (seed << 5) - seed + seedInput.charCodeAt(i)
  return () => {
    seed ^= seed << 13
    seed ^= seed >> 17
    seed ^= seed << 5
    return Math.abs(seed % 1000000) / 1000000
  }
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function normalizeInput(body: any) {
  const bbox = Array.isArray(body?.bbox) ? body.bbox.map(Number) : []
  if (bbox.length !== 4 || bbox.some((n: number) => Number.isNaN(n))) {
    throw new Error('bbox_required')
  }
  const endDate = body?.endDate ? new Date(body.endDate) : new Date()
  const startDate = body?.startDate ? new Date(body.startDate) : new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000)
  const interval: Interval = ['daily', 'weekly', 'monthly'].includes(body?.interval) ? body.interval : 'weekly'
  return {
    bbox: bbox as [number, number, number, number],
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    interval,
  }
}

function intervalBucket(date: string, interval: Interval) {
  const parsed = new Date(date)
  if (interval === 'daily') return formatDate(parsed)
  if (interval === 'weekly') {
    const day = parsed.getUTCDay() || 7
    parsed.setUTCDate(parsed.getUTCDate() - day + 1)
    return formatDate(parsed)
  }
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}`
}

function pickScenePerBucket(items: any[], interval: Interval) {
  const map = new Map<string, Scene>()
  for (const item of items) {
    const id = String(item?.id || '')
    const date = String(item?.properties?.datetime || '').slice(0, 10)
    if (!id || !date || !item?.assets?.B04?.href || !item?.assets?.B08?.href) continue
    const cloud = typeof item?.properties?.['eo:cloud_cover'] === 'number' ? Number(item.properties['eo:cloud_cover']) : null
    const key = intervalBucket(date, interval)
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { id, date, cloudCover: cloud })
      continue
    }
    const existingCloud = existing.cloudCover ?? 100
    const currentCloud = cloud ?? 100
    if (currentCloud < existingCloud || (currentCloud === existingCloud && date > existing.date)) {
      map.set(key, { id, date, cloudCover: cloud })
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-24)
}

function buildPreviewUrl(
  itemId: string,
  band: 'B04' | 'B08',
  bbox: [number, number, number, number],
  size = 96
) {
  const url = new URL(PREVIEW_URL)
  url.searchParams.set('collection', 'sentinel-2-l2a')
  url.searchParams.set('item', itemId)
  url.searchParams.set('assets', band)
  url.searchParams.set('asset_bidx', `${band}|1`)
  url.searchParams.set('nodata', '0')
  url.searchParams.set('format', 'png')
  url.searchParams.set('rescale', '0,3000')
  url.searchParams.set('bbox', bbox.join(','))
  url.searchParams.set('width', String(size))
  url.searchParams.set('height', String(size))
  return url.toString()
}

async function computeSceneNdviMean(scene: Scene, bbox: [number, number, number, number]) {
  const [b04Response, b08Response] = await Promise.all([
    fetchWithTimeout(buildPreviewUrl(scene.id, 'B04', bbox), {}, 12000),
    fetchWithTimeout(buildPreviewUrl(scene.id, 'B08', bbox), {}, 12000),
  ])

  if (!b04Response.ok || !b08Response.ok) {
    throw new Error(`band_fetch_failed_${b04Response.status}_${b08Response.status}`)
  }

  const red = PNG.sync.read(Buffer.from(await b04Response.arrayBuffer()))
  const nir = PNG.sync.read(Buffer.from(await b08Response.arrayBuffer()))
  if (red.width !== nir.width || red.height !== nir.height) {
    throw new Error('band_dimension_mismatch')
  }

  const totalPixels = red.width * red.height
  let valid = 0
  let sum = 0
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4
    const r = red.data[idx]
    const n = nir.data[idx]
    const den = n + r
    if (den <= 0) continue
    const ndvi = clamp((n - r) / den, -1, 1)
    if (!Number.isFinite(ndvi)) continue
    valid += 1
    sum += ndvi
  }
  if (!valid) throw new Error('no_valid_pixels')
  return {
    mean: Number((sum / valid).toFixed(4)),
    validRatio: Number((valid / totalPixels).toFixed(4)),
  }
}

function calculateTrend(points: TimeseriesPoint[]): 'improving' | 'declining' | 'stable' {
  if (points.length < 3) return 'stable'
  const first = points.slice(0, Math.floor(points.length / 2))
  const second = points.slice(Math.floor(points.length / 2))
  const avg1 = first.reduce((sum, point) => sum + point.ndvi, 0) / Math.max(first.length, 1)
  const avg2 = second.reduce((sum, point) => sum + point.ndvi, 0) / Math.max(second.length, 1)
  const delta = avg2 - avg1
  if (delta > 0.04) return 'improving'
  if (delta < -0.04) return 'declining'
  return 'stable'
}

function detectSeasonality(points: TimeseriesPoint[]) {
  if (points.length < 8) {
    return { detected: false, amplitude: 0, peakMonth: null, lowMonth: null }
  }
  const buckets: Record<number, number[]> = {}
  for (const point of points) {
    const month = new Date(point.date).getUTCMonth()
    if (!buckets[month]) buckets[month] = []
    buckets[month].push(point.ndvi)
  }
  const means: number[] = new Array(12).fill(0)
  for (let month = 0; month < 12; month++) {
    const values = buckets[month] || []
    means[month] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  }
  const max = Math.max(...means)
  const min = Math.min(...means)
  return {
    detected: max - min > 0.06,
    amplitude: Number((max - min).toFixed(4)),
    peakMonth: means.indexOf(max),
    lowMonth: means.indexOf(min),
  }
}

function buildSummary(points: TimeseriesPoint[]) {
  const averageNDVI = points.reduce((sum, point) => sum + point.ndvi, 0) / Math.max(points.length, 1)
  return {
    totalPoints: points.length,
    averageNDVI: Number(averageNDVI.toFixed(4)),
    trend: calculateTrend(points),
    seasonality: detectSeasonality(points),
  }
}

function buildSimulatedSeries(input: ReturnType<typeof normalizeInput>) {
  const random = seededRandom(`${input.bbox.join(',')}:${input.startDate}:${input.endDate}:${input.interval}`)
  const points: TimeseriesPoint[] = []
  const start = new Date(input.startDate)
  const end = new Date(input.endDate)

  while (start <= end && points.length < 24) {
    const month = start.getUTCMonth()
    const seasonal = Math.sin((month / 12) * Math.PI * 2) * 0.16
    const noise = (random() - 0.5) * 0.07
    const ndvi = clamp(0.46 + seasonal + noise, -0.1, 0.9)
    points.push({
      date: formatDate(start),
      ndvi: Number(ndvi.toFixed(4)),
      cloudCover: Number((random() * 32).toFixed(2)),
      confidence: Number((0.55 + random() * 0.2).toFixed(3)),
      source: 'simulated-fallback',
      isSimulated: true,
    })
    if (input.interval === 'daily') start.setUTCDate(start.getUTCDate() + 1)
    else if (input.interval === 'weekly') start.setUTCDate(start.getUTCDate() + 7)
    else start.setUTCMonth(start.getUTCMonth() + 1)
  }
  return points
}

async function readFirestoreCache(key: string): Promise<TimeseriesResponse | null> {
  try {
    const db = getAdminDb()
    const doc = await db.collection('timeseries_cache').doc(key).get()
    if (!doc.exists) return null
    const data = doc.data() || {}
    const createdAt = new Date(String(data.createdAt || 0)).getTime()
    if (!createdAt || Date.now() - createdAt > CACHE_TTL_MS) return null
    return data.payload as TimeseriesResponse
  } catch {
    return null
  }
}

async function writeFirestoreCache(key: string, payload: TimeseriesResponse) {
  try {
    const db = getAdminDb()
    await db.collection('timeseries_cache').doc(key).set({
      createdAt: new Date().toISOString(),
      payload,
    })
  } catch {
    // Firestore cache is optional for local/dev environments.
  }
}

async function computeRealTimeseries(
  input: ReturnType<typeof normalizeInput>,
  diagnostics: ProviderDiagnostic[]
): Promise<TimeseriesPoint[]> {
  if (shouldSkipProvider(PROVIDER_NAME)) {
    diagnostics.push({ provider: PROVIDER_NAME, ok: false, reason: 'cooldown' })
    throw new Error('provider_cooldown')
  }

  const started = Date.now()
  try {
    const response = await fetchWithTimeout(
      STAC_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bbox: input.bbox,
          datetime: `${input.startDate}/${input.endDate}`,
          collections: ['sentinel-2-l2a'],
          limit: 96,
          sortby: [{ field: 'properties.datetime', direction: 'desc' }],
        }),
      },
      14000
    )
    if (!response.ok) throw new Error(`stac_search_failed_${response.status}`)

    const payload = await response.json()
    const scenes = pickScenePerBucket(Array.isArray(payload?.features) ? payload.features : [], input.interval)
    if (!scenes.length) throw new Error('no_imagery')

    const points: TimeseriesPoint[] = []
    for (const scene of scenes) {
      try {
        const ndvi = await computeSceneNdviMean(scene, input.bbox)
        points.push({
          date: scene.date,
          ndvi: ndvi.mean,
          cloudCover: scene.cloudCover,
          confidence: Number(clamp(ndvi.validRatio * (1 - (scene.cloudCover ?? 20) / 120), 0.45, 0.98).toFixed(3)),
          source: 'planetary-computer',
          isSimulated: false,
        })
      } catch {
        // Skip bad scenes and continue.
      }
    }

    if (points.length < 3) throw new Error('insufficient_points')
    points.sort((a, b) => a.date.localeCompare(b.date))

    markProviderSuccess(PROVIDER_NAME)
    diagnostics.push({
      provider: PROVIDER_NAME,
      ok: true,
      durationMs: Date.now() - started,
    })
    return points
  } catch (error: any) {
    markProviderFailure(PROVIDER_NAME)
    diagnostics.push({
      provider: PROVIDER_NAME,
      ok: false,
      reason: String(error?.message || 'provider_failed'),
      durationMs: Date.now() - started,
    })
    throw error
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<TimeseriesResponse | ApiErrorResponse>) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const input = normalizeInput(req.body || {})
    const diagnostics: ProviderDiagnostic[] = []
    const warnings: string[] = []
    const cacheKey = makeCacheKey(['timeseries', input.bbox.join(','), input.startDate, input.endDate, input.interval])

    const memoryCached = readMemoryCache<TimeseriesResponse>(cacheKey)
    if (memoryCached) {
      return res.status(200).json({
        ...memoryCached,
        cacheHit: true,
        warnings: [...(memoryCached.warnings || []), 'Returned from memory cache.'],
      })
    }

    const firestoreCached = await readFirestoreCache(cacheKey)
    if (firestoreCached) {
      writeMemoryCache(cacheKey, firestoreCached, CACHE_TTL_MS)
      return res.status(200).json({
        ...firestoreCached,
        cacheHit: true,
        warnings: [...(firestoreCached.warnings || []), 'Returned from Firestore cache.'],
      })
    }

    let points: TimeseriesPoint[] = []
    let isSimulated = false

    if (FEATURE_FLAGS.REAL_TIMESERIES) {
      try {
        points = await computeRealTimeseries(input, diagnostics)
      } catch (error: any) {
        warnings.push(`Real provider failed: ${String(error?.message || 'unknown_error')}`)
      }
    } else {
      warnings.push('FEATURE_REAL_TIMESERIES disabled; using simulated series.')
    }

    if (!points.length) {
      points = buildSimulatedSeries(input)
      isSimulated = true
      warnings.push('Simulated fallback used because real providers were unavailable.')
    }

    const payload: TimeseriesResponse = {
      success: true,
      data: {
        timeSeries: points,
        bbox: input.bbox,
        interval: input.interval,
        startDate: input.startDate,
        endDate: input.endDate,
        summary: buildSummary(points),
      },
      source: isSimulated ? 'simulated-fallback' : 'planetary-computer',
      isSimulated,
      cacheHit: false,
      warnings,
      providersTried: diagnostics,
    }

    writeMemoryCache(cacheKey, payload, CACHE_TTL_MS)
    await writeFirestoreCache(cacheKey, payload)

    return res.status(200).json(payload)
  } catch (error: any) {
    if (String(error?.message || '') === 'bbox_required') {
      return res.status(400).json({
        error: 'bbox_required',
        message: 'Bounding box [minx,miny,maxx,maxy] is required.',
      })
    }
    return res.status(500).json({
      error: 'timeseries_failed',
      message: String(error?.message || 'Unexpected timeseries error'),
    })
  }
}

