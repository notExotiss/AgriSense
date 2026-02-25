import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GoogleAuthProvider, onAuthStateChanged, signInWithRedirect, signOut } from 'firebase/auth'
import { Loader2, UserCircle2 } from 'lucide-react'
import NavBar from '../components/NavBar'
import { Button } from '../components/ui/button'
import { auth, isFirebaseClientConfigured } from '../lib/firebaseClient'
import { ApiClientError, fetchPlots, mapSaveError } from '../lib/client/api'
import { toast } from 'sonner'

export default function Account() {
  const authConfigured = isFirebaseClientConfigured
  const [user, setUser] = useState<any>(null)
  const [plotCount, setPlotCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authConfigured || !auth) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      if (!nextUser) {
        setPlotCount(0)
        setLoading(false)
        return
      }
      try {
        const token = await nextUser.getIdToken(true)
        let items
        try {
          items = await fetchPlots(token)
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 401) {
            const refreshedToken = await nextUser.getIdToken(true)
            items = await fetchPlots(refreshedToken)
          } else {
            throw error
          }
        }
        setPlotCount(items.length)
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          toast.error('Session expired. Sign in again to load account data.')
          return
        }
        toast.error(mapSaveError(error))
      } finally {
        setLoading(false)
      }
    })
  }, [authConfigured])

  async function signIn() {
    if (!authConfigured || !auth) return
    const provider = new GoogleAuthProvider()
    await signInWithRedirect(auth, provider)
  }

  async function handleSignOut() {
    if (!authConfigured || !auth) return
    await signOut(auth)
    setPlotCount(0)
  }

  return (
    <div className="min-h-screen">
      <NavBar />
      <main className="app-shell py-6">
        <section className="surface-card p-5">
          <h1 className="text-2xl font-semibold text-zinc-900">Account</h1>
          <p className="mt-1 text-sm text-zinc-600">Identity, ownership, and persistence status.</p>

          {!authConfigured && (
            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              Firebase Auth is not configured. Add `NEXT_PUBLIC_FIREBASE_*` and `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel.
            </div>
          )}

          {authConfigured && loading && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading account
            </div>
          )}

          {authConfigured && !loading && !user && (
            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-sm text-zinc-600">Sign in to save plots and access your analysis history.</p>
              <Button className="mt-3" onClick={signIn}>
                Sign in with Google
              </Button>
            </div>
          )}

          {authConfigured && user && !loading && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <UserCircle2 className="h-10 w-10 text-emerald-800" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">{user.displayName || user.email || 'AgriSense User'}</p>
                    <p className="text-xs text-zinc-500">{user.email || 'No email available'}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-zinc-500">UID: {user.uid}</p>
                <Button className="mt-3" variant="outline" onClick={handleSignOut}>
                  Sign out
                </Button>
              </article>

              <article className="rounded-2xl border border-zinc-200 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Saved plots</p>
                <p className="mt-2 text-3xl font-semibold text-zinc-900">{plotCount}</p>
                <p className="mt-1 text-sm text-zinc-600">All saved plots are scoped to your authenticated account.</p>
                <Link href="/plots" className="mt-3 inline-block">
                  <Button>Open plot library</Button>
                </Link>
              </article>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
