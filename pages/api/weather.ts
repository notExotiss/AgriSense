import type { NextApiRequest, NextApiResponse } from 'next'

type WeatherCondition = {
  condition: string
  description: string
  icon: string
}

const WEATHER_CODE_MAP: Record<number, WeatherCondition> = {
  0: { condition: 'Clear', description: 'clear sky', icon: '01d' },
  1: { condition: 'Clouds', description: 'mainly clear', icon: '02d' },
  2: { condition: 'Clouds', description: 'partly cloudy', icon: '03d' },
  3: { condition: 'Clouds', description: 'overcast', icon: '04d' },
  45: { condition: 'Mist', description: 'fog', icon: '50d' },
  48: { condition: 'Mist', description: 'rime fog', icon: '50d' },
  51: { condition: 'Drizzle', description: 'light drizzle', icon: '09d' },
  53: { condition: 'Drizzle', description: 'drizzle', icon: '09d' },
  55: { condition: 'Drizzle', description: 'dense drizzle', icon: '09d' },
  61: { condition: 'Rain', description: 'slight rain', icon: '10d' },
  63: { condition: 'Rain', description: 'rain', icon: '10d' },
  65: { condition: 'Rain', description: 'heavy rain', icon: '10d' },
  66: { condition: 'Rain', description: 'freezing rain', icon: '13d' },
  67: { condition: 'Rain', description: 'heavy freezing rain', icon: '13d' },
  71: { condition: 'Snow', description: 'slight snow', icon: '13d' },
  73: { condition: 'Snow', description: 'snow', icon: '13d' },
  75: { condition: 'Snow', description: 'heavy snow', icon: '13d' },
  80: { condition: 'Rain', description: 'rain showers', icon: '09d' },
  81: { condition: 'Rain', description: 'rain showers', icon: '09d' },
  82: { condition: 'Rain', description: 'violent rain showers', icon: '09d' },
  95: { condition: 'Thunderstorm', description: 'thunderstorm', icon: '11d' },
  96: { condition: 'Thunderstorm', description: 'thunderstorm with hail', icon: '11d' },
  99: { condition: 'Thunderstorm', description: 'thunderstorm with heavy hail', icon: '11d' },
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

function resolveCondition(code: number | null | undefined): WeatherCondition {
  if (typeof code !== 'number') return WEATHER_CODE_MAP[0]
  return WEATHER_CODE_MAP[code] || WEATHER_CODE_MAP[0]
}

async function resolveLocationName(lat: number, lon: number) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AgriSense/1.0 (agrisense.app)',
      },
    }).finally(() => clearTimeout(timeout))
    if (!response.ok) throw new Error(`http_${response.status}`)
    const json = await response.json()
    const addr = json?.address || {}
    const name =
      addr.city || addr.town || addr.village || addr.hamlet || addr.county || json?.name || `Location (${lat.toFixed(2)}, ${lon.toFixed(2)})`
    return {
      name,
      country: addr.country_code ? String(addr.country_code).toUpperCase() : '',
      state: addr.state || '',
    }
  } catch {
    return {
      name: `Location (${lat.toFixed(2)}, ${lon.toFixed(2)})`,
      country: '',
      state: '',
    }
  }
}

function buildMockWeather(lat: number, lon: number) {
  const now = new Date()
  const baseTemp = 62
  const days = Array.from({ length: 7 }).map((_, i) => {
    const date = new Date(now.getTime() + i * 86400000)
    return {
      date: date.toISOString().slice(0, 10),
      temp_max: baseTemp + 7 + i % 3,
      temp_min: baseTemp - 7 + (i % 2),
      condition: i % 3 === 0 ? 'Clouds' : i % 4 === 0 ? 'Rain' : 'Clear',
      description: i % 3 === 0 ? 'partly cloudy' : i % 4 === 0 ? 'showers' : 'clear sky',
      precipitation: i % 4 === 0 ? 4.1 : 0.4,
      humidity: 65 + (i % 2) * 4,
      windSpeed: 9 + (i % 3),
      icon: i % 3 === 0 ? '03d' : i % 4 === 0 ? '10d' : '01d',
    }
  })

  return {
    location: {
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      name: `Location (${lat.toFixed(2)}, ${lon.toFixed(2)})`,
      country: '',
      state: '',
    },
    current: {
      temperature: baseTemp,
      humidity: 66,
      windSpeed: 10,
      condition: 'Clouds',
      description: 'partly cloudy',
      precipitation: 0.4,
      uvIndex: 4,
      feelsLike: baseTemp,
      pressure: 1014,
      visibility: 8,
      icon: '03d',
    },
    forecast: days,
  }
}

async function getOpenMeteoWeather(lat: number, lon: number) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lon))
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '7')
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('wind_speed_unit', 'mph')
  url.searchParams.set(
    'current',
    [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'surface_pressure',
      'wind_speed_10m',
      'weather_code',
      'precipitation',
    ].join(',')
  )
  url.searchParams.set(
    'daily',
    [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'wind_speed_10m_max',
      'et0_fao_evapotranspiration',
      'uv_index_max',
    ].join(',')
  )

  const [forecastJson, locationInfo] = await Promise.all([fetchJson(url.toString()), resolveLocationName(lat, lon)])
  const current = forecastJson.current || {}
  const daily = forecastJson.daily || {}

  const currentCondition = resolveCondition(current.weather_code)
  const forecast = Array.isArray(daily.time)
    ? daily.time.map((date: string, idx: number) => {
        const cond = resolveCondition(daily.weather_code?.[idx])
        return {
          date,
          temp_max: Math.round(daily.temperature_2m_max?.[idx] ?? 0),
          temp_min: Math.round(daily.temperature_2m_min?.[idx] ?? 0),
          condition: cond.condition,
          description: cond.description,
          precipitation: Number((daily.precipitation_sum?.[idx] ?? 0).toFixed(1)),
          humidity: Number(current.relative_humidity_2m ?? 0),
          windSpeed: Math.round(daily.wind_speed_10m_max?.[idx] ?? current.wind_speed_10m ?? 0),
          icon: cond.icon,
        }
      })
    : []

  return {
    location: {
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      name: locationInfo.name,
      country: locationInfo.country,
      state: locationInfo.state,
    },
    current: {
      temperature: Math.round(current.temperature_2m ?? 0),
      humidity: Math.round(current.relative_humidity_2m ?? 0),
      windSpeed: Math.round(current.wind_speed_10m ?? 0),
      condition: currentCondition.condition,
      description: currentCondition.description,
      precipitation: Number((current.precipitation ?? 0).toFixed(1)),
      uvIndex: Math.round((daily.uv_index_max?.[0] ?? 0) || 0),
      feelsLike: Math.round(current.apparent_temperature ?? current.temperature_2m ?? 0),
      pressure: Math.round(current.surface_pressure ?? 0),
      visibility: 10,
      icon: currentCondition.icon,
    },
    forecast,
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { bbox, location } = req.body || {}
    let lat: number
    let lon: number

    if (location && typeof location.lat === 'number' && typeof location.lon === 'number') {
      lat = location.lat
      lon = location.lon
    } else if (Array.isArray(bbox) && bbox.length === 4) {
      lat = (Number(bbox[1]) + Number(bbox[3])) / 2
      lon = (Number(bbox[0]) + Number(bbox[2])) / 2
    } else {
      return res.status(400).json({
        error: 'location_required',
        message: 'Either bbox [minx,miny,maxx,maxy] or location { lat, lon } is required.',
      })
    }

    try {
      const data = await getOpenMeteoWeather(lat, lon)
      return res.status(200).json({
        success: true,
        source: 'Open-Meteo',
        isSimulated: false,
        cacheHit: false,
        warnings: [],
        providersTried: [{ provider: 'open-meteo-weather', ok: true }],
        data,
      })
    } catch (error: any) {
      const fallback = buildMockWeather(lat, lon)
      return res.status(200).json({
        success: true,
        source: 'Simulated fallback (Open-Meteo unavailable)',
        isSimulated: true,
        cacheHit: false,
        warnings: [error?.message || 'weather_provider_failed'],
        providersTried: [{ provider: 'open-meteo-weather', ok: false, reason: error?.message || 'weather_provider_failed' }],
        data: fallback,
      })
    }
  } catch (error: any) {
    return res.status(500).json({ error: 'weather_fetch_failed', message: error?.message || 'Unknown weather error' })
  }
}
