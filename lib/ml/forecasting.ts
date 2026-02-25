import type { MLFeatureVector, MLInput } from './types'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, precision = 4) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function extractSeries(input: MLInput, fallback: number) {
  const candidates =
    input?.timeSeriesData?.timeSeries ||
    input?.context?.timeSeries?.timeSeries ||
    input?.context?.timeSeries ||
    []
  const values = Array.isArray(candidates)
    ? candidates.map((point: any) => Number(point?.ndvi)).filter((value: number) => Number.isFinite(value))
    : []
  if (!values.length) return [fallback, fallback, fallback, fallback]
  return values
}

function holtWintersAdditive(series: number[], horizon: number, seasonLength: number) {
  const alpha = 0.45
  const beta = 0.25
  const gamma = 0.2
  const minSeason = Math.max(2, Math.min(seasonLength, Math.floor(series.length / 2)))

  let level = series[0]
  let trend = series.length > 1 ? series[1] - series[0] : 0
  const seasonals = new Array(minSeason).fill(0)
  for (let i = 0; i < minSeason && i < series.length; i++) {
    seasonals[i] = series[i] - level
  }

  for (let i = 0; i < series.length; i++) {
    const value = series[i]
    const seasonal = seasonals[i % minSeason]
    const prevLevel = level
    level = alpha * (value - seasonal) + (1 - alpha) * (level + trend)
    trend = beta * (level - prevLevel) + (1 - beta) * trend
    seasonals[i % minSeason] = gamma * (value - level) + (1 - gamma) * seasonal
  }

  const forecast: number[] = []
  for (let step = 1; step <= horizon; step++) {
    const seasonal = seasonals[(series.length + step - 1) % minSeason]
    forecast.push(level + trend * step + seasonal)
  }
  return forecast
}

function slopeTrend(values: number[]): 'improving' | 'declining' | 'stable' {
  if (values.length < 3) return 'stable'
  const left = values.slice(0, Math.floor(values.length / 2))
  const right = values.slice(Math.floor(values.length / 2))
  const avgLeft = left.reduce((sum, value) => sum + value, 0) / left.length
  const avgRight = right.reduce((sum, value) => sum + value, 0) / right.length
  const delta = avgRight - avgLeft
  if (delta > 0.04) return 'improving'
  if (delta < -0.04) return 'declining'
  return 'stable'
}

function riskFromForecast(
  forecastNdvi: number,
  featureVector: MLFeatureVector
) {
  const waterStress = clamp((0.2 - featureVector.soilMoistureMean) * 2.4, 0, 1)
  const heatStress = clamp((featureVector.temperature - 30) / 12, 0, 1)
  const etStress = clamp((featureVector.etMean - 5.5) / 5, 0, 1)
  const canopyRisk = clamp((0.42 - forecastNdvi) * 1.8, 0, 1)
  return clamp(0.45 * canopyRisk + 0.25 * waterStress + 0.2 * heatStress + 0.1 * etStress, 0, 1)
}

export function forecastNdvi(input: MLInput, features: MLFeatureVector) {
  const series = extractSeries(input, features.ndviMean)
  const inferredSeason = series.length >= 24 ? 12 : series.length >= 14 ? 7 : 4
  const future30 = holtWintersAdditive(series, 30, inferredSeason)
  const future7 = future30.slice(0, 7)

  const ndvi7d = clamp(future7.reduce((sum, value) => sum + value, 0) / Math.max(future7.length, 1), -0.3, 0.95)
  const ndvi30d = clamp(future30.reduce((sum, value) => sum + value, 0) / Math.max(future30.length, 1), -0.3, 0.95)

  return {
    ndvi7d: round(ndvi7d),
    ndvi30d: round(ndvi30d),
    risk7d: round(riskFromForecast(ndvi7d, features)),
    risk30d: round(riskFromForecast(ndvi30d, features)),
    trend: slopeTrend(series),
  }
}

