import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { GoogleAuthProvider, onAuthStateChanged, signInWithRedirect } from 'firebase/auth'
import { Loader2, Trash2 } from 'lucide-react'
import NavBar from '../components/NavBar'
import { Button } from '../components/ui/button'
import { toast } from 'sonner'
import { auth, isFirebaseClientConfigured } from '../lib/firebaseClient'
import { ApiClientError, deletePlot, fetchPlots, mapSaveError } from '../lib/client/api'
import { parsePlotShape } from '../lib/client/plot-shape'
import type { PlotItem } from '../lib/types/api'

export default function Plots() {
  const authConfigured = isFirebaseClientConfigured
  const [user, setUser] = useState<any>(null)
  const [plots, setPlots] = useState<PlotItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const sortedPlots = useMemo(
    () => [...plots].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [plots]
  )

  useEffect(() => {
    if (!authConfigured || !auth) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      if (!nextUser) {
        setPlots([])
        setLoading(false)
        return
      }
      void loadPlots(nextUser)
    })
  }, [authConfigured])

  async function loadPlots(activeUser = user) {
    if (!activeUser) return
    setLoading(true)
    try {
      const token = await activeUser.getIdToken(true)
      let items
      try {
        items = await fetchPlots(token)
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          const refreshedToken = await activeUser.getIdToken(true)
          items = await fetchPlots(refreshedToken)
        } else {
          throw error
        }
      }
      setPlots(items)
    } catch (error) {
      toast.error(mapSaveError(error))
    } finally {
      setLoading(false)
    }
  }

  async function signIn() {
    if (!authConfigured || !auth) return
    const provider = new GoogleAuthProvider()
    await signInWithRedirect(auth, provider)
  }

  async function removePlot(id: string) {
    if (!auth || !user) return
    const previous = [...plots]
    setDeletingId(id)
    setPlots((current) => current.filter((plot) => plot.id !== id))
    try {
      const token = await user.getIdToken(true)
      await deletePlot(token, id)
      toast.success('Plot deleted')
    } catch (error) {
      setPlots(previous)
      toast.error(mapSaveError(error))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="app-shell py-6">
        <section className="surface-card p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900">Saved Plots</h1>
              <p className="mt-1 text-sm text-zinc-600">Persistent analysis snapshots with inference metadata.</p>
            </div>
            {user && (
              <Button variant="outline" onClick={() => void loadPlots()}>
                Refresh
              </Button>
            )}
          </div>

          {!authConfigured && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              Firebase Auth is not configured. Set `NEXT_PUBLIC_FIREBASE_*` values to enable plot persistence.
            </div>
          )}

          {authConfigured && !user && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-sm text-zinc-600">Sign in to view and manage saved plots.</p>
              <Button className="mt-3" onClick={signIn}>
                Sign in with Google
              </Button>
            </div>
          )}

          {authConfigured && user && loading && (
            <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading plots
            </div>
          )}

          {authConfigured && user && !loading && sortedPlots.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
              No plots saved yet. Run analysis from dashboard and save your first AOI.
            </div>
          )}

          {authConfigured && user && sortedPlots.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sortedPlots.map((plot) => (
                <article key={plot.id} className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
                  {(() => {
                    const shape = parsePlotShape(plot)
                    return (
                      <>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-900">{plot.name || 'Untitled plot'}</h2>
                      <p className="text-xs text-zinc-500">{plot.locationName || 'Unknown location'}</p>
                    </div>
                    <button
                      onClick={() => void removePlot(plot.id)}
                      disabled={deletingId === plot.id}
                      className="rounded-lg border border-zinc-200 p-1.5 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
                      aria-label="Delete plot"
                    >
                      {deletingId === plot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                  {shape.bbox && (
                    <p className="mb-2 text-[11px] text-zinc-500">
                      AOI bbox: {shape.bbox[0].toFixed(2)}, {shape.bbox[1].toFixed(2)}, {shape.bbox[2].toFixed(2)}, {shape.bbox[3].toFixed(2)}
                    </p>
                  )}
                  {plot.previewPng && (
                    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                      <img src={`data:image/png;base64,${plot.previewPng}`} alt={plot.name || 'plot preview'} className="h-44 w-full object-cover" />
                    </div>
                  )}
                  <div className="mt-2 text-xs text-zinc-600">
                    NDVI mean: {typeof plot?.ndviStats?.mean === 'number' ? plot.ndviStats.mean.toFixed(3) : 'N/A'}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Created: {plot.createdAt ? new Date(plot.createdAt).toLocaleString() : 'Unknown'}
                  </div>
                  <div className="mt-3">
                    <Link href={`/plots/${plot.id}`}>
                      <Button className="w-full" size="sm">
                        Open details
                      </Button>
                    </Link>
                  </div>
                      </>
                    )
                  })()}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
