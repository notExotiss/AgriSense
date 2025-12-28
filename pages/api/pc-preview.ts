import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse){
  if (req.method !== 'GET') return res.status(405).end()
  try{
    const item = String(req.query.item || '')
    if (!item) return res.status(400).json({ error: 'item required' })
    const url = `https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png?collection=sentinel-2-l2a&item=${encodeURIComponent(item)}&assets=visual&asset_bidx=visual%7C1,2,3&nodata=0&format=png`
    const r = await fetch(url)
    if (!r.ok){
      const text = await r.text()
      return res.status(502).json({ error: 'pc_failed', detail: text })
    }
    const buf = Buffer.from(await r.arrayBuffer())
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return res.status(200).send(buf)
  } catch(e:any){
    console.error('pc-preview', e?.message || e)
    return res.status(500).json({ error: 'internal' })
  }
} 