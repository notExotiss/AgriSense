import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { onAuthStateChanged } from 'firebase/auth'
import { Loader2 } from 'lucide-react'
import NavBar from '../../components/NavBar'
import TimeSeriesChart from '../../components/TimeSeriesChart'
import { Button } from '../../components/ui/button'
import { auth, isFirebaseClientConfigured } from '../../lib/firebaseClient'
import { fetchPlots, mapSaveError } from '../../lib/client/api'
import { parsePlotShape } from '../../lib/client/plot-shape'
import { toast } from 'sonner'

export default function PlotDetail() {
  const router = useRouter()
  const { id } = router.query
  const authConfigured = isFirebaseClientConfigured
  const [user, setUser] = useState<any>(null)
  const [plot, setPlot] = useState<any>(null)
  const [timeSeries, setTimeSeries] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const parsedShape = useMemo(() => parsePlotShape(plot || {}), [plot])
  const bbox = parsedShape.bbox

  useEffect(() => {
    if (!authConfigured || !auth) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      if (!nextUser) {
        setLoading(false)
        return
      }
      if (!id || typeof id !== 'string') return
      void load(nextUser, id)
    })
  }, [authConfigured, id])

  async function load(activeUser = user, plotId = id) {
    if (!activeUser || typeof plotId !== 'string') return
    setLoading(true)
    try {
      const token = await activeUser.getIdToken(true)
      const plots = await fetchPlots(token)
      const current = plots.find((item) => item.id === plotId)
      if (!current) {
        setPlot(null)
        setLoading(false)
        return
      }
      setPlot(current)

      const derivedBbox = parsePlotShape(current as any).bbox
      if (derivedBbox) {
        const response = await fetch('/api/timeseries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bbox: derivedBbox, interval: 'weekly' }),
        })
        const payload = await response.json().catch(() => ({}))
        if (response.ok) setTimeSeries(payload)
      }
    } catch (error) {
      toast.error(mapSaveError(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="app-shell py-6">
        <section className="surface-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900">Plot Detail</h1>
              <p className="mt-1 text-sm text-zinc-600">Snapshot, inference, and historical performance.</p>
            </div>
            <Link href="/plots">
              <Button variant="outline">Back to plots</Button>
            </Link>
          </div>

          {loading && (
            <div className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading plot
            </div>
          )}

          {!loading && !authConfigured && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              Firebase Auth is not configured.
            </div>
          )}

          {!loading && authConfigured && !user && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              Sign in to view this plot.
            </div>
          )}

          {!loading && user && !plot && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              Plot not found.
            </div>
          )}

          {!loading && plot && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Name</p>
                  <p className="mt-1 text-lg font-semibold text-zinc-900">{plot.name || 'Untitled plot'}</p>
                  <p className="mt-1 text-sm text-zinc-600">{plot.locationName || 'Unknown location'}</p>
                  <p className="mt-2 text-xs text-zinc-500">
                    Created: {plot.createdAt ? new Date(plot.createdAt).toLocaleString() : 'Unknown'}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    NDVI mean: {typeof plot?.ndviStats?.mean === 'number' ? plot.ndviStats.mean.toFixed(3) : 'N/A'}
                  </p>
                </article>

                <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Inference summary</p>
                  <p className="mt-1 text-sm text-zinc-700">
                    {(plot as any)?.inferenceSnapshot?.summary?.whatChanged || 'No inference snapshot available.'}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    Confidence:{' '}
                    {typeof (plot as any)?.inferenceSnapshot?.confidence === 'number'
                      ? `${Math.round((plot as any).inferenceSnapshot.confidence * 100)}%`
                      : 'N/A'}
                  </p>
                  {bbox && (
                    <p className="mt-2 text-xs text-zinc-500">
                      BBox: {bbox[0].toFixed(4)}, {bbox[1].toFixed(4)}, {bbox[2].toFixed(4)}, {bbox[3].toFixed(4)}
                    </p>
                  )}
                </article>
              </div>
              {parsedShape.grid3x3.length > 0 && (
                <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">Saved 3x3 cell summary</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {parsedShape.grid3x3.map((cell) => (
                      <div key={cell.cellId} className="rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                        <p className="text-[11px] font-semibold text-zinc-700">{cell.cellId}</p>
                        <p className="text-xs text-zinc-600">mean {Number(cell.mean || 0).toFixed(3)}</p>
                        <p className="text-[11px] text-zinc-500">{cell.stressLevel}</p>
                      </div>
                    ))}
                  </div>
                </article>
              )}

              {plot.previewPng && (
                <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
                  <img src={`data:image/png;base64,${plot.previewPng}`} alt={plot.name || 'preview'} className="h-[22rem] w-full object-contain" />
                </div>
              )}

              <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                <h2 className="text-lg font-semibold text-zinc-900">Historical NDVI</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {timeSeries?.source || 'No source'} {timeSeries?.isSimulated ? '(simulated)' : ''}
                </p>
                <div className="mt-3">
                  <TimeSeriesChart
                    data={(timeSeries?.data?.timeSeries || []).map((point: any) => ({
                      date: point.date,
                      ndvi: Number(point.ndvi),
                      confidence: Number(point.confidence),
                      cloudCover: typeof point.cloudCover === 'number' ? point.cloudCover : undefined,
                    }))}
                    title="Saved plot NDVI trend"
                    showConfidence
                    showCloudCover
                  />
                </div>
              </article>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
