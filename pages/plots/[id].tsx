import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import NavBar from '../../components/NavBar'
import { auth } from '../../lib/firebaseClient'
import TimeSeriesChart from '../../components/TimeSeriesChart'

export default function PlotDetail(){
  const router = useRouter()
  const { id } = router.query
  const [series, setSeries] = useState<{ date:string, ndviStats:{ mean:number } }[]>([])

  useEffect(()=>{
    if (!id) return
    (async()=>{
      const u = auth.currentUser
      if (!u) return
      const token = await u.getIdToken()
      const r = await fetch(`/api/plots/${id}/timeseries`, { headers: { Authorization: `Bearer ${token}` } })
      const j = await r.json()
      const items = (j.items || []).map((x:any)=> ({ date: x.date, ndviStats: x.ndviStats }))
      setSeries(items)
    })()
  },[id])

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <NavBar />
      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-2">Plot {id}</h1>
        <div className="rounded border bg-card p-4">
          <div className="font-medium mb-2">NDVI Over Time</div>
          <TimeSeriesChart data={series.map(s=> ({ date: s.date, ndvi: s.ndviStats?.mean || 0 }))} />
        </div>
      </main>
    </div>
  )
} 