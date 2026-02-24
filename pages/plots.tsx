import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { auth, isFirebaseClientConfigured } from '../lib/firebaseClient'
import Link from 'next/link'
import { Button } from '../components/ui/button'
import { toast } from 'sonner'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect } from 'firebase/auth'

export default function Plots(){
  const authConfigured = isFirebaseClientConfigured
  const [plots, setPlots] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [authLoading, setAuthLoading] = useState(true)

  async function signIn(){
    if (!authConfigured || !auth) return toast.error('Firebase Auth is not configured.')
    const provider = new GoogleAuthProvider()
    try{
      await signInWithPopup(auth, provider)
    } catch {
      try{ await signInWithRedirect(auth, provider) } catch {}
    }
  }

  async function load(){
    if (!user) return
    setLoading(true)
    try{
      const token = await user.getIdToken()
      const r = await fetch('/api/items', { headers: { Authorization: `Bearer ${token}` } })
      const data = await r.json()
      setPlots(Array.isArray(data) ? data : (data.items || []))
    } catch (e:any){
      toast.error(e?.message || 'Failed to load plots')
      setPlots([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(()=>{
    if (!authConfigured || !auth){
      setUser(null)
      setPlots([])
      setAuthLoading(false)
      return
    }

    return onAuthStateChanged(auth, (u)=>{
      setUser(u)
      setAuthLoading(false)
      if (u) {
        load()
      } else {
        setPlots([])
      }
    })
  },[])

  useEffect(()=>{
    if (user) {
      load()
    }
  },[user])

  async function remove(id:string){
    try{
      if (!authConfigured || !auth) return toast.error('Firebase Auth is not configured.')
      const u = auth.currentUser
      if (!u) return toast.error('Please sign in')
      const token = await u.getIdToken()
      const r = await fetch(`/api/plots/${id}`, { method:'DELETE', headers:{ Authorization: `Bearer ${token}` } })
      if (!r.ok) throw new Error('Delete failed')
      toast.success('Deleted')
      load()
    } catch(e:any){
      toast.error(e?.message || 'Delete error')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <NavBar />
      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Saved Plots</h1>
        
        {authLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : !authConfigured ? (
          <div className="rounded border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Firebase Auth is not configured. Set `NEXT_PUBLIC_FIREBASE_*` variables in Vercel project settings.
            </p>
          </div>
        ) : !user ? (
          <div className="rounded border bg-card p-4">
            <p className="text-sm text-muted-foreground mb-3">Sign in to view your saved plots.</p>
            <Button onClick={signIn}>Sign in with Google</Button>
          </div>
        ) : plots.length === 0 ? (
          <div className="text-sm text-muted-foreground">{loading ? 'Loading…' : 'No plots yet.'}</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {plots.map((p) => (
              <div key={p.id} className="rounded border bg-card p-4 flex flex-col gap-2">
                <div className="text-sm font-medium">{p.name || 'Plot'}</div>
                {p.previewPng && (
                  <img src={`data:image/png;base64,${p.previewPng}`} alt="preview" className="w-full rounded border" />
                )}
                <div className="text-xs text-muted-foreground">NDVI mean: {p?.ndviStats?.mean?.toFixed?.(2)}</div>
                <div className="text-xs text-muted-foreground">Created: {p.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : (p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'Unknown')}</div>
                <div className="mt-2 flex gap-2">
                  <Link href={`/plots/${p.id}`} className="inline-block"><Button size="sm" variant="secondary">Open</Button></Link>
                  <Button size="sm" variant="destructive" onClick={()=> remove(p.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
} 
