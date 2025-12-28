import { useState } from 'react'
import NavBar from '../components/NavBar'
import { Button } from '../components/ui/button'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'

const MapView = dynamic(() => import('../components/MapView'), { ssr: false })

export default function Ingest() {
  const [query, setQuery] = useState('Iowa City')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [bboxStr, setBboxStr] = useState('')
  const [date, setDate] = useState('2025-08-01/2025-08-10')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [polygon, setPolygon] = useState<any[]>([])

  async function geocode() {
    setLoading(true)
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`)
      if (!r.ok) throw new Error('Geocode failed')
      const j = await r.json()
      setSuggestions(j.places || [])
      toast.success('Found places')
    } catch (e: any) {
      toast.error(e?.message || 'Geocoding error')
    } finally {
      setLoading(false)
    }
  }

  function selectPlace(p: any) {
    if (p?.bbox?.length === 4) {
      const [south, north, west, east] = p.bbox
      setBboxStr(`${west},${south},${east},${north}`)
    }
    setSuggestions([])
  }

  function polygonToBbox(coords: any[]) {
    if (!coords.length) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    coords.forEach(([lng, lat]) => {
      if (lng < minX) minX = lng
      if (lng > maxX) maxX = lng
      if (lat < minY) minY = lat
      if (lat > maxY) maxY = lat
    })
    setBboxStr(`${minX},${minY},${maxX},${maxY}`)
  }

  async function autoFetchNDVI() {
    if (!bboxStr) return toast.error('Please set a bounding box first')
    setLoading(true)
    setResult(null)
    try {
      const bbox = bboxStr.split(',').map(s => Number(s.trim()))
      const r = await fetch('/api/ingest/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox, date, targetSize: 1024, palette: 'heatmap' })
      })
      if (!r.ok) throw new Error('NDVI fetch failed')
      const j = await r.json()
      setResult(j)
      toast.success('NDVI fetched successfully')
    } catch (e: any) {
      toast.error(e?.message || 'Auto-ingest error')
    } finally {
      setLoading(false)
    }
  }

  const hotspots = (result?.ndviPng && result?.bbox)
    ? [{
        position: [
          (result.bbox[1] + result.bbox[3]) / 2,
          (result.bbox[0] + result.bbox[2]) / 2
        ],
        label: 'Center of AOI'
      }]
    : []

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-sky-50">
      <NavBar />
      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-1">AgriSense — Auto Ingest</h1>
        <p className="text-sm text-muted-foreground mb-4">
          Search a place, draw an AOI, then click Fetch NDVI — the system will
          find the best Sentinel-2 scene and calculate NDVI automatically.
        </p>

        <div className="rounded-lg border bg-card p-4 mb-4">
          <MapView
            bbox={bboxStr ? (bboxStr.split(',').map(Number) as any) : undefined}
            onBboxChange={b => setBboxStr(b.join(','))}
            polygon={polygon as any}
            onPolygonChange={(coords) => {
              setPolygon(coords as any)
              polygonToBbox(coords as any)
            }}
            ndviPng={result?.ndviPng}
            ndviBounds={result?.bbox}
            hotspots={hotspots as any}
          />
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Search place</label>
              <div className="flex gap-2">
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="e.g., Iowa City"
                />
                <Button
                  variant="secondary"
                  onClick={geocode}
                  disabled={loading}
                >
                  {loading ? 'Searching…' : 'Find'}
                </Button>
              </div>
              {suggestions.length > 0 && (
                <div className="mt-2 border rounded bg-background text-sm max-h-48 overflow-auto">
                  {suggestions.map((s: any) => (
                    <div
                      key={s.display_name}
                      className="px-2 py-1 hover:bg-accent cursor-pointer"
                      onClick={() => selectPlace(s)}
                    >
                      {s.display_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                BBox [minx,miny,maxx,maxy]
              </label>
              <input
                className="border rounded px-2 py-1 w-full"
                value={bboxStr}
                onChange={e => setBboxStr(e.target.value)}
                placeholder="-122.52,37.70,-122.35,37.83"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">
                Date range (ISO/ISO)
              </label>
              <input
                className="border rounded px-2 py-1 w-full"
                value={date}
                onChange={e => setDate(e.target.value)}
                placeholder="2025-08-01/2025-08-10"
              />
            </div>
          </div>
          <div className="mt-3">
            <Button
              onClick={autoFetchNDVI}
              disabled={loading || !bboxStr}
            >
              {loading ? 'Fetching…' : 'Fetch NDVI'}
            </Button>
          </div>
        </div>

        {result && (
          <div className="mt-4 rounded-lg border bg-card p-4 text-sm">
            <div className="font-medium">NDVI Stats</div>
            <div className="text-muted-foreground">
              min {result.ndviStats?.min?.toFixed?.(2)} • mean{' '}
              {result.ndviStats?.mean?.toFixed?.(2)} • max{' '}
              {result.ndviStats?.max?.toFixed?.(2)}
            </div>
            {result.ndviPng && (
              <div className="mt-3">
                <img
                  src={`data:image/png;base64,${result.ndviPng}`}
                  alt="NDVI preview"
                  className="w-full max-w-xl rounded border"
                />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
