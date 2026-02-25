import type { NextApiRequest, NextApiResponse } from 'next'
import type { ApiErrorResponse, GeocodePlace, GeocodeResponse, ProviderDiagnostic } from '../../lib/types/api'
import { fetchJsonWithRetry, markProviderFailure, markProviderSuccess, shouldSkipProvider } from '../../lib/server/provider-runtime'
import { readMemoryCache, writeMemoryCache } from '../../lib/server/cache'

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const PROVIDER_TIMEOUT_MS = 9000

function normalizeQuery(raw: string) {
  const clean = raw.replace(/\s+/g, ' ').trim()
  const head = clean.split(',')[0]?.trim() || clean
  return { clean, primary: head || clean }
}

function bboxAround(lat: number, lon: number, delta = 0.06): [number, number, number, number] {
  const south = Number((lat - delta).toFixed(6))
  const north = Number((lat + delta).toFixed(6))
  const west = Number((lon - delta).toFixed(6))
  const east = Number((lon + delta).toFixed(6))
  return [south, north, west, east]
}

function parseProviderReason(error: any) {
  const message = String(error?.message || error || '').toLowerCase()
  if (message.includes('http_403')) return 'geocode_provider_403'
  if (message.includes('abort') || message.includes('timeout')) return 'geocode_timeout'
  if (message.includes('no_results')) return 'geocode_no_results'
  return 'geocode_all_failed'
}

async function openMeteoGeocode(query: string): Promise<GeocodePlace[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.searchParams.set('name', query)
  url.searchParams.set('count', '8')
  url.searchParams.set('language', 'en')
  url.searchParams.set('format', 'json')
  const data = await fetchJsonWithRetry(url.toString(), {}, { retries: 1, timeoutMs: PROVIDER_TIMEOUT_MS })
  const rows = Array.isArray((data as any)?.results) ? (data as any).results : []
  const mapped = rows
    .filter((row: any) => typeof row?.latitude === 'number' && typeof row?.longitude === 'number')
    .map((row: any) => {
      const lat = Number(row.latitude)
      const lon = Number(row.longitude)
      const adminParts = [row.admin1, row.country].filter(Boolean).join(', ')
      return {
        display_name: [row.name, adminParts].filter(Boolean).join(', '),
        lat,
        lon,
        bbox: bboxAround(lat, lon),
        source: 'open-meteo',
      } as GeocodePlace
    })
  if (!mapped.length) throw new Error('no_results')
  return mapped
}

async function photonGeocode(query: string): Promise<GeocodePlace[]> {
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '8')
  const data = await fetchJsonWithRetry(url.toString(), {}, { retries: 1, timeoutMs: PROVIDER_TIMEOUT_MS })
  const features = Array.isArray((data as any)?.features) ? (data as any).features : []
  const mapped = features
    .filter((feature: any) => Array.isArray(feature?.geometry?.coordinates))
    .map((feature: any) => {
      const lon = Number(feature.geometry.coordinates[0])
      const lat = Number(feature.geometry.coordinates[1])
      const p = feature.properties || {}
      const admin = [p.city || p.county || p.state, p.country].filter(Boolean).join(', ')
      return {
        display_name: [p.name || p.street || p.state || 'Unknown', admin].filter(Boolean).join(', '),
        lat,
        lon,
        bbox: bboxAround(lat, lon),
        source: 'photon',
      } as GeocodePlace
    })
  if (!mapped.length) throw new Error('no_results')
  return mapped
}

async function runProvider(
  name: string,
  fn: () => Promise<GeocodePlace[]>,
  diagnostics: ProviderDiagnostic[]
): Promise<GeocodePlace[] | null> {
  if (shouldSkipProvider(name)) {
    diagnostics.push({ provider: name, ok: false, reason: 'cooldown' })
    return null
  }

  const started = Date.now()
  try {
    const places = await fn()
    markProviderSuccess(name)
    diagnostics.push({ provider: name, ok: true, durationMs: Date.now() - started })
    return places
  } catch (error: any) {
    markProviderFailure(name)
    diagnostics.push({
      provider: name,
      ok: false,
      reason: parseProviderReason(error),
      status: Number(error?.status) || undefined,
      durationMs: Date.now() - started,
    })
    return null
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<GeocodeResponse | ApiErrorResponse>) {
  if (req.method !== 'GET') return res.status(405).end()

  const q = String(req.query.q || '').trim()
  if (!q) {
    return res.status(400).json({ error: 'validation_failed', message: 'Query parameter "q" is required.' })
  }

  const { clean, primary } = normalizeQuery(q)
  const diagnostics: ProviderDiagnostic[] = []
  const warnings: string[] = []

  const cacheKey = `geocode:${clean.toLowerCase()}`
  const cached = readMemoryCache<GeocodeResponse>(cacheKey)
  if (cached) {
    return res.status(200).json({
      ...cached,
      warnings: [...(cached.warnings || []), 'Served from cache.'],
    })
  }

  const queries = [primary, clean].filter((value, idx, arr) => Boolean(value) && arr.indexOf(value) === idx)

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]
    if (i === 1) warnings.push('Primary normalized query returned no results; retried with full query.')

    const openMeteoPlaces = await runProvider('open-meteo', () => openMeteoGeocode(query), diagnostics)
    if (openMeteoPlaces?.length) {
      const payload: GeocodeResponse = {
        success: true,
        query: clean,
        normalizedQuery: primary,
        places: openMeteoPlaces,
        warnings,
        providersTried: diagnostics,
      }
      writeMemoryCache(cacheKey, payload, CACHE_TTL_MS)
      return res.status(200).json(payload)
    }

    const photonPlaces = await runProvider('photon', () => photonGeocode(query), diagnostics)
    if (photonPlaces?.length) {
      const payload: GeocodeResponse = {
        success: true,
        query: clean,
        normalizedQuery: primary,
        places: photonPlaces,
        warnings: [...warnings, 'Fallback geocoder used.'],
        providersTried: diagnostics,
      }
      writeMemoryCache(cacheKey, payload, CACHE_TTL_MS)
      return res.status(200).json(payload)
    }
  }

  if (cached?.places?.length) {
    return res.status(200).json({
      ...cached,
      warnings: [...(cached.warnings || []), 'Providers unavailable; returned recent cached result.'],
      providersTried: diagnostics,
    })
  }

  const primaryReason = diagnostics.find((d) => !d.ok && d.reason === 'geocode_provider_403')
    ? 'geocode_provider_403'
    : diagnostics.every((d) => d.reason === 'geocode_timeout')
      ? 'geocode_timeout'
      : diagnostics.some((d) => d.reason === 'geocode_no_results')
        ? 'geocode_no_results'
        : 'geocode_all_failed'

  return res.status(502).json({
    error: primaryReason,
    message:
      primaryReason === 'geocode_no_results'
        ? `No locations found for "${clean}".`
        : `All geocoding providers failed for "${clean}".`,
    reason: primaryReason,
    providersTried: diagnostics,
  })
}
