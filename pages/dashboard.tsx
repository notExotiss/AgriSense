
import React, { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Activity, AlertTriangle, Cloud, Database, Droplets, Leaf, Loader2, Save, ShieldCheck, Waves } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import NavBar from '../components/NavBar'
import Chatbot from '../components/Chatbot'
import TimeSeriesChart from '../components/TimeSeriesChart'
import AoiGridImageOverlay from '../components/AoiGridImageOverlay'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { auth, isFirebaseClientConfigured } from '../lib/firebaseClient'
import { mapGoogleSignInError, signInWithGoogle } from '../lib/client/auth'
import { ApiClientError, mapSaveError, savePlot } from '../lib/client/api'
import { canvasToBase64Png, renderMetricCanvas } from '../lib/visual/metric-render'
import type { CellFootprint, GeocodePlace, GeoJsonPolygon, GridCellSummary, ProviderDiagnostic, RasterAlignment } from '../lib/types/api'

const MapView = dynamic(() => import('../components/MapView'), { ssr: false })
const AoiTerrain3D = dynamic(() => import('../components/AoiTerrain3D'), { ssr: false })

type Objective = 'balanced' | 'yield' | 'water'

type IngestData = {
  provider: string
  fallbackUsed: boolean
  imagery: { id: string; date: string | null; cloudCover: number | null; platform: string | null }
  bbox: [number, number, number, number]
  alignment: RasterAlignment
  sceneRef: {
    provider: string
    sceneId: string
    sceneDate: string | null
  }
  dataResolutionMeters: number
  ndvi: {
    previewPng: string
    width: number
    height: number
    metricGrid?: {
      encoded: string
      validMaskEncoded?: string
      normalizationMode?: 'fixedPhysicalRange' | 'sceneAdaptiveRange'
      width: number
      height: number
      min: number
      max: number
    }
    stats: { min: number; max: number; mean: number; p10?: number; p90?: number }
    validPixelRatio: number
    aoiMaskMeta?: {
      applied: boolean
      coveredPixelRatio: number
    }
    grid3x3: GridCellSummary[]
    cellFootprints?: CellFootprint[]
  }
  ndmi?: {
    metricGrid?: {
      encoded: string
      validMaskEncoded?: string
      normalizationMode?: 'fixedPhysicalRange' | 'sceneAdaptiveRange'
      width: number
      height: number
      min: number
      max: number
    }
    stats?: { min: number; max: number; mean: number; p10?: number; p90?: number }
  }
}

type LayerMetricGrid = {
  values: number[]
  validMask?: number[]
  normalizationMode?: 'fixedPhysicalRange' | 'sceneAdaptiveRange'
  width: number
  height: number
  min: number
  max: number
  source: string
  units: string
  isSimulated: boolean
}

type LayerResponseState = {
  unavailable?: boolean
  message?: string
  source?: string
  isSimulated?: boolean
  representation?: string
  stats?: { min: number; max: number; mean: number }
  overlayPng?: string
  metricGrid?: LayerMetricGrid | null
  alignment?: RasterAlignment
  baseline?: any
  proxy?: any
}

function parseBbox(value: string): [number, number, number, number] | null {
  const parts = value.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return null
  return parts as [number, number, number, number]
}

function bboxFromPlace(place: GeocodePlace) {
  const [south, north, west, east] = place.bbox
  return `${west},${south},${east},${north}`
}

function normalizeStats(stats: any, fallback = { min: 0, max: 0, mean: 0 }) {
  return {
    min: Number(stats?.min ?? fallback.min),
    max: Number(stats?.max ?? fallback.max),
    mean: Number(stats?.mean ?? fallback.mean),
  }
}

function toFiniteNumber(value: any, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function decodeFloat32Grid(encoded: string, width: number, height: number) {
  if (!encoded || typeof window === 'undefined') return null
  try {
    const binary = window.atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const expected = width * height
    const floats = new Float32Array(bytes.buffer, bytes.byteOffset, Math.min(expected, Math.floor(bytes.byteLength / 4)))
    const values = new Array<number>(expected)
    for (let i = 0; i < expected; i++) {
      const value = floats[i]
      values[i] = Number.isFinite(value) ? Number(value) : Number.NaN
    }
    return values
  } catch {
    return null
  }
}

function decodeMaskGrid(encoded: string, width: number, height: number) {
  if (!encoded || typeof window === 'undefined') return null
  try {
    const binary = window.atob(encoded)
    const expected = width * height
    const values = new Array<number>(expected)
    for (let i = 0; i < expected; i++) {
      values[i] = i < binary.length ? (binary.charCodeAt(i) > 0 ? 1 : 0) : 0
    }
    return values
  } catch {
    return null
  }
}

function normalizeHybridLayerPayload(payload: any, kind: 'soil' | 'et'): LayerResponseState {
  const unavailable = Boolean(payload?.unavailable)
  const data = payload?.data
  const metric = data?.metricGrid

  let metricGrid: LayerMetricGrid | null = null
  if (
    metric?.encoded &&
    metric?.validMaskEncoded &&
    Number(metric?.width) > 1 &&
    Number(metric?.height) > 1
  ) {
    const decoded = decodeFloat32Grid(metric.encoded, Number(metric.width), Number(metric.height))
    if (decoded && decoded.length >= Number(metric.width) * Number(metric.height)) {
      const decodedMask = decodeMaskGrid(String(metric.validMaskEncoded), Number(metric.width), Number(metric.height))
      metricGrid = {
        values: decoded,
        validMask: decodedMask || undefined,
        normalizationMode: metric?.normalizationMode === 'fixedPhysicalRange' ? 'fixedPhysicalRange' : 'sceneAdaptiveRange',
        width: Number(metric.width),
        height: Number(metric.height),
        min: Number.isFinite(Number(metric?.min)) ? Number(metric.min) : 0,
        max: Number.isFinite(Number(metric?.max)) ? Number(metric.max) : 1,
        source: String(data?.source || payload?.source || kind),
        units: kind === 'soil' ? 'm3/m3' : 'mm/day',
        isSimulated: Boolean(payload?.isSimulated),
      }
    }
  }

  return {
    unavailable,
    message: typeof payload?.message === 'string' ? payload.message : undefined,
    source: payload?.source,
    isSimulated: Boolean(payload?.isSimulated),
    representation: payload?.representation,
    stats: normalizeStats(data?.stats || payload?.stats),
    overlayPng: typeof data?.overlayPng === 'string' ? data.overlayPng : undefined,
    metricGrid,
    alignment: payload?.alignment,
    baseline: payload?.baseline,
    proxy: payload?.proxy,
  }
}

function plotPointLabel(cell?: { row: number; col: number } | null) {
  if (!cell) return null
  return `P${cell.row * 3 + cell.col + 1}`
}

function compactWeatherForRequest(raw: any) {
  if (!raw) return null
  const current = raw?.data?.current || raw?.current || {}
  return {
    source: raw?.source || null,
    isSimulated: Boolean(raw?.isSimulated),
    current: {
      temperature: toFiniteNumber(current?.temperature),
      humidity: toFiniteNumber(current?.humidity),
      precipitation: toFiniteNumber(current?.precipitation),
      windSpeed: toFiniteNumber(current?.windSpeed),
    },
  }
}

function compactLayerForRequest(raw: any) {
  if (!raw) return null
  return {
    source: raw?.source || null,
    isSimulated: Boolean(raw?.isSimulated),
    stats: normalizeStats(raw?.stats),
  }
}

function compactTimeSeriesForRequest(raw: any) {
  if (!raw) return null
  const points = Array.isArray(raw?.data?.timeSeries)
    ? raw.data.timeSeries
    : Array.isArray(raw?.timeSeries)
      ? raw.timeSeries
      : []
  return {
    source: raw?.source || null,
    isSimulated: Boolean(raw?.isSimulated),
    summary: raw?.data?.summary || raw?.summary || null,
    timeSeries: points.slice(-12).map((point: any) => ({
      date: String(point?.date || ''),
      ndvi: toFiniteNumber(point?.ndvi),
      cloudCover: typeof point?.cloudCover === 'number' ? point.cloudCover : null,
      confidence: typeof point?.confidence === 'number' ? point.confidence : null,
    })),
  }
}

function polygonStateToGeojson(coords: any[]): { type: 'Polygon'; coordinates: [number, number][][] } | null {
  if (!Array.isArray(coords) || !coords.length) return null
  const ring: [number, number][] = []
  for (const point of coords) {
    const lat = Number(point?.lat ?? point?.[0])
    const lon = Number(point?.lng ?? point?.[1] ?? point?.[0])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    ring.push([lon, lat])
  }
  if (ring.length < 3) return null
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first)
  if (ring.length < 4) return null
  return {
    type: 'Polygon',
    coordinates: [ring],
  }
}

function LayerBadge({ label, isSimulated }: { label: string; isSimulated?: boolean }) {
  return (
    <span className={isSimulated ? 'status-chip border-amber-300 bg-amber-50 text-amber-800' : 'status-chip border-emerald-300 bg-emerald-50 text-emerald-800'}>
      {label}
    </span>
  )
}

export default function Dashboard() {
  const authConfigured = isFirebaseClientConfigured

  const [query, setQuery] = useState('Edison, New Jersey')
  const [places, setPlaces] = useState<GeocodePlace[]>([])
  const [bbox, setBbox] = useState('-74.49,40.45,-74.33,40.59')
  const [polygon, setPolygon] = useState<any[]>([])
  const [dateRange, setDateRange] = useState('2025-12-01/2026-01-30')
  const [objective, setObjective] = useState<Objective>('balanced')

  const [layer, setLayer] = useState<'ndvi' | 'soil' | 'et'>('ndvi')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cacheClearing, setCacheClearing] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [selectedCell, setSelectedCell] = useState<string | null>(null)
  const [showTerrain3D, setShowTerrain3D] = useState(false)
  const [clearAoiSignal, setClearAoiSignal] = useState(0)
  const layerImageContainerRef = useRef<HTMLDivElement | null>(null)
  const layerImageRef = useRef<HTMLImageElement | null>(null)
  const [gridFrame, setGridFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const [ingest, setIngest] = useState<IngestData | null>(null)
  const [weather, setWeather] = useState<any>(null)
  const [soil, setSoil] = useState<LayerResponseState | null>(null)
  const [et, setEt] = useState<LayerResponseState | null>(null)
  const [timeSeries, setTimeSeries] = useState<any>(null)
  const [inference, setInference] = useState<any>(null)
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const [scenario, setScenario] = useState({
    irrigationDelta: 0,
    waterBudget: 0.5,
    targetRisk: 0.35,
    fertilizerDelta: 0,
  })
  const [scenarioResult, setScenarioResult] = useState<any>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [providers, setProviders] = useState<ProviderDiagnostic[]>([])
  const [alertThresholds, setAlertThresholds] = useState({
    criticalNdvi: 0.28,
    warningNdvi: 0.42,
    highAnomaly: 0.66,
  })

  const ndviStats = useMemo(() => normalizeStats(ingest?.ndvi?.stats), [ingest])
  const soilStats = useMemo(() => normalizeStats(soil?.stats), [soil])
  const etStats = useMemo(() => normalizeStats(et?.stats), [et])
  const gridCells = ingest?.ndvi?.grid3x3 || []
  const selectedCellData = useMemo(
    () => gridCells.find((cell) => cell.cellId === selectedCell) || null,
    [gridCells, selectedCell]
  )
  const selectedPlotPoint = useMemo(() => plotPointLabel(selectedCellData), [selectedCellData])
  const providerLayerImage =
    layer === 'ndvi'
      ? ingest?.ndvi?.previewPng
      : layer === 'soil'
        ? soil?.overlayPng
        : et?.overlayPng
  const selectedLayerState =
    layer === 'soil' ? soil : layer === 'et' ? et : null

  const ndviMetricGrid = useMemo<LayerMetricGrid | null>(() => {
    const grid = ingest?.ndvi?.metricGrid
    if (!grid?.encoded || !grid?.validMaskEncoded || !grid?.width || !grid?.height) return null
    const values = decodeFloat32Grid(grid.encoded, grid.width, grid.height)
    if (!values || !values.length) return null
    const validMask = decodeMaskGrid(String(grid.validMaskEncoded), grid.width, grid.height)
    return {
      values,
      validMask: validMask || undefined,
      normalizationMode: grid.normalizationMode === 'fixedPhysicalRange' ? 'fixedPhysicalRange' : 'sceneAdaptiveRange',
      width: grid.width,
      height: grid.height,
      min: Number.isFinite(grid.min) ? grid.min : ndviStats.min,
      max: Number.isFinite(grid.max) ? grid.max : ndviStats.max,
      source: ingest?.provider || 'NDVI',
      units: 'NDVI',
      isSimulated: false,
    }
  }, [ingest?.ndvi?.metricGrid?.encoded, ingest?.ndvi?.metricGrid?.validMaskEncoded, ingest?.ndvi?.metricGrid?.width, ingest?.ndvi?.metricGrid?.height, ingest?.ndvi?.metricGrid?.min, ingest?.ndvi?.metricGrid?.max, ingest?.provider, ndviStats.min, ndviStats.max])

  const layerMetricGrid = useMemo<LayerMetricGrid | null>(() => {
    if (layer === 'soil') return soil?.metricGrid || null
    if (layer === 'et') return et?.metricGrid || null
    return ndviMetricGrid
  }, [layer, ndviMetricGrid, soil?.metricGrid, et?.metricGrid])

  const renderedLayerImage = useMemo(() => {
    if (typeof document === 'undefined') return null
    if (!layerMetricGrid || !Array.isArray(layerMetricGrid.values)) return null
    if (layerMetricGrid.width < 2 || layerMetricGrid.height < 2) return null
    if (layerMetricGrid.values.length < layerMetricGrid.width * layerMetricGrid.height) return null
    try {
      const rendered = renderMetricCanvas({
        metric: layer,
        grid: {
          values: layerMetricGrid.values,
          validMask: layerMetricGrid.validMask,
          width: layerMetricGrid.width,
          height: layerMetricGrid.height,
          min: layerMetricGrid.min,
          max: layerMetricGrid.max,
        },
        outputWidth: layerMetricGrid.width,
        outputHeight: layerMetricGrid.height,
        contours: false,
      })
      const ctx = rendered.canvas.getContext('2d')
      if (ctx) {
        ctx.save()
        ctx.globalCompositeOperation = 'destination-over'
        ctx.fillStyle =
          layer === 'ndvi'
            ? '#b8d9c6'
            : layer === 'soil'
              ? '#d7dfd2'
              : '#d3dde7'
        ctx.fillRect(0, 0, rendered.canvas.width, rendered.canvas.height)
        ctx.restore()
      }
      return canvasToBase64Png(rendered.canvas)
    } catch {
      return null
    }
  }, [layer, layerMetricGrid])

  const renderedNdviMapImage = useMemo(() => {
    if (typeof document === 'undefined') return null
    if (!ndviMetricGrid || !Array.isArray(ndviMetricGrid.values)) return null
    if (ndviMetricGrid.width < 2 || ndviMetricGrid.height < 2) return null
    if (ndviMetricGrid.values.length < ndviMetricGrid.width * ndviMetricGrid.height) return null
    try {
      const rendered = renderMetricCanvas({
        metric: 'ndvi',
        grid: {
          values: ndviMetricGrid.values,
          validMask: ndviMetricGrid.validMask,
          width: ndviMetricGrid.width,
          height: ndviMetricGrid.height,
          min: ndviMetricGrid.min,
          max: ndviMetricGrid.max,
        },
        outputWidth: ndviMetricGrid.width,
        outputHeight: ndviMetricGrid.height,
        contours: false,
      })
      const ctx = rendered.canvas.getContext('2d')
      if (ctx) {
        ctx.save()
        ctx.globalCompositeOperation = 'destination-over'
        ctx.fillStyle = '#b8d9c6'
        ctx.fillRect(0, 0, rendered.canvas.width, rendered.canvas.height)
        ctx.restore()
      }
      return canvasToBase64Png(rendered.canvas)
    } catch {
      return null
    }
  }, [ndviMetricGrid])

  const layerImage = renderedLayerImage || providerLayerImage

  const syncGridFrame = () => {
    const container = layerImageContainerRef.current
    const image = layerImageRef.current
    if (!container || !image) {
      setGridFrame(null)
      return
    }

    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight
    const naturalWidth = image.naturalWidth || 0
    const naturalHeight = image.naturalHeight || 0

    if (!containerWidth || !containerHeight || !naturalWidth || !naturalHeight) {
      setGridFrame(null)
      return
    }

    const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight)
    const width = Math.max(1, Math.floor(naturalWidth * scale))
    const height = Math.max(1, Math.floor(naturalHeight * scale))
    const left = Math.max(0, Math.round((containerWidth - width) / 2))
    const top = Math.max(0, Math.round((containerHeight - height) / 2))

    setGridFrame({
      left,
      top,
      width,
      height,
    })
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem('agrisense.alertThresholds.v1')
    if (!stored) return
    try {
      const parsed = JSON.parse(stored)
      setAlertThresholds({
        criticalNdvi: Number(parsed?.criticalNdvi) || 0.28,
        warningNdvi: Number(parsed?.warningNdvi) || 0.42,
        highAnomaly: Number(parsed?.highAnomaly) || 0.66,
      })
    } catch {
      // ignore malformed local settings
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('agrisense.alertThresholds.v1', JSON.stringify(alertThresholds))
  }, [alertThresholds])

  useEffect(() => {
    if (!ingest) return
    const alertItems: any[] = []
    if (ndviStats.mean < alertThresholds.criticalNdvi) {
      alertItems.push({
        id: 'ndvi-critical',
        type: 'critical',
        message: 'Critical vegetation stress risk',
        details: `NDVI mean is ${ndviStats.mean.toFixed(3)}.`,
        plotName: 'Current AOI',
      })
    } else if (ndviStats.mean < alertThresholds.warningNdvi) {
      alertItems.push({
        id: 'ndvi-warning',
        type: 'warning',
        message: 'Moderate canopy stress detected',
        details: `NDVI mean is ${ndviStats.mean.toFixed(3)}.`,
        plotName: 'Current AOI',
      })
    }
    if (Number(inference?.anomaly?.score || 0) >= alertThresholds.highAnomaly || inference?.anomaly?.level === 'high') {
      alertItems.push({
        id: 'anomaly-high',
        type: 'critical',
        message: 'High anomaly score',
        details: inference?.anomaly?.signals?.[0] || 'Unusual field behavior detected.',
        plotName: 'Current AOI',
      })
    }
    window.dispatchEvent(new CustomEvent('agrisense:alerts', { detail: alertItems }))
  }, [ingest, ndviStats.mean, inference?.anomaly?.level, inference?.anomaly?.score, inference?.anomaly?.signals, alertThresholds])

  useEffect(() => {
    syncGridFrame()
    const onResize = () => syncGridFrame()
    window.addEventListener('resize', onResize)
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => syncGridFrame())
        : null
    if (observer) {
      if (layerImageContainerRef.current) observer.observe(layerImageContainerRef.current)
      if (layerImageRef.current) observer.observe(layerImageRef.current)
    }

    return () => {
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [layerImage, ingest?.alignment?.bbox?.join(','), ingest?.bbox?.join(','), layer])

  async function ensureSignedIn() {
    if (!authConfigured || !auth) throw new Error('Firebase Auth is not configured')
    try {
      return await signInWithGoogle(auth)
    } catch (error) {
      throw new Error(mapGoogleSignInError(error))
    }
  }

  async function geocode() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || payload?.error || 'Geocoding failed')
      const nextPlaces = Array.isArray(payload?.places) ? payload.places : []
      setPlaces(nextPlaces)
      if (!nextPlaces.length) toast.warning('No matching places found.')
    } catch (error: any) {
      toast.error(error?.message || 'Geocoding failed')
    } finally {
      setLoading(false)
    }
  }

  function selectPlace(place: GeocodePlace) {
    setBbox(bboxFromPlace(place))
    setPlaces([])
  }

  function polygonToBbox(coords: any[]) {
    if (!Array.isArray(coords) || !coords.length) return
    let minLon = Number.POSITIVE_INFINITY
    let minLat = Number.POSITIVE_INFINITY
    let maxLon = Number.NEGATIVE_INFINITY
    let maxLat = Number.NEGATIVE_INFINITY

    for (const coord of coords) {
      const lat = Number(coord?.lat ?? coord?.[0])
      const lon = Number(coord?.lng ?? coord?.[1] ?? coord?.[0])
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
      minLon = Math.min(minLon, lon)
      minLat = Math.min(minLat, lat)
      maxLon = Math.max(maxLon, lon)
      maxLat = Math.max(maxLat, lat)
    }

    if (Number.isFinite(minLon) && Number.isFinite(minLat) && Number.isFinite(maxLon) && Number.isFinite(maxLat)) {
      setBbox(`${minLon},${minLat},${maxLon},${maxLat}`)
    }
  }
  async function analyze() {
    const parsedBbox = parseBbox(bbox)
    if (!parsedBbox) {
      toast.error('Bounding box must be in format minLon,minLat,maxLon,maxLat')
      return
    }
    const drawnGeometry = polygonStateToGeojson(polygon as any[]) as GeoJsonPolygon | null

    setLoading(true)
    setWarnings([])
    setProviders([])
    setInference(null)
    setSoil(null)
    setEt(null)

    try {
      const ingestResponse = await fetch('/api/ingest/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bbox: parsedBbox,
          geometry: drawnGeometry,
          date: dateRange,
          targetSize: 512,
          policy: 'balanced',
        }),
      })
      const ingestPayload = await ingestResponse.json().catch(() => ({}))
      if (!ingestResponse.ok || !ingestPayload?.success) {
        throw new Error(ingestPayload?.message || ingestPayload?.error || 'Ingest failed')
      }
      const ingestData = ingestPayload.data as IngestData
      const defaultCellId = ingestData?.ndvi?.grid3x3?.some((cell) => cell.cellId === '1-1')
        ? '1-1'
        : ingestData?.ndvi?.grid3x3?.[0]?.cellId || null
      setIngest(ingestData)
      const alignedBbox = ingestData?.alignment?.bbox || ingestData?.bbox
      if (Array.isArray(alignedBbox) && alignedBbox.length === 4) {
        setBbox(alignedBbox.join(','))
      }
      setSelectedCell(defaultCellId)
      const ingestWarnings = Array.isArray(ingestPayload?.warnings) ? ingestPayload.warnings : []

      const [weatherResult, soilResult, etResult, timeseriesResult] = await Promise.allSettled([
        fetch('/api/weather', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox: parsedBbox }),
        }).then((r) => r.json()),
        fetch('/api/soil', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox: parsedBbox, geometry: drawnGeometry, date: dateRange, targetSize: 512 }),
        }).then((r) => r.json()),
        fetch('/api/et', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox: parsedBbox, geometry: drawnGeometry, date: dateRange, targetSize: 512 }),
        }).then((r) => r.json()),
        fetch('/api/timeseries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox: parsedBbox, interval: 'weekly' }),
        }).then((r) => r.json()),
      ])

      const nextWarnings = [...ingestWarnings]
      const providerDiagnostics: ProviderDiagnostic[] = []

      if (weatherResult.status === 'fulfilled') {
        setWeather(weatherResult.value)
        providerDiagnostics.push(...(weatherResult.value?.providersTried || []))
        if (Array.isArray(weatherResult.value?.warnings)) nextWarnings.push(...weatherResult.value.warnings)
      } else {
        nextWarnings.push('Weather provider unavailable.')
      }

      if (soilResult.status === 'fulfilled') {
        const soilPayload = normalizeHybridLayerPayload(soilResult.value, 'soil')
        setSoil(soilPayload)
        providerDiagnostics.push(...(soilResult.value?.providersTried || []))
        if (Array.isArray(soilResult.value?.warnings)) nextWarnings.push(...soilResult.value.warnings)
        if (soilPayload.unavailable) nextWarnings.push(soilPayload.message || 'Soil layer unavailable in strict real-only mode.')
      } else {
        setSoil({ unavailable: true, message: 'Soil provider unavailable.' })
        nextWarnings.push('Soil provider unavailable.')
      }

      if (etResult.status === 'fulfilled') {
        const etPayload = normalizeHybridLayerPayload(etResult.value, 'et')
        setEt(etPayload)
        providerDiagnostics.push(...(etResult.value?.providersTried || []))
        if (Array.isArray(etResult.value?.warnings)) nextWarnings.push(...etResult.value.warnings)
        if (etPayload.unavailable) nextWarnings.push(etPayload.message || 'ET layer unavailable in strict real-only mode.')
      } else {
        setEt({ unavailable: true, message: 'ET provider unavailable.' })
        nextWarnings.push('ET provider unavailable.')
      }

      if (timeseriesResult.status === 'fulfilled') {
        setTimeSeries(timeseriesResult.value)
        providerDiagnostics.push(...(timeseriesResult.value?.providersTried || []))
        if (Array.isArray(timeseriesResult.value?.warnings)) nextWarnings.push(...timeseriesResult.value.warnings)
      } else {
        nextWarnings.push('Time-series provider unavailable.')
      }

      const analysisResponse = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Generate an AI assistant field recommendation summary.',
          objective,
          ndviData: { stats: ingestData?.ndvi?.stats },
          weatherData:
            weatherResult.status === 'fulfilled'
              ? {
                  source: weatherResult.value?.source,
                  isSimulated: weatherResult.value?.isSimulated,
                  current: weatherResult.value?.data?.current || {},
                }
              : null,
          soilData:
            soilResult.status === 'fulfilled'
              ? {
                  source: soilResult.value?.source,
                  isSimulated: soilResult.value?.isSimulated,
                  stats: soilResult.value?.data?.stats || {},
                }
              : null,
          etData:
            etResult.status === 'fulfilled'
              ? {
                  source: etResult.value?.source,
                  isSimulated: etResult.value?.isSimulated,
                  stats: etResult.value?.data?.stats || {},
                }
              : null,
          timeSeriesData:
            timeseriesResult.status === 'fulfilled'
              ? {
                  source: timeseriesResult.value?.source,
                  isSimulated: timeseriesResult.value?.isSimulated,
                  summary: timeseriesResult.value?.data?.summary,
                  timeSeries: (timeseriesResult.value?.data?.timeSeries || []).slice(-12),
                }
              : null,
          providersTried: providerDiagnostics,
          context: {
            bbox: ingestData?.alignment?.bbox || ingestData?.bbox || parsedBbox,
            ndviStats: ingestData?.ndvi?.stats,
            grid3x3: ingestData?.ndvi?.grid3x3 || [],
            selectedCell: defaultCellId,
            warnings: nextWarnings.slice(0, 12),
          },
        }),
      })
      const analysisPayload = await analysisResponse.json().catch(() => ({}))
      if (!analysisResponse.ok) {
        throw new Error(analysisPayload?.message || 'ML analysis failed')
      }
      setInference(analysisPayload?.inference || null)
      setWarnings(nextWarnings.filter(Boolean))
      setProviders(providerDiagnostics)
      toast.success('Analysis complete')
    } catch (error: any) {
      toast.error(error?.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  async function saveCurrentPlot() {
    if (!ingest) return
    setSaving(true)
    try {
      const signedUser = await ensureSignedIn()
      if (!signedUser) return
      const token = await signedUser.getIdToken(true)
      const drawnPolygon = polygonStateToGeojson(polygon as any[])
      const fallbackPolygon = {
        type: 'Polygon' as const,
        coordinates: [[
          [ingest.bbox[0], ingest.bbox[1]],
          [ingest.bbox[2], ingest.bbox[1]],
          [ingest.bbox[2], ingest.bbox[3]],
          [ingest.bbox[0], ingest.bbox[3]],
          [ingest.bbox[0], ingest.bbox[1]],
        ]],
      }
      const payload = {
        name: `AOI ${new Date().toLocaleDateString()}`,
        locationName: query,
        description: `Provider: ${ingest.provider}${ingest.fallbackUsed ? ' (fallback used)' : ''}`,
        ndviStats: ndviStats,
        previewPng: ingest.ndvi.previewPng,
        bbox: ingest.bbox,
        geojson: drawnPolygon || fallbackPolygon,
        grid3x3: ingest.ndvi.grid3x3 || [],
        inferenceSnapshot: inference || null,
        sourceQuality: {
          ingestProvider: ingest.provider,
          fallbackUsed: ingest.fallbackUsed,
          warnings,
          providersTried: providers,
        },
      }

      try {
        await savePlot(token, payload)
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401 && auth?.currentUser) {
          const retryToken = await auth.currentUser.getIdToken(true)
          await savePlot(retryToken, payload)
        } else {
          throw error
        }
      }
      toast.success('Plot saved')
    } catch (error) {
      toast.error(mapSaveError(error))
    } finally {
      setSaving(false)
    }
  }

  async function runWhatIf() {
    if (!ingest) {
      toast.error('Run analysis before scenario simulation.')
      return
    }
    setScenarioLoading(true)
    try {
      const response = await fetch('/api/ai/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective,
          scenario,
          ndviData: { stats: ingest.ndvi.stats },
          weatherData: compactWeatherForRequest(weather),
          soilData: compactLayerForRequest(soil),
          etData: compactLayerForRequest(et),
          timeSeriesData: compactTimeSeriesForRequest(timeSeries),
          providersTried: providers,
          context: {
            ndviStats: ingest.ndvi.stats,
            grid3x3: (ingest.ndvi.grid3x3 || []).slice(0, 9),
            selectedCell,
          },
          selectedCell,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || payload?.error || 'Simulation failed')
      setScenarioResult(payload?.scenario || null)
      toast.success('Scenario simulation completed')
    } catch (error: any) {
      toast.error(error?.message || 'Scenario simulation failed')
    } finally {
      setScenarioLoading(false)
    }
  }

  async function clearCaches() {
    setCacheClearing(true)
    try {
      const response = await fetch('/api/cache/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || payload?.error || 'Cache clear failed')
      }
      const memoryCount = Number(payload?.memoryCleared || 0)
      const firestoreCount = Number(payload?.firestoreCleared || 0)
      toast.success(`Cache cleared (memory: ${memoryCount}, firestore: ${firestoreCount})`)
      if (payload?.warning) {
        toast.warning(String(payload.warning))
      }
    } catch (error: any) {
      toast.error(error?.message || 'Cache clear failed')
    } finally {
      setCacheClearing(false)
    }
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="app-shell py-6">
        <motion.section
          className="mb-6 grid gap-4 lg:grid-cols-[1.35fr_0.9fr]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          <article id="pipeline" className="surface-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-zinc-900">Field Operations Workbench</h1>
                <p className="mt-1 text-sm text-zinc-600">Data pipeline, AOI controls, analysis, planning, and save flows are unified here.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant={objective === 'balanced' ? 'default' : 'outline'} onClick={() => setObjective('balanced')}>Balanced</Button>
                <Button variant={objective === 'yield' ? 'default' : 'outline'} onClick={() => setObjective('yield')}>Yield</Button>
                <Button variant={objective === 'water' ? 'default' : 'outline'} onClick={() => setObjective('water')}>Water</Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Search location</label>
                <div className="flex gap-2">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-800"
                    placeholder="Edison, New Jersey"
                  />
                  <Button variant="outline" disabled={loading} onClick={geocode}>Find</Button>
                </div>
                {places.length > 0 && (
                  <div className="mt-2 max-h-44 overflow-auto rounded-xl border border-zinc-200 bg-white">
                    {places.map((place) => (
                      <button
                        key={`${place.display_name}-${place.lat}-${place.lon}`}
                        onClick={() => selectPlace(place)}
                        className="block w-full border-b border-zinc-100 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        {place.display_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Date range</label>
                <input
                  value={dateRange}
                  onChange={(event) => setDateRange(event.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-800"
                  placeholder="YYYY-MM-DD/YYYY-MM-DD"
                />
                <p className="mt-1 text-[11px] text-zinc-500">Policy: balanced freshness + cloud | Output: 512x512</p>
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">Bounding box</label>
              <input
                value={bbox}
                onChange={(event) => setBbox(event.target.value)}
                className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-emerald-800"
              />
            </div>

            <div className="mt-4 h-[26rem] overflow-hidden rounded-2xl border border-zinc-200">
              <MapView
                bbox={parseBbox(bbox) || undefined}
                onBboxChange={(value) => setBbox(value.join(','))}
                polygon={polygon as any}
                onPolygonChange={(coords) => {
                  setPolygon(coords as any)
                  polygonToBbox(coords as any)
                }}
                ndviPng={renderedNdviMapImage || ingest?.ndvi?.previewPng}
                ndviBounds={ingest?.alignment?.bbox || ingest?.bbox}
                grid3x3={ingest?.ndvi?.grid3x3}
                cellFootprints={ingest?.ndvi?.cellFootprints}
                selectedCell={selectedCell}
                onSelectCell={setSelectedCell}
                showGrid={showGrid}
                smoothOverlay={true}
                debugMode={showDebug}
                debugMetricGrid={ndviMetricGrid}
                debugAlignmentBbox={ingest?.alignment?.bbox || ingest?.bbox}
                debugResolutionMeters={ingest?.alignment?.pixelSizeMetersApprox ?? ingest?.dataResolutionMeters ?? null}
                debugCoverage={ingest?.ndvi?.aoiMaskMeta?.coveredPixelRatio ?? null}
                clearAoiSignal={clearAoiSignal}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={loading} onClick={analyze}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}Analyze AOI
              </Button>
              <Button variant="outline" disabled={!ingest || saving} onClick={saveCurrentPlot}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save Plot
              </Button>
              <Button variant={showGrid ? 'default' : 'outline'} onClick={() => setShowGrid((prev) => !prev)}>
                {showGrid ? 'Hide 3x3 Grid' : 'Show 3x3 Grid'}
              </Button>
              <Button variant={showTerrain3D ? 'default' : 'outline'} onClick={() => setShowTerrain3D((prev) => !prev)}>
                {showTerrain3D ? 'Hide 3D Terrain' : 'Open 3D Terrain'}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPolygon([])
                  setSelectedCell(null)
                  setClearAoiSignal((value) => value + 1)
                }}
              >
                Clear AOI
              </Button>
              <Button variant="outline" disabled={cacheClearing} onClick={clearCaches}>
                {cacheClearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                Clear Cache
              </Button>
              <Button variant="outline" onClick={() => setShowDebug((value) => !value)}>
                <Database className="mr-2 h-4 w-4" />{showDebug ? 'Hide Debug' : 'Show Debug'}
              </Button>
            </div>
          </article>
          <article className="surface-card p-5">
            <h2 className="text-lg font-semibold text-zinc-900">System Diagnostics</h2>
            <p className="mt-1 text-sm text-zinc-600">Source quality, fallback state, and model confidence.</p>

            <div className="mt-4 grid gap-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Satellite source</p>
                  {ingest?.fallbackUsed ? <LayerBadge label="fallback" isSimulated /> : <LayerBadge label="primary" />}
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{ingest?.provider || 'Not analyzed'}</p>
                <p className="text-xs text-zinc-600">Scene: {ingest?.imagery?.date ? new Date(ingest.imagery.date).toLocaleDateString() : 'N/A'} | Cloud: {typeof ingest?.imagery?.cloudCover === 'number' ? `${ingest.imagery.cloudCover.toFixed(1)}%` : 'N/A'}</p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">ML confidence</p>
                  <ShieldCheck className="h-4 w-4 text-emerald-700" />
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-900">{inference ? `${Math.round((inference.confidence || 0) * 100)}%` : 'Pending'}</p>
                <p className="text-xs text-zinc-600">Data quality: {inference ? `${Math.round((inference?.dataQuality?.score || 0) * 100)}%` : 'N/A'} | Objective: {objective}</p>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Layer quality</p>
                  <div className="flex gap-1">
                    <LayerBadge label="weather" isSimulated={weather?.isSimulated} />
                    <LayerBadge label="soil" isSimulated={soil?.isSimulated} />
                    <LayerBadge label="et" isSimulated={et?.isSimulated} />
                  </div>
                </div>
                <p className="mt-1 text-xs text-zinc-600">Time series: {timeSeries?.source || 'N/A'} {timeSeries?.cacheHit ? '(cache)' : ''}</p>
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />Warnings</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-800">
                  {warnings.slice(0, 6).map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">Proactive Alert Thresholds</p>
              <div className="mt-2 space-y-2">
                <label className="block text-xs text-zinc-700">
                  Critical NDVI ({alertThresholds.criticalNdvi.toFixed(2)})
                  <input
                    type="range"
                    min={0.12}
                    max={0.45}
                    step={0.01}
                    value={alertThresholds.criticalNdvi}
                    onChange={(event) =>
                      setAlertThresholds((prev) => ({ ...prev, criticalNdvi: Number(event.target.value) }))
                    }
                    className="mt-1 w-full"
                  />
                </label>
                <label className="block text-xs text-zinc-700">
                  Warning NDVI ({alertThresholds.warningNdvi.toFixed(2)})
                  <input
                    type="range"
                    min={0.2}
                    max={0.6}
                    step={0.01}
                    value={alertThresholds.warningNdvi}
                    onChange={(event) =>
                      setAlertThresholds((prev) => ({ ...prev, warningNdvi: Number(event.target.value) }))
                    }
                    className="mt-1 w-full"
                  />
                </label>
                <label className="block text-xs text-zinc-700">
                  High anomaly ({(alertThresholds.highAnomaly * 100).toFixed(0)}%)
                  <input
                    type="range"
                    min={0.35}
                    max={0.9}
                    step={0.01}
                    value={alertThresholds.highAnomaly}
                    onChange={(event) =>
                      setAlertThresholds((prev) => ({ ...prev, highAnomaly: Number(event.target.value) }))
                    }
                    className="mt-1 w-full"
                  />
                </label>
              </div>
            </div>

            {showDebug && (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-950 p-3 text-xs text-zinc-100">
                <p className="mb-2 font-semibold">Provider Diagnostics</p>
                <div className="space-y-2">
                  {providers.length === 0 && <p className="text-zinc-300">No diagnostics available yet.</p>}
                  {providers.map((provider, index) => (
                    <div key={`${provider.provider}-${index}`} className="rounded border border-zinc-700 bg-zinc-900 p-2">
                      <p className="font-semibold">{provider.provider}</p>
                      <p className="text-zinc-300">status: {provider.ok ? 'ok' : 'failed'} {provider.reason ? `| ${provider.reason}` : ''}{provider.durationMs ? ` | ${provider.durationMs}ms` : ''}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </article>
        </motion.section>

        <motion.section
          className="grid gap-4 lg:grid-cols-[1.25fr_1fr]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.05 }}
        >
          <article className="surface-card p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900">Layer Viewer</h3>
                <p className="text-sm text-zinc-600">Switch between NDVI, soil moisture, and ET overlays.</p>
              </div>
              <div className="flex gap-2">
                <Button variant={layer === 'ndvi' ? 'default' : 'outline'} onClick={() => setLayer('ndvi')}><Leaf className="mr-2 h-4 w-4" />NDVI</Button>
                <Button variant={layer === 'soil' ? 'default' : 'outline'} onClick={() => setLayer('soil')}><Droplets className="mr-2 h-4 w-4" />Soil</Button>
                <Button variant={layer === 'et' ? 'default' : 'outline'} onClick={() => setLayer('et')}><Waves className="mr-2 h-4 w-4" />ET</Button>
              </div>
            </div>

            {layerImage ? (
              <>
                <div ref={layerImageContainerRef} className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
                  <img
                    ref={layerImageRef}
                    src={`data:image/png;base64,${layerImage}`}
                    alt={`${layer} preview`}
                    className="h-[24rem] w-full object-contain"
                    onLoad={syncGridFrame}
                  />
                  <AoiGridImageOverlay
                    cells={ingest?.ndvi?.grid3x3}
                    cellFootprints={ingest?.ndvi?.cellFootprints}
                    alignmentBbox={ingest?.alignment?.bbox || ingest?.bbox}
                    selectedCell={selectedCell}
                    onSelectCell={setSelectedCell}
                    visible={showGrid}
                    frame={gridFrame}
                  />
                </div>
                <p className="mt-2 text-xs text-zinc-600">
                  Color source:{' '}
                  {renderedLayerImage
                    ? 'Quantitative metric grid (matches 3D terrain legend).'
                    : 'Provider preview image (grid values unavailable).'}
                  {layerMetricGrid?.normalizationMode
                    ? ` | Normalization: ${layerMetricGrid.normalizationMode}`
                    : ''}
                </p>
                {(layer === 'soil' || layer === 'et') && selectedLayerState?.representation && (
                  <p className="mt-1 text-xs text-zinc-600">
                    Representation: {selectedLayerState.representation} | Baseline {selectedLayerState.baseline?.provider || 'n/a'} | Proxy {selectedLayerState.proxy?.provider || 'n/a'} | Pixel ~
                    {selectedLayerState.alignment?.pixelSizeMetersApprox
                      ? `${selectedLayerState.alignment.pixelSizeMetersApprox.toFixed(1)}m`
                      : 'n/a'}
                  </p>
                )}
                {selectedLayerState?.unavailable && (
                  <p className="mt-1 text-xs text-amber-700">
                    {selectedLayerState.message || `${layer.toUpperCase()} layer unavailable under strict real-only mode.`}
                  </p>
                )}
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center text-sm text-zinc-600">Run analysis to generate layer outputs.</div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">NDVI mean</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900">{ndviStats.mean.toFixed(3)}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Soil moisture mean</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900">{soil?.unavailable ? 'n/a' : soilStats.mean.toFixed(3)}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">ET mean (mm/day)</p>
                <p className="mt-1 text-lg font-semibold text-zinc-900">{et?.unavailable ? 'n/a' : etStats.mean.toFixed(3)}</p>
              </div>
            </div>
            {selectedCellData && (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3">
                <p className="text-xs uppercase tracking-wide text-sky-700">Selected Plot Point {selectedPlotPoint}</p>
                <p className="mt-1 text-sm text-sky-900">
                  NDVI mean {selectedCellData.mean.toFixed(3)} | stress {selectedCellData.stressLevel} | valid pixels{' '}
                  {(selectedCellData.validPixelRatio * 100).toFixed(1)}%
                </p>
              </div>
            )}
            {showTerrain3D && (
              <div className="mt-3">
                <AoiTerrain3D
                  open={showTerrain3D}
                  bbox={ingest?.alignment?.bbox || ingest?.bbox}
                  geometry={polygonStateToGeojson(polygon as any[]) as GeoJsonPolygon | null}
                  alignmentBbox={ingest?.alignment?.bbox || ingest?.bbox}
                  cellFootprints={ingest?.ndvi?.cellFootprints || null}
                  texturePng={layerImage || ingest?.ndvi?.previewPng}
                  metricGrid={layerMetricGrid}
                  layer={layer}
                  selectedCell={selectedCell}
                />
              </div>
            )}
          </article>

          <article className="surface-card p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-900">Recommendations</h3>
              {inference?.isSimulatedInputs && <Badge variant="outline">Simulated inputs</Badge>}
            </div>
            <p className="mt-1 text-sm text-zinc-600">Deterministic ML guidance for field operations.</p>

            {!inference ? (
              <div className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">Run analysis to generate recommendations.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {selectedCellData && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                    <p className="text-xs uppercase tracking-wide text-sky-700">Plot Point focus ({selectedPlotPoint})</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-sky-900">
                      {selectedCellData.stressLevel === 'high' && (
                        <>
                          <li>Prioritize irrigation uniformity check in this cell within 24 hours.</li>
                          <li>Scout canopy stress causes and compare emitter pressure.</li>
                        </>
                      )}
                      {selectedCellData.stressLevel === 'moderate' && (
                        <>
                          <li>Schedule targeted scouting and soil check in this cell this week.</li>
                          <li>Re-check NDVI after next irrigation cycle.</li>
                        </>
                      )}
                      {selectedCellData.stressLevel === 'low' && (
                        <>
                          <li>Maintain baseline schedule and monitor trend drift.</li>
                          <li>Use this cell as healthy reference for comparisons.</li>
                        </>
                      )}
                      {selectedCellData.stressLevel === 'unknown' && (
                        <>
                          <li>Data quality is low in this cell; re-run analysis with cleaner scene dates.</li>
                        </>
                      )}
                    </ul>
                  </div>
                )}
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">What changed</p>
                  <p className="mt-1 text-sm text-zinc-800">{inference?.summary?.whatChanged}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Why</p>
                  <p className="mt-1 text-sm text-zinc-800">{inference?.summary?.why}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Next actions</p>
                  <p className="mt-1 text-sm text-zinc-800">{inference?.summary?.nextActions}</p>
                  <p className="mt-1 text-xs text-zinc-500">Re-check in {inference?.summary?.recheckIn}</p>
                </div>
                {(inference?.recommendations || []).map((recommendation: any) => (
                  <div key={recommendation.id} className="rounded-xl border border-zinc-200 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-sm font-semibold text-zinc-900">{recommendation.title}</p>
                      <LayerBadge label={recommendation.priority} isSimulated={recommendation.priority === 'high'} />
                    </div>
                    <p className="text-xs text-zinc-600">{recommendation.reason}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-zinc-700">
                      {(recommendation.actions || []).slice(0, 3).map((action: string, index: number) => (
                        <li key={`${recommendation.id}-${index}`}>{action}</li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">What-if Simulator</p>
                  <div className="mt-2 grid gap-2">
                    <label className="text-xs text-zinc-700">
                      Irrigation delta ({scenario.irrigationDelta >= 0 ? '+' : ''}
                      {Math.round(scenario.irrigationDelta * 100)}%)
                    </label>
                    <input
                      type="range"
                      min={-0.3}
                      max={0.6}
                      step={0.05}
                      value={scenario.irrigationDelta}
                      onChange={(event) => setScenario((prev) => ({ ...prev, irrigationDelta: Number(event.target.value) }))}
                    />
                    <label className="text-xs text-zinc-700">Water budget ({Math.round(scenario.waterBudget * 100)}%)</label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={scenario.waterBudget}
                      onChange={(event) => setScenario((prev) => ({ ...prev, waterBudget: Number(event.target.value) }))}
                    />
                    <label className="text-xs text-zinc-700">Target risk ({Math.round(scenario.targetRisk * 100)}%)</label>
                    <input
                      type="range"
                      min={0.05}
                      max={0.9}
                      step={0.05}
                      value={scenario.targetRisk}
                      onChange={(event) => setScenario((prev) => ({ ...prev, targetRisk: Number(event.target.value) }))}
                    />
                    <Button variant="outline" disabled={scenarioLoading} onClick={runWhatIf}>
                      {scenarioLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Run What-if
                    </Button>
                  </div>
                  {scenarioResult && (
                    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
                      <p>Risk: {(scenarioResult.baselineRisk7d * 100).toFixed(1)}% -&gt; {(scenarioResult.scenarioRisk7d * 100).toFixed(1)}%</p>
                      <p>NDVI30: {scenarioResult.baselineNdvi30d.toFixed(3)} -&gt; {scenarioResult.scenarioNdvi30d.toFixed(3)}</p>
                      <p>Water delta: {scenarioResult.waterUseDeltaPct.toFixed(1)}% | Yield proxy: {scenarioResult.yieldProxyDeltaPct.toFixed(1)}%</p>
                      <p className="mt-1">{scenarioResult.recommendation}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </article>
        </motion.section>
        <motion.section
          className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.9fr]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.33, ease: 'easeOut', delay: 0.1 }}
        >
          <article className="surface-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-900">Historical NDVI Trend</h3>
              <div className="flex items-center gap-2">
                <LayerBadge label={timeSeries?.source || 'n/a'} isSimulated={timeSeries?.isSimulated} />
                {timeSeries?.cacheHit && <LayerBadge label="cache" />}
              </div>
            </div>
            <TimeSeriesChart
              data={(timeSeries?.data?.timeSeries || []).map((point: any) => ({
                date: point.date,
                ndvi: Number(point.ndvi),
                confidence: Number(point.confidence),
                cloudCover: typeof point.cloudCover === 'number' ? point.cloudCover : undefined,
              }))}
              title="AOI NDVI timeline"
              showConfidence
              showCloudCover
            />
          </article>

          <article className="surface-card p-5">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-zinc-900"><Cloud className="h-5 w-5 text-emerald-700" />Weather Snapshot</h3>
            <p className="mt-1 text-sm text-zinc-600">{weather?.source || 'No weather data'} {weather?.isSimulated ? '(simulated)' : ''}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Temp</p><p className="mt-1 text-lg font-semibold text-zinc-900">{weather?.data?.current?.temperature ?? '--'}F</p></div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Humidity</p><p className="mt-1 text-lg font-semibold text-zinc-900">{weather?.data?.current?.humidity ?? '--'}%</p></div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Precip</p><p className="mt-1 text-lg font-semibold text-zinc-900">{weather?.data?.current?.precipitation ?? '--'} mm</p></div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"><p className="text-xs uppercase tracking-wide text-zinc-500">Wind</p><p className="mt-1 text-lg font-semibold text-zinc-900">{weather?.data?.current?.windSpeed ?? '--'} mph</p></div>
            </div>
          </article>
        </motion.section>
      </main>

      <Chatbot
        objective={objective}
        context={{
          bbox: ingest?.alignment?.bbox || ingest?.bbox,
          ndviStats,
          grid3x3: ingest?.ndvi?.grid3x3 || [],
          selectedCell,
          selectedCellData,
          soilStats,
          etStats,
          weather: weather || null,
          timeSeries: timeSeries || null,
          inference: inference || null,
          warnings,
          providersTried: providers,
        }}
      />
    </div>
  )
}


