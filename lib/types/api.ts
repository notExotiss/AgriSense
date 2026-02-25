export type BBox = [number, number, number, number]

export type ApiErrorCode =
  | 'bbox_required'
  | 'auth_required'
  | 'invalid_auth'
  | 'forbidden'
  | 'not_found'
  | 'invalid_geometry'
  | 'geocode_provider_403'
  | 'geocode_timeout'
  | 'geocode_no_results'
  | 'geocode_all_failed'
  | 'timeseries_failed'
  | 'ingest_failed'
  | 'terrain_unavailable'
  | 'plot_payload_too_large'
  | 'validation_failed'
  | 'unknown_error'

export type ProviderDiagnostic = {
  provider: string
  ok: boolean
  reason?: string
  status?: number
  durationMs?: number
}

export type DataMeta = {
  source: string
  isSimulated: boolean
  cacheHit?: boolean
  warnings?: string[]
  providersTried?: ProviderDiagnostic[]
}

export type TerrainQuality = 'high' | 'balanced' | 'light'

export type TerrainMeshMeta = {
  smoothed: boolean
  resolution: number
}

export type HeroLegend = {
  metric: 'ndvi'
  min: number
  max: number
  unit: 'NDVI'
  stops: Array<{
    value: number
    color: [number, number, number]
  }>
}

export type HeroMapResponse = {
  success: boolean
  cacheHit: boolean
  data?: {
    outlinePng: string
    topoPng: string
    legend: HeroLegend
    bbox: BBox
    source: string
    generatedAt: string
    metricGrid: {
      encoded: string
      width: number
      height: number
    }
    imagery: {
      id: string
      date: string | null
      cloudCover: number | null
      platform: string | null
    }
  }
  warnings: string[]
  message?: string
}

export type LlmDiagnostics = {
  llmAttemptedModels: string[]
  llmFinalModel: string | null
  llmRetries: number
  llmDegraded: boolean
  unavailable?: boolean
  retryAfterMs?: number
  assistantBackend?: 'llm-gemini' | 'unavailable'
}

export type GeoJsonPolygon = {
  type: 'Polygon'
  coordinates: [number, number][][]
}

export type GridCellSummary = {
  cellId: string
  row: number
  col: number
  mean: number
  min: number
  max: number
  validPixelRatio: number
  stressLevel: 'high' | 'moderate' | 'low' | 'unknown'
}

export type GeocodePlace = {
  display_name: string
  lat: number
  lon: number
  bbox: [number, number, number, number]
  source: string
}

export type GeocodeResponse = {
  success: boolean
  query: string
  normalizedQuery: string
  places: GeocodePlace[]
  warnings?: string[]
  providersTried?: ProviderDiagnostic[]
}

export type TimeseriesPoint = {
  date: string
  ndvi: number
  cloudCover: number | null
  confidence: number
  source: string
  isSimulated: boolean
}

export type TimeseriesSummary = {
  totalPoints: number
  averageNDVI: number
  trend: 'improving' | 'declining' | 'stable'
  seasonality: {
    detected: boolean
    amplitude: number
    peakMonth: number | null
    lowMonth: number | null
  }
}

export type TimeseriesResponse = {
  success: boolean
  data: {
    timeSeries: TimeseriesPoint[]
    bbox: BBox
    interval: 'daily' | 'weekly' | 'monthly'
    startDate: string
    endDate: string
    summary: TimeseriesSummary
  }
  source: string
  isSimulated: boolean
  cacheHit: boolean
  warnings: string[]
  providersTried: ProviderDiagnostic[]
}

export type ApiErrorResponse = {
  error: ApiErrorCode | string
  message: string
  reason?: string
  providersTried?: ProviderDiagnostic[]
}

export type PlotItem = {
  id: string
  name: string
  locationName?: string | null
  description?: string
  previewPng?: string | null
  ndviStats?: { min: number; max: number; mean: number } | null
  geojson?: GeoJsonPolygon | null
  geojsonText?: string
  bbox?: [number, number, number, number]
  centroid?: [number, number]
  grid3x3?: GridCellSummary[]
  previewDropped?: boolean
  createdAt?: string
  ownerUid?: string
}
