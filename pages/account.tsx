import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { Button } from '../components/ui/button'
import { auth } from '../lib/firebaseClient'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth'

export default function Account(){
  const [user, setUser] = useState<any>(null)
  const [plots, setPlots] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(()=>{
    return onAuthStateChanged(auth, async (u)=>{
      setUser(u)
      if (u){
        const token = await u.getIdToken()
        const r = await fetch('/api/items', { headers: { Authorization: `Bearer ${token}` } })
        const j = await r.json().catch(()=>({}))
        setPlots(j.items || [])
      } else {
        setPlots([])
      }
    })
  },[])

  async function signIn(){
    const provider = new GoogleAuthProvider()
    try{
      await signInWithPopup(auth, provider)
    } catch {
      try{ await signInWithRedirect(auth, provider) } catch {}
    }
  }

  async function doSignOut(){
    await signOut(auth)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <NavBar />
      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-2">Account</h1>
        {!user ? (
          <div className="rounded border bg-card p-4">
            <p className="text-sm text-muted-foreground mb-3">Sign in to save and manage your plots.</p>
            <Button onClick={signIn}>Sign in with Google</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded border bg-card p-4 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{user.displayName || user.email}</div>
                <div className="text-xs text-muted-foreground">UID: {user.uid}</div>
              </div>
              <Button variant="secondary" onClick={doSignOut}>Sign out</Button>
            </div>
            <div className="rounded border bg-card p-4">
              <div className="font-medium mb-2">Your Plots</div>
              {plots.length === 0 ? (
                <div className="text-sm text-muted-foreground">No plots yet.</div>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {plots.map((p)=> (
                    <div key={p.id} className="border rounded p-3">
                      <div className="text-sm">{p.name || 'Plot'}</div>
                      <div className="text-xs text-muted-foreground">NDVI mean: {p?.ndviStats?.mean?.toFixed?.(2)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
} 