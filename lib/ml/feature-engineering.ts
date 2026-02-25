import type { DataQualityReport, MLFeatureVector, MLInput } from './types'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, precision = 4) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function arrayMean(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function arrayStd(values: number[]) {
  if (values.length < 2) return 0
  const mean = arrayMean(values)
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}

function linearSlope(values: number[]) {
  if (values.length < 2) return 0
  const n = values.length
  const xMean = (n - 1) / 2
  const yMean = arrayMean(values)
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (values[i] - yMean)
    denominator += Math.pow(i - xMean, 2)
  }
  return denominator ? numerator / denominator : 0
}

function pullSeries(input: MLInput) {
  const seriesFromContext =
    Array.isArray(input?.context?.timeSeries?.timeSeries)
      ? input.context.timeSeries.timeSeries
      : Array.isArray(input?.context?.timeSeries?.points)
        ? input.context.timeSeries.points
        : null
  const seriesFromBody =
    Array.isArray(input?.timeSeriesData?.timeSeries)
      ? input.timeSeriesData.timeSeries
      : Array.isArray(input?.timeSeriesData?.points)
        ? input.timeSeriesData.points
        : null
  const series = seriesFromBody || seriesFromContext || []
  return series
    .map((point: any) => Number(point?.ndvi))
    .filter((value: number) => Number.isFinite(value))
}

function inferSeasonalIndex() {
  const month = new Date().getUTCMonth()
  const seasonal = 0.5 + 0.5 * Math.sin((month / 12) * Math.PI * 2 - Math.PI / 2)
  return round(seasonal)
}

function mean(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function averageTail(values: number[], size: number) {
  if (!values.length) return 0
  return mean(values.slice(Math.max(0, values.length - size)))
}

export function buildFeatureVector(input: MLInput): MLFeatureVector {
  const ndviStats = input?.ndviData?.stats || input?.context?.ndviStats || {}
  const series = pullSeries(input)
  const selectedCell = String(input?.selectedCell || input?.context?.selectedCell || '')
  const gridCells = Array.isArray(input?.context?.grid3x3) ? input.context.grid3x3 : []
  const selectedCellStats = gridCells.find((cell: any) => String(cell?.cellId) === selectedCell)

  const baseNdviMean = Number(ndviStats?.mean ?? series[series.length - 1] ?? 0.45)
  const ndviMean = Number.isFinite(Number(selectedCellStats?.mean))
    ? baseNdviMean * 0.7 + Number(selectedCellStats.mean) * 0.3
    : baseNdviMean
  const ndviMin = Number(ndviStats?.min ?? Math.max(-0.2, ndviMean - 0.2))
  const ndviMax = Number(ndviStats?.max ?? Math.min(0.95, ndviMean + 0.2))
  const ndviSpread = Math.max(0, ndviMax - ndviMin)
  const ndviVolatility = arrayStd(series)
  const ndviTrendSlope = linearSlope(series.length ? series : [ndviMean, ndviMean])
  const ndviDelta7 = series.length >= 7 ? averageTail(series, 3) - mean(series.slice(Math.max(0, series.length - 10), Math.max(0, series.length - 7))) : 0
  const ndviDelta30 =
    series.length >= 30
      ? averageTail(series, 6) - mean(series.slice(Math.max(0, series.length - 36), Math.max(0, series.length - 30)))
      : ndviDelta7 * 1.8
  const trendAcceleration =
    series.length >= 8
      ? linearSlope(series.slice(-4)) - linearSlope(series.slice(Math.max(0, series.length - 8), Math.max(0, series.length - 4)))
      : 0
  const shortTermMomentum =
    series.length >= 4 ? round(arrayMean(series.slice(-3)) - arrayMean(series.slice(-6, -3).length ? series.slice(-6, -3) : series.slice(-3))) : 0

  const weather = input?.weatherData?.current || input?.weatherData?.weather || input?.context?.weather?.current || {}
  const temperature = Number(weather?.temperature ?? weather?.temperature_2m ?? 24)
  const humidity = Number(weather?.humidity ?? weather?.relative_humidity_2m ?? 55)
  const precipitation = Number(weather?.precipitation ?? input?.weatherData?.current?.precipitation ?? 1.2)

  const soilStats = input?.soilData?.stats || input?.context?.soilStats || {}
  const etStats = input?.etData?.stats || input?.context?.etStats || {}
  const soilMoistureMean = Number(soilStats?.mean ?? 0.24)
  const etMean = Number(etStats?.mean ?? 3.4)
  const moistureDeficitIndex = clamp((0.28 - soilMoistureMean) * 3.2 + (etMean - 4.1) * 0.08, 0, 1)
  const weatherStressIndex = clamp((temperature - 30) * 0.05 + (humidity > 84 ? 0.2 : 0) + precipitation * 0.015, 0, 1)
  const dataLatencyPenalty = clamp(Number(input?.context?.dataLatencyHours || 0) / 96, 0, 1)

  return {
    ndviMin: round(ndviMin),
    ndviMax: round(ndviMax),
    ndviMean: round(ndviMean),
    ndviSpread: round(ndviSpread),
    ndviDelta7: round(ndviDelta7),
    ndviDelta30: round(ndviDelta30),
    ndviTrendSlope: round(ndviTrendSlope),
    trendAcceleration: round(trendAcceleration),
    ndviVolatility: round(ndviVolatility),
    soilMoistureMean: round(soilMoistureMean),
    moistureDeficitIndex: round(moistureDeficitIndex),
    etMean: round(etMean),
    weatherStressIndex: round(weatherStressIndex),
    temperature: round(temperature),
    precipitation: round(precipitation),
    humidity: round(humidity),
    seasonalIndex: inferSeasonalIndex(),
    shortTermMomentum: round(shortTermMomentum),
    dataLatencyPenalty: round(dataLatencyPenalty),
  }
}

export function buildDataQuality(input: MLInput): DataQualityReport {
  const checks = [
    Boolean(input?.ndviData?.stats || input?.context?.ndviStats),
    Boolean(input?.timeSeriesData?.timeSeries || input?.timeSeriesData?.points || input?.context?.timeSeries),
    Boolean(input?.weatherData || input?.context?.weather),
    Boolean(input?.soilData || input?.context?.soilStats),
    Boolean(input?.etData || input?.context?.etStats),
  ]
  const completeness = checks.filter(Boolean).length / checks.length

  const providerDiagnostics = Array.isArray(input?.providersTried) ? input.providersTried : []
  const okCount = providerDiagnostics.filter((diag) => diag.ok).length
  const providerQuality = providerDiagnostics.length ? okCount / providerDiagnostics.length : 0.75

  const warnings: string[] = []
  if (completeness < 0.7) warnings.push('Limited input coverage; recommendations are conservative.')
  if (providerQuality < 0.6) warnings.push('One or more upstream providers reported degraded reliability.')

  const simulatedHints = [
    input?.weatherData?.isSimulated,
    input?.soilData?.isSimulated,
    input?.etData?.isSimulated,
    input?.timeSeriesData?.isSimulated,
    input?.context?.weather?.isSimulated,
    input?.context?.timeSeries?.isSimulated,
  ].filter(Boolean)
  const isSimulatedInputs = simulatedHints.length > 0
  if (isSimulatedInputs) warnings.push('Some inputs are simulated due to provider outages.')

  const score = clamp(completeness * 0.65 + providerQuality * 0.35 - (isSimulatedInputs ? 0.12 : 0), 0, 1)

  return {
    completeness: round(completeness),
    providerQuality: round(providerQuality),
    score: round(score),
    isSimulatedInputs,
    warnings,
  }
}
