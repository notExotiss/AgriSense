import { MapContainer as RLMapContainer, TileLayer as RLTileLayer, ImageOverlay as RLImageOverlay, Polygon, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import L, { LatLngBoundsExpression, LatLngExpression } from 'leaflet'
import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import AoiGridMapOverlay from './AoiGridMapOverlay'
import type { CellFootprint, GridCellSummary } from '../lib/types/api'

// Fix Leaflet default icons
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface Hotspot { position: LatLngExpression; label: string; }
type DebugMetricGrid = {
  values: number[]
  width: number
  height: number
}
type DebugHover = {
  lat: number
  lon: number
  pixelX: number
  pixelY: number
  value: number | null
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function sampleNearest(
  metricGrid: DebugMetricGrid | null | undefined,
  alignmentBbox: [number, number, number, number] | null | undefined,
  lat: number,
  lon: number
) {
  if (!metricGrid || !alignmentBbox || !metricGrid.width || !metricGrid.height || !Array.isArray(metricGrid.values)) {
    return { pixelX: -1, pixelY: -1, value: null }
  }
  const [minLon, minLat, maxLon, maxLat] = alignmentBbox
  const lonRange = Math.max(1e-9, maxLon - minLon)
  const latRange = Math.max(1e-9, maxLat - minLat)
  const u = clamp((lon - minLon) / lonRange, 0, 1)
  const v = clamp((maxLat - lat) / latRange, 0, 1)
  const pixelX = clamp(Math.round(u * (metricGrid.width - 1)), 0, metricGrid.width - 1)
  const pixelY = clamp(Math.round(v * (metricGrid.height - 1)), 0, metricGrid.height - 1)
  const index = pixelY * metricGrid.width + pixelX
  const raw = Number(metricGrid.values[index])
  return {
    pixelX,
    pixelY,
    value: Number.isFinite(raw) ? raw : null,
  }
}

function MapDebugProbe({
  enabled,
  metricGrid,
  alignmentBbox,
  onHover,
}: {
  enabled: boolean
  metricGrid?: DebugMetricGrid | null
  alignmentBbox?: [number, number, number, number] | null
  onHover: (hover: DebugHover | null) => void
}) {
  useMapEvents({
    mousemove(event) {
      if (!enabled) return
      const lat = Number(event.latlng?.lat)
      const lon = Number(event.latlng?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        onHover(null)
        return
      }
      const sampled = sampleNearest(metricGrid, alignmentBbox, lat, lon)
      onHover({
        lat,
        lon,
        pixelX: sampled.pixelX,
        pixelY: sampled.pixelY,
        value: sampled.value,
      })
    },
    mouseout() {
      onHover(null)
    },
  })
  return null
}

function MapReadyBridge({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => {
    onReady(map)
  }, [map, onReady])
  return null
}

/**
 * MapView props:
 * - ndviPng: (optional) base64 png (without data: prefix) - existing behavior preserved
 * - processedOverlayUrl: (optional) prefer a processed PNG hosted in public/ (e.g. /processed_topo.png)
 * - smoothOverlay: (optional) default false; precision mode keeps hard pixel alignment
 * - overlayOpacity: (optional) default 0.85
 */
export default function MapView({
  bbox,
  onBboxChange,
  polygon,
  onPolygonChange,
  ndviPng,
  ndviBounds,
  hotspots,
  processedOverlayUrl,
  smoothOverlay = true,
  overlayOpacity = 0.85,
  grid3x3,
  cellFootprints,
  selectedCell,
  onSelectCell,
  showGrid = true,
  debugMode = false,
  debugMetricGrid,
  debugAlignmentBbox,
  debugResolutionMeters,
  debugCoverage,
  clearAoiSignal = 0,
}:{
  bbox?: [number,number,number,number],
  onBboxChange?: (bbox:[number,number,number,number])=>void,
  polygon?: LatLngExpression[],
  onPolygonChange?: (coords: LatLngExpression[])=>void,
  ndviPng?: string,
  ndviBounds?: [number,number,number,number],
  hotspots?: Hotspot[],
  processedOverlayUrl?: string,
  smoothOverlay?: boolean,
  overlayOpacity?: number,
  grid3x3?: GridCellSummary[],
  cellFootprints?: CellFootprint[],
  selectedCell?: string | null,
  onSelectCell?: (cellId: string) => void,
  showGrid?: boolean
  debugMode?: boolean
  debugMetricGrid?: DebugMetricGrid | null
  debugAlignmentBbox?: [number, number, number, number] | null
  debugResolutionMeters?: number | null
  debugCoverage?: number | null
  clearAoiSignal?: number
}) {
  const mapRef = useRef<L.Map|null>(null)
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null)
  const drawControlRef = useRef<any>(null)
  const onBboxChangeRef = useRef(onBboxChange)
  const onPolygonChangeRef = useRef(onPolygonChange)
  const [mapReady, setMapReady] = useState(false)
  const [debugHover, setDebugHover] = useState<DebugHover | null>(null)

  useEffect(() => {
    onBboxChangeRef.current = onBboxChange
  }, [onBboxChange])

  useEffect(() => {
    onPolygonChangeRef.current = onPolygonChange
  }, [onPolygonChange])

  // Draw controls
  useEffect(()=>{
    const map = mapRef.current
    if (!map || !mapReady) return
    if (drawnItemsRef.current || drawControlRef.current) return
    const drawnItems = new L.FeatureGroup()
    drawnItemsRef.current = drawnItems
    map.addLayer(drawnItems)
    // @ts-ignore
    const drawControl = new L.Control.Draw({
      draw: {
        polygon: {
          shapeOptions: {
            color: '#16a34a',
            weight: 2,
            opacity: 0.95,
            fill: false,
            fillOpacity: 0,
          },
        },
        rectangle: {
          shapeOptions: {
            color: '#16a34a',
            weight: 2,
            opacity: 0.95,
            fill: false,
            fillOpacity: 0,
          },
        },
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems }
    })
    drawControlRef.current = drawControl as any
    map.addControl(drawControlRef.current as any)

    const onCreated = (e: any) => {
      const layer = e.layer
      drawnItems.clearLayers()
      if (typeof layer?.setStyle === 'function') {
        layer.setStyle({
          color: '#16a34a',
          weight: 2,
          opacity: 0.95,
          fill: false,
          fillOpacity: 0,
        })
      }
      drawnItems.addLayer(layer)
      if (layer.getBounds){
        const b = layer.getBounds()
        const west = b.getWest(), south = b.getSouth(), east = b.getEast(), north = b.getNorth()
        onBboxChangeRef.current && onBboxChangeRef.current([west, south, east, north])
      }
      if (layer.getLatLngs){
        const coords = layer.getLatLngs()[0] || []
        onPolygonChangeRef.current && onPolygonChangeRef.current(coords)
      }
    }
    map.on((L as any).Draw.Event.CREATED, onCreated)

    return () => {
      map.off((L as any).Draw.Event.CREATED, onCreated)
      if (drawControlRef.current) {
        map.removeControl(drawControlRef.current as any)
      }
      if (drawnItemsRef.current) {
        map.removeLayer(drawnItemsRef.current)
      }
      drawControlRef.current = null
      drawnItemsRef.current = null
    }
  }, [mapReady])

  useEffect(() => {
    if (!mapReady) return
    if (!drawnItemsRef.current) return
    drawnItemsRef.current.clearLayers()
    onPolygonChangeRef.current && onPolygonChangeRef.current([])
    setDebugHover(null)
  }, [clearAoiSignal, mapReady])

  const defaultCenter: LatLngExpression = [40, -95]
  const defaultZoom = 5

  // Center and fit to bbox/polygon when provided
  useEffect(()=>{
    const map = mapRef.current
    if (!map) return
    try{
      if (ndviBounds && Array.isArray(ndviBounds) && ndviBounds.length === 4){
        const b = L.latLngBounds(
          [ndviBounds[1], ndviBounds[0]],
          [ndviBounds[3], ndviBounds[2]]
        )
        map.fitBounds(b, { padding: [20,20] })
        return
      }
      if (bbox && Array.isArray(bbox) && bbox.length === 4){
        const b = L.latLngBounds(
          [bbox[1], bbox[0]],
          [bbox[3], bbox[2]]
        )
        map.fitBounds(b, { padding: [20,20] })
        return
      }
      if (polygon && (polygon as any).length){
        const b = L.latLngBounds(polygon as any)
        map.fitBounds(b, { padding: [20,20] })
      }
    } catch {}
  }, [JSON.stringify(ndviBounds), JSON.stringify(bbox), JSON.stringify(polygon)])

  const AnyMap: any = RLMapContainer
  const AnyImage: any = RLImageOverlay
  const AnyTile: any = RLTileLayer

  // If the app already hosts a processed overlay (recommended), prefer that URL.
  // Otherwise fall back to incoming base64 PNG string (data URL).
  const overlayUrl = useMemo(() => {
    if (processedOverlayUrl && processedOverlayUrl.length) return processedOverlayUrl
    if (ndviPng && ndviPng.length) return `data:image/png;base64,${ndviPng}`
    return null
  }, [processedOverlayUrl, ndviPng])

  // Inject a tiny stylesheet once to control overlay interpolation mode.
  useEffect(() => {
    const id = 'leaflet-image-overlay-css'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      .leaflet-image-smooth {
        image-rendering: auto !important;
        -ms-interpolation-mode: bicubic !important;
        image-rendering: -webkit-optimize-contrast !important;
        will-change: transform;
      }
      .leaflet-image-precision {
        image-rendering: pixelated !important;
        image-rendering: crisp-edges !important;
        -ms-interpolation-mode: nearest-neighbor !important;
        will-change: transform;
      }
    `
    document.head.appendChild(style)
    return () => { /* keep for app lifetime */ }
  }, [])

  // Build the overlay element if we have an image + bounds
  const overlayBounds = ndviBounds && ndviBounds.length === 4
    ? ([[ndviBounds[1], ndviBounds[0]], [ndviBounds[3], ndviBounds[2]]] as LatLngBoundsExpression)
    : null

  const overlay = overlayUrl && overlayBounds ? (
    <AnyImage
      url={overlayUrl}
      bounds={overlayBounds}
      opacity={overlayOpacity}
      crossOrigin="anonymous"
      className={smoothOverlay ? 'leaflet-image-smooth' : 'leaflet-image-precision'}
      style={{
        imageRendering: smoothOverlay ? 'auto' : 'pixelated',
        transform: 'translateZ(0)',
      }}
    />
  ) : null

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map
    setMapReady(true)
  }, [])

  return (
    <div className="relative h-full w-full">
      <AnyMap
        ref={mapRef as any}
        center={defaultCenter}
        zoom={defaultZoom}
        style={{ height: '100%', width: '100%', borderRadius: 12, overflow: 'hidden', zIndex: 0 }}
      >
        <MapReadyBridge onReady={handleMapReady} />
        <AnyTile
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapDebugProbe
          enabled={Boolean(debugMode)}
          metricGrid={debugMetricGrid}
          alignmentBbox={debugAlignmentBbox || ndviBounds || bbox || null}
          onHover={setDebugHover}
        />
        {overlay}
        <AoiGridMapOverlay
          bbox={ndviBounds || bbox}
          cells={grid3x3}
          cellFootprints={cellFootprints}
          selectedCell={selectedCell}
          onSelectCell={onSelectCell}
          visible={Boolean(showGrid && (ndviBounds || bbox))}
        />
        {polygon && polygon.length>0 && (
          <Polygon positions={polygon} pathOptions={{ color: '#16a34a', weight: 2 }} />
        )}
        {(hotspots || []).map((h,i)=> (
          <Marker key={i} position={h.position as any}>
            <Popup>{h.label}</Popup>
          </Marker>
        ))}
      </AnyMap>
      {debugMode && (
        <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-lg border border-zinc-300/80 bg-white/90 px-2 py-1 text-[11px] font-medium text-zinc-800 shadow-sm backdrop-blur-sm">
          {debugHover ? (
            <>
              <p>
                lat/lon: {debugHover.lat.toFixed(6)}, {debugHover.lon.toFixed(6)}
              </p>
              <p>
                px: {debugHover.pixelX}, {debugHover.pixelY}
              </p>
              <p>
                value:{' '}
                {typeof debugHover.value === 'number' && Number.isFinite(debugHover.value)
                  ? debugHover.value.toFixed(4)
                  : 'n/a'}
              </p>
              {typeof debugResolutionMeters === 'number' && Number.isFinite(debugResolutionMeters) && (
                <p>resolution: ~{debugResolutionMeters.toFixed(2)}m/pixel</p>
              )}
              {typeof debugCoverage === 'number' && Number.isFinite(debugCoverage) && (
                <p>AOI coverage: {(debugCoverage * 100).toFixed(1)}%</p>
              )}
            </>
          ) : (
            <p>Move cursor to inspect raster sample</p>
          )}
        </div>
      )}
    </div>
  )
}

