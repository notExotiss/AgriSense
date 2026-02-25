import { MapContainer as RLMapContainer, TileLayer as RLTileLayer, ImageOverlay as RLImageOverlay, Polygon, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import L, { LatLngBoundsExpression, LatLngExpression } from 'leaflet'
import { useEffect, useRef, useMemo } from 'react'
import AoiGridMapOverlay from './AoiGridMapOverlay'
import type { GridCellSummary } from '../lib/types/api'

// Fix Leaflet default icons
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface Hotspot { position: LatLngExpression; label: string; }

/**
 * MapView props:
 * - ndviPng: (optional) base64 png (without data: prefix) - existing behavior preserved
 * - processedOverlayUrl: (optional) prefer a processed PNG hosted in public/ (e.g. /processed_topo.png)
 * - smoothOverlay: (optional) default true; apply browser smoothing and gentle filters
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
  selectedCell,
  onSelectCell,
  showGrid = true,
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
  selectedCell?: string | null,
  onSelectCell?: (cellId: string) => void,
  showGrid?: boolean
}) {
  const mapRef = useRef<L.Map|null>(null)

  // Draw controls (unchanged)
  useEffect(()=>{
    const map = mapRef.current
    if (!map) return
    const drawnItems = new L.FeatureGroup()
    map.addLayer(drawnItems)
    // @ts-ignore
    const drawControl = new L.Control.Draw({
      draw: {
        polygon: true,
        rectangle: true,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems }
    })
    map.addControl(drawControl as any)

    map.on((L as any).Draw.Event.CREATED, (e: any) => {
      const layer = e.layer
      drawnItems.addLayer(layer)
      if (layer.getBounds){
        const b = layer.getBounds()
        const west = b.getWest(), south = b.getSouth(), east = b.getEast(), north = b.getNorth()
        onBboxChange && onBboxChange([west, south, east, north])
      }
      if (layer.getLatLngs){
        const coords = layer.getLatLngs()[0] || []
        onPolygonChange && onPolygonChange(coords)
      }
    })

    return () => {
      map.removeControl(drawControl as any)
      map.removeLayer(drawnItems)
    }
  }, [mapRef.current])

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

  // Inject a tiny stylesheet once to encourage smooth interpolation for the overlay image.
  useEffect(() => {
    if (!smoothOverlay) return
    const id = 'leaflet-image-smooth-css'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    // image-rendering: auto + -webkit-optimize-contrast helps browsers avoid nearest-neighbor scaling.
    // filter: blur + contrast + saturate gives a gentle smoothing and reduces harsh spikes.
    style.textContent = `
      .leaflet-image-smooth {
        image-rendering: auto !important;
        -ms-interpolation-mode: bicubic !important; /* IE */
        image-rendering: -webkit-optimize-contrast !important;
        will-change: transform;
      }
      .leaflet-image-smooth.smooth-filter {
        filter: blur(0.7px) contrast(0.98) saturate(1.05);
        /* slight blur to remove thin spiky lines, small contrast/saturation tweak */
      }
    `
    document.head.appendChild(style)
    return () => { /* keep it for app lifetime; no cleanup required */ }
  }, [smoothOverlay])

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
      className={`leaflet-image-smooth ${smoothOverlay ? 'smooth-filter' : ''}`}
      style={{
        imageRendering: 'auto',
        transform: 'translateZ(0)',
      }}
    />
  ) : null

  return (
    <AnyMap
      ref={mapRef as any}
      center={defaultCenter}
      zoom={defaultZoom}
      style={{ height: '100%', width: '100%', borderRadius: 12, overflow: 'hidden', zIndex: 0 }}
    >
      <AnyTile
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {overlay}
      <AoiGridMapOverlay
        bbox={ndviBounds || bbox}
        cells={grid3x3}
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
  )
}

