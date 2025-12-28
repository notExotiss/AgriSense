import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  if (req.method !== 'GET') return res.status(405).end()
  try{
    const q = String(req.query.q || '').trim()
    if (!q) return res.status(400).json({ error: 'q required' })
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&q=${encodeURIComponent(q)}`
    const r = await fetch(url, { headers: { 'User-Agent': 'AgriSense/1.0 (contact: example@example.com)' } })
    if (!r.ok) return res.status(502).json({ error: 'geocode_failed' })
    const js = await r.json()
    const places = js.map((p:any)=> ({
      display_name: p.display_name,
      bbox: (p.boundingbox || []).map((n:string)=> Number(n)),
      lat: Number(p.lat),
      lon: Number(p.lon)
    }))
    return res.status(200).json({ places })
  } catch(e:any){
    console.error('geocode', e?.message || e)
    return res.status(500).json({ error: 'internal' })
  }
} 