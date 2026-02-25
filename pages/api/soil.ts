import type { NextApiRequest, NextApiResponse } from 'next'

type GridResult = {
  encoded: string
  stats: { min: number; max: number; mean: number }
}

function createSeededRandom(seed: number) {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
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

function buildEncodedGrid(baseValue: number, bbox: [number, number, number, number], type: 'soil' | 'fallback'): GridResult {
  const width = 256
  const height = 256
  const seed = Math.round((bbox[0] + bbox[1] + bbox[2] + bbox[3]) * 100000) || 12345
  const random = createSeededRandom(Math.abs(seed))

  const data: number[] = new Array(width * height)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const radial = Math.sin((x / width) * Math.PI) * Math.cos((y / height) * Math.PI)
      const noise = (random() - 0.5) * (type === 'soil' ? 0.04 : 0.08)
      const value = Math.max(0.04, Math.min(0.65, baseValue + radial * 0.03 + noise))
      data[i] = Number(value.toFixed(4))
      min = Math.min(min, value)
      max = Math.max(max, value)
      sum += value
    }
  }

  const payload = {
    type: 'soil_moisture',
    width,
    height,
    data,
    stats: {
      min: Number(min.toFixed(4)),
      max: Number(max.toFixed(4)),
      mean: Number((sum / data.length).toFixed(4)),
    },
  }

  return {
    encoded: Buffer.from(JSON.stringify(payload)).toString('base64'),
    stats: payload.stats,
  }
}

async function getOpenMeteoSoilMoisture(lat: number, lon: number) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lon))
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('past_days', '1')
  url.searchParams.set('forecast_days', '1')
  url.searchParams.set('hourly', 'soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm')

  const json = await fetchJson(url.toString())
  const hourly = json?.hourly || {}
  const top = hourly?.soil_moisture_0_to_1cm || []
  const mid = hourly?.soil_moisture_1_to_3cm || []
  const deep = hourly?.soil_moisture_3_to_9cm || []
  const idx = Math.max(0, top.length - 1)
  const valueCandidates = [top[idx], mid[idx], deep[idx]].filter((v) => typeof v === 'number')
  if (!valueCandidates.length) throw new Error('no_soil_values')
  const weighted =
    (Number(top[idx] ?? 0) * 0.5 + Number(mid[idx] ?? 0) * 0.3 + Number(deep[idx] ?? 0) * 0.2) /
    (Number(top[idx] != null ? 0.5 : 0) + Number(mid[idx] != null ? 0.3 : 0) + Number(deep[idx] != null ? 0.2 : 0) || 1)
  return Math.max(0.05, Math.min(0.6, weighted))
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { bbox } = req.body || {}
    if (!Array.isArray(bbox) || bbox.length !== 4) {
      return res.status(400).json({ error: 'bbox_required', message: 'Bounding box [minx,miny,maxx,maxy] is required' })
    }

    const typedBbox = bbox.map(Number) as [number, number, number, number]
    const centerLat = (typedBbox[1] + typedBbox[3]) / 2
    const centerLon = (typedBbox[0] + typedBbox[2]) / 2

    try {
      const baseline = await getOpenMeteoSoilMoisture(centerLat, centerLon)
      const grid = buildEncodedGrid(baseline, typedBbox, 'soil')
      return res.status(200).json({
        success: true,
        source: 'Open-Meteo',
        isSimulated: false,
        cacheHit: false,
        warnings: [],
        providersTried: [{ provider: 'open-meteo-soil', ok: true }],
        data: {
          soilMoisture: grid.encoded,
          stats: grid.stats,
          bbox: typedBbox,
          source: 'Open-Meteo soil moisture (AOI-derived grid)',
          isSimulated: false,
          units: 'm3/m3',
          timestamp: new Date().toISOString(),
        },
      })
    } catch (providerError: any) {
      const fallback = buildEncodedGrid(0.28, typedBbox, 'fallback')
      return res.status(200).json({
        success: true,
        source: 'Simulated fallback (Open-Meteo unavailable)',
        isSimulated: true,
        cacheHit: false,
        warnings: [providerError?.message || 'soil_provider_failed'],
        providersTried: [{ provider: 'open-meteo-soil', ok: false, reason: providerError?.message || 'soil_provider_failed' }],
        data: {
          soilMoisture: fallback.encoded,
          stats: fallback.stats,
          bbox: typedBbox,
          source: 'Simulated',
          isSimulated: true,
          units: 'm3/m3',
          timestamp: new Date().toISOString(),
        },
      })
    }
  } catch (error: any) {
    return res.status(500).json({ error: 'soil_fetch_failed', message: String(error?.message || error) })
  }
}
