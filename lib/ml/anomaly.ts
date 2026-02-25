import type { MLFeatureVector, MLInput } from './types'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mad(values: number[], center: number) {
  const deviations = values.map((value) => Math.abs(value - center))
  return median(deviations) || 1e-6
}

function extractSeries(input: MLInput, fallback: number) {
  const raw =
    input?.timeSeriesData?.timeSeries ||
    input?.context?.timeSeries?.timeSeries ||
    input?.context?.timeSeries ||
    []
  const values = Array.isArray(raw)
    ? raw.map((row: any) => Number(row?.ndvi)).filter((value: number) => Number.isFinite(value))
    : []
  return values.length ? values : [fallback, fallback]
}

function ewma(values: number[], alpha = 0.3) {
  if (!values.length) return 0
  let acc = values[0]
  for (let i = 1; i < values.length; i++) {
    acc = alpha * values[i] + (1 - alpha) * acc
  }
  return acc
}

export function computeAnomalyScore(input: MLInput, features: MLFeatureVector) {
  const series = extractSeries(input, features.ndviMean)
  const med = median(series)
  const spread = mad(series, med)
  const current = series[series.length - 1]
  const robustZ = 0.6745 * ((current - med) / spread)

  const diffs = series.slice(1).map((value, idx) => value - series[idx])
  const ewmaDiff = ewma(diffs)
  const momentumPenalty = Math.max(0, -ewmaDiff * 2.8)
  const volatilityPenalty = Math.max(0, features.ndviVolatility - 0.09) * 2.4
  const humidityPenalty = features.humidity > 84 ? 0.12 : 0

  const score = clamp(Math.abs(robustZ) * 0.35 + momentumPenalty * 0.35 + volatilityPenalty + humidityPenalty, 0, 1)
  const level: 'low' | 'moderate' | 'high' = score > 0.66 ? 'high' : score > 0.38 ? 'moderate' : 'low'

  const signals: string[] = []
  if (Math.abs(robustZ) > 1.6) signals.push('Current NDVI deviates strongly from recent median.')
  if (momentumPenalty > 0.2) signals.push('Short-term NDVI momentum is negative.')
  if (volatilityPenalty > 0.14) signals.push('NDVI variance is elevated versus typical baseline.')
  if (humidityPenalty > 0) signals.push('High humidity can elevate disease pressure.')
  if (!signals.length) signals.push('No major anomaly signal detected.')

  return {
    score: Number(score.toFixed(4)),
    level,
    signals,
  }
}
